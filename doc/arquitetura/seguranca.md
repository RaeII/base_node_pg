---
title: Segurança
tags:
  - architecture
  - security
  - global
---

# Segurança

Convenções de segurança do projeto. **Leia esta página antes de criar um módulo novo** — as regras aqui evitam que um endpoint novo reintroduza uma falha já corrigida na base.

---

## Modelo fail-closed no boot

O boot (`src/shared/loaders/index.ts` → `validateSecurityConfig()`) **recusa subir** mal configurado:

| Condição | Comportamento |
| --- | --- |
| `JWT_SECRET` ausente | `throw` — nunca sobe |
| `JWT_SECRET` < 32 chars | `throw` em produção · `warn` em dev |
| Produção com `AUTHORIZATION != 1` | `throw` — **a app não sobe com auth desligada** |
| Produção sem `DB_SSL` | `warn` no log |
| Produção sem `CORS_ORIGINS` | `warn` — nenhuma origem cross-site será aceita |

> [!important] AUTHORIZATION=0 é exclusivo de dev
> Os middlewares `jwtMiddleware`/`adminMiddleware` liberam tudo com `AUTHORIZATION=0` (só `GET /admin/me` continua exigindo sessão admin). Em produção isso é impossível por construção: o boot falha. Gere o secret com `openssl rand -base64 48`.

---

## Middlewares HTTP de segurança

Registrados em `src/shared/loaders/express.ts`, **antes** das rotas, nesta ordem:

1. `trust proxy` (`TRUST_PROXY` > 0) — necessário para `req.ip` real atrás de nginx/traefik; sem ele o rate limit enxerga o IP do proxy para todos os clientes.
2. `helmet()` — security headers (CSP, HSTS, `X-Frame-Options`, nosniff) + remove `X-Powered-By`.
3. `json({ limit: "1mb" })` — limite de body baixo por padrão (payload grande é vetor de DoS). Aumente **por rota** se um endpoint específico precisar.
4. `cookie-parser` + `cors` (origens de `CORS_ORIGINS`).
5. `globalRateLimiter` — limite por IP em toda a API.

### Rate limiting (`src/shared/middlewares/rateLimit.middleware.ts`)

| Limiter | Escopo | Default | Observação |
| --- | --- | --- | --- |
| `globalRateLimiter` | Toda a API (aplicado nos loaders) | 300 req/min por IP | `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` |
| `loginRateLimiter` | `POST /auth/login` e `POST /auth/admin/login` | 5 falhas/min por IP | `skipSuccessfulRequests: true` — só tentativas **falhas** contam; bucket compartilhado entre os dois logins |
| `signupRateLimiter` | `POST /auth/signup` | 5 tentativas/min por IP | Conta sucesso e falha — reduz criação abusiva de contas |

> [!tip] Endpoint novo sensível a brute-force?
> Login, reset de senha, verificação de código, etc. → crie um limiter dedicado no mesmo arquivo e aplique com `@Middleware(meuLimiter)`. Não confie só no limite global.

---

## CORS e cookie de autenticação

- **CORS:** origens vêm de `CORS_ORIGINS` (separadas por vírgula). Produção sem a variável = **nenhuma** origem cross-site (fail-closed). Dev sem a variável = `http://localhost:3000`.
- **Cookies `token_access` e `token_refresh`:** `httpOnly` + `secure` (produção) + `sameSite` de `COOKIE_SAMESITE` (default **`lax`** — bloqueia envio cross-site, defesa CSRF) + `domain` de `COOKIE_DOMAIN` (vazio = host-only, o mais restrito). O refresh tem `path=/api/auth` — só trafega para refresh e logout.

> [!warning] `COOKIE_SAMESITE=none` exige defesa CSRF própria
> Só use `none` se o front vive em **outro domínio** e não há alternativa. Nesse caso adicione token CSRF (double-submit) ou header customizado obrigatório nas mutações — o CORS **não** impede o envio de requests autenticadas cross-site, só a leitura da resposta.

Os atributos dos cookies são centralizados em `authCookieOptions()` (`auth.controller.ts`) — `clearAuthCookies()` usa os mesmos atributos, inclusive `path`, no `clearCookie` (obrigatório, senão o cookie não é removido).

---

## JWT

- Assinado e verificado com `algorithms: ["HS256"]` + `issuer: APP_NAME` fixos (evita confusão de algoritmo e tokens de outra app com o mesmo secret).
- **Dois tipos de token**, distinguidos pelo claim `type`:
  - `type: "user"` (login/signup/refresh) — é o **access token**: carrega `sub`, `sid` (id da sessão), `userId`, `username`, `email`. TTL `JWT_EXPIRES_IN_SECONDS` (default **15 min**); a sessão continua pelo refresh token ([[auth#Modelo de sessão]]).
  - `type: "service"` (`POST /auth/create-jwt`) — carrega só `name`. **Não tem `sid`**, então nunca passa no `adminMiddleware`. TTL `SERVICE_JWT_EXPIRES_IN_SECONDS` (default 30 dias).
- **Nenhum token carrega permissão de admin.** O `adminMiddleware` valida a sessão admin elevada **no banco** a cada request (ver abaixo).

- **`401` vs `403`:** token ausente, inválido ou expirado → **`401`** (o front renova a sessão ou volta ao login). `403` é só "autenticado sem permissão" (`adminOnly`) e **não** desloga.

> [!info] Revogação via refresh token
> O access token (JWT) não é revogável, por isso é curto (15 min). A sessão vive no refresh token rotativo (tabela `auth_session`), que **é** revogável: logout revoga a sessão; troca de senha, desativação e "encerrar sessões" (admin) revogam todas as sessões do usuário; reuso de refresh token revoga a sessão. Pior caso após revogar: o access já emitido vale até expirar — **exceto na área admin**, que checa a sessão no banco a cada request e corta na hora (inclusive rebaixamento). Tokens de **serviço** seguem sem revogação (TTL 30 dias).

---

## Área administrativa (step-up)

Detalhes em [[admin]]. Resumo do padrão:

- **Login próprio** (`POST /auth/admin/login`) com reautenticação; não-admin recebe o mesmo `401` de senha errada (não revela quem é admin).
- **Sessão nova** a cada login admin, revogando a anterior do navegador — anti session fixation.
- **Elevação curta:** expira após `ADMIN_SESSION_IDLE_SECONDS` sem uso (15 min, deslizante) e nunca passa de `ADMIN_SESSION_MAX_SECONDS` (8 h). Expirou → a sessão segue como usuário comum.
- **Autorização no banco a cada request** (`adminOnly`): sessão viva + elevação no prazo + usuário ainda ativo e admin. `403` quando falta a elevação.
- **Autoproteção:** admin não remove o próprio acesso nem se desativa.
- **Trilha de auditoria** (`audit_log`) de login admin e toda mutação administrativa, na mesma transação da ação.

---

## Autenticação (módulo user/auth)

Regras implementadas em `UserService.authenticate()` — **preserve-as ao adaptar o módulo**:

- **Anti-enumeração:** usuário inexistente, senha errada e usuário inativo respondem **todos** `401 "Credenciais inválidas"` — mesma mensagem, mesmo status.
- **Anti-timing:** quando o usuário não existe, compara contra `DUMMY_PASSWORD_HASH` — a resposta demora o mesmo que uma senha errada (sem isso, o tempo de resposta revela quais logins existem).
- **Senha:** bcrypt custo 12. Política: mínimo 8, **máximo 72** (bcrypt trunca silenciosamente acima de 72 bytes).
- **Normalização:** `username`/`email` são convertidos para minúsculas nos schemas de criação/atualização e no identifier do login (o banco compara case-sensitive).
- **Cadastro público:** `signupSchema` aceita só `username`, `email` e `password`; o controller força `is_active: true` e `is_admin: false`.
- **Auditoria:** login admin → `logger.info/warn("Admin login success|failed")` + `audit_log`; login com sucesso → `logger.info("Login success", { userId, ip })`; falha 401 → `logger.warn("Login failed", { ip })`; signup com sucesso → `logger.info("Signup success", { userId, ip })`; reuso de refresh token → `logger.warn("Refresh token reuse detected — session revoked", { userId, ip })`; emissão de token de serviço → `logger.info("Service JWT issued", ...)`. Nunca logue senha, hash ou token.

---

## Regras para módulos novos (checklist de segurança)

Complementa o checklist de [[novo-modulo]]:

- [ ] **Todo input validado com Zod** — body com `parseSchema(schema, req.body)`; **path params também**: `const { id } = parseSchema(idParamsSchema, req.params)`. `Number(req.params.id)` cru vira `NaN` → erro do driver → 500 + alerta.
- [ ] Schemas de body com `.strict()` e `.max()` em toda string ([[schemas-zod]]).
- [ ] **SQL sempre parametrizado** (`$1`) — nunca concatene input. Campos dinâmicos (UPDATE parcial) só via whitelist de código, como em `user.database.ts`.
- [ ] **Projeção explícita de colunas** em tabelas com dados sensíveis — nunca `SELECT *` em tabela com senha/token/segredo. No módulo user, só `findByUsernameOrEmail` retorna o hash.
- [ ] Rotas protegidas: `@Middleware(jwtMiddleware.validJWTNeeded.bind(jwtMiddleware), adminMiddleware.adminOnly.bind(adminMiddleware))` — nessa ordem. `adminOnly` exige **sessão admin elevada**: rota admin nova não precisa de nada além disso.
- [ ] Mutação administrativa → audite com `AdminService.audit({ ...auditActor(req, res), action, ... })` dentro do `withTransaction` ([[admin#Auditoria]]). Nunca coloque senha/token em `detail`.
- [ ] Endpoint que expõe configuração/informação do sistema → monte a resposta campo a campo; nunca devolva `env` inteiro (segredos).
- [ ] Rota aceita token de serviço? Lembre que qualquer token válido (user **ou** service) passa no `validJWTNeeded`. Se a rota é só para usuários, cheque `res.locals.jwt.type === "user"`.
- [ ] Violação de UNIQUE em corrida → `handleError` já converte `23505` em `409`; garanta que a tabela **tem** a constraint UNIQUE (o check no service é só UX).
- [ ] Endpoint sensível a brute-force → rate limiter dedicado.
- [ ] Nunca logue dados sensíveis (senha, token, documento) — logs de query registram só `paramCount`.

---

## Variáveis de ambiente de segurança

| Variável | Default | Papel |
| --- | --- | --- |
| `AUTHORIZATION` | — | `1` obrigatório em produção (boot falha sem) |
| `JWT_SECRET` | — | ≥ 32 chars (obrigatório em produção) |
| `JWT_EXPIRES_IN_SECONDS` | `900` (15 min) | TTL do access token de usuário |
| `REFRESH_TOKEN_EXPIRES_IN_SECONDS` | `604800` (7d) | TTL deslizante do refresh token (duração da sessão inativa) |
| `SERVICE_JWT_EXPIRES_IN_SECONDS` | `2592000` (30d) | TTL do token de serviço |
| `ADMIN_SESSION_IDLE_SECONDS` | `900` (15 min) | Elevação admin expira após esse tempo sem uso (deslizante) |
| `ADMIN_SESSION_MAX_SECONDS` | `28800` (8 h) | Teto absoluto da elevação admin desde o login admin |
| `CORS_ORIGINS` | vazio | Origens permitidas, separadas por vírgula |
| `COOKIE_DOMAIN` | vazio (host-only) | Domain do cookie de auth |
| `COOKIE_SAMESITE` | `lax` | `lax` · `strict` · `none` |
| `TRUST_PROXY` | `0` | Nº de proxies confiáveis (1 atrás de nginx) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | Limite global por IP |
| `RATE_LIMIT_LOGIN_WINDOW_MS` / `RATE_LIMIT_LOGIN_MAX` | `60000` / `5` | Limite do login e do login admin (só falhas) e do signup (sucesso + falha) |

---

## Outras defesas da base

- **Erro 5xx nunca vaza mensagem interna em produção** — handler final em `loaders/express.ts` responde genérico e loga; `handleError` idem ([[tratamento-de-erros]]).
- **Alertas Discord com throttle** — a mesma mensagem de erro só alerta 1x/min (`error.ts`); o log em arquivo registra todas as ocorrências. Evita flood provocado por atacante ou bug em loop.
- **`/api/system/health` não expõe o erro do driver** — mensagem crua (pode conter host/usuário do banco) vai só para o log; a resposta diz apenas `"database unreachable"`.
- **Container non-root** — Dockerfile roda com `USER bun`.
- **Dependências** — rode `bun audit` periodicamente; `form-data` é fixado via `overrides` no `package.json`.
- **Banco:** usuários `app_user` (DML) e `migration_user` (DDL) separados, SSL `verify-full` em produção — ver [[postgres]].

---

## Relacionado

- [[novo-modulo|Criar Novo Módulo]] — checklist geral
- [[auth|Módulo Auth]] — implementação de referência (cookie, tokens, logout)
- [[middlewares-auth|Middlewares de Autenticação]] — `jwtMiddleware`, `adminMiddleware`
- [[admin|Módulo Admin]] — sessão admin elevada, auditoria
- [[tratamento-de-erros|Tratamento de Erros]] — `handleError`, 23505, throttle Discord
- [[ciclo-de-vida|Ciclo de Vida]] — validações de boot
- [[postgres|Guia PostgreSQL]] — segurança do banco
