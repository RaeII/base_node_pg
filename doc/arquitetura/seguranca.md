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
> Os middlewares `jwtMiddleware`/`adminMiddleware` liberam tudo com `AUTHORIZATION=0`. Em produção isso é impossível por construção: o boot falha. Gere o secret com `openssl rand -base64 48`.

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
| `loginRateLimiter` | `POST /auth/login` | 5 falhas/min por IP | `skipSuccessfulRequests: true` — só tentativas **falhas** contam |

> [!tip] Endpoint novo sensível a brute-force?
> Login, reset de senha, verificação de código, etc. → crie um limiter dedicado no mesmo arquivo e aplique com `@Middleware(meuLimiter)`. Não confie só no limite global.

---

## CORS e cookie de autenticação

- **CORS:** origens vêm de `CORS_ORIGINS` (separadas por vírgula). Produção sem a variável = **nenhuma** origem cross-site (fail-closed). Dev sem a variável = `http://localhost:3000`.
- **Cookie `token_access`:** `httpOnly` + `secure` (produção) + `sameSite` de `COOKIE_SAMESITE` (default **`lax`** — bloqueia envio cross-site, defesa CSRF) + `domain` de `COOKIE_DOMAIN` (vazio = host-only, o mais restrito).

> [!warning] `COOKIE_SAMESITE=none` exige defesa CSRF própria
> Só use `none` se o front vive em **outro domínio** e não há alternativa. Nesse caso adicione token CSRF (double-submit) ou header customizado obrigatório nas mutações — o CORS **não** impede o envio de requests autenticadas cross-site, só a leitura da resposta.

Os atributos do cookie são centralizados em `authCookieOptions()` (`auth.controller.ts`) — o logout usa os mesmos atributos no `clearCookie` (obrigatório, senão o cookie não é removido).

---

## JWT

- Assinado e verificado com `algorithms: ["HS256"]` + `issuer: APP_NAME` fixos (evita confusão de algoritmo e tokens de outra app com o mesmo secret).
- **Dois tipos de token**, distinguidos pelo claim `type`:
  - `type: "user"` (login) — carrega `sub`, `userId`, `username`, `email`, `admin`. TTL `JWT_EXPIRES_IN_SECONDS` (default 7 dias).
  - `type: "service"` (`POST /auth/create-jwt`) — carrega só `name`. **Não tem claim `admin`**, então nunca passa no `adminMiddleware`. TTL `SERVICE_JWT_EXPIRES_IN_SECONDS` (default 30 dias).
- `adminMiddleware` só aceita `admin === true` **estrito** (boolean assinado pela própria app).

> [!warning] Não há revogação de token
> Desativar/rebaixar um usuário **não** invalida tokens já emitidos — eles valem até expirar. Por isso o TTL default é 7 dias (não 30). Se o projeto derivado precisar de revogação: TTL curto + refresh token, ou coluna `token_version` na tabela `user` checada no middleware.

---

## Autenticação (módulo user/auth)

Regras implementadas em `UserService.authenticate()` — **preserve-as ao adaptar o módulo**:

- **Anti-enumeração:** usuário inexistente, senha errada e usuário inativo respondem **todos** `401 "Credenciais inválidas"` — mesma mensagem, mesmo status.
- **Anti-timing:** quando o usuário não existe, compara contra `DUMMY_PASSWORD_HASH` — a resposta demora o mesmo que uma senha errada (sem isso, o tempo de resposta revela quais logins existem).
- **Senha:** bcrypt custo 12. Política: mínimo 8, **máximo 72** (bcrypt trunca silenciosamente acima de 72 bytes).
- **Normalização:** `username`/`email` são convertidos para minúsculas nos schemas de criação/atualização e no identifier do login (o banco compara case-sensitive).
- **Auditoria:** login com sucesso → `logger.info("Login success", { userId, ip })`; falha 401 → `logger.warn("Login failed", { ip })`; emissão de token de serviço → `logger.info("Service JWT issued", ...)`. Nunca logue senha, hash ou token.

---

## Regras para módulos novos (checklist de segurança)

Complementa o checklist de [[novo-modulo]]:

- [ ] **Todo input validado com Zod** — body com `parseSchema(schema, req.body)`; **path params também**: `const { id } = parseSchema(idParamsSchema, req.params)`. `Number(req.params.id)` cru vira `NaN` → erro do driver → 500 + alerta.
- [ ] Schemas de body com `.strict()` e `.max()` em toda string ([[schemas-zod]]).
- [ ] **SQL sempre parametrizado** (`$1`) — nunca concatene input. Campos dinâmicos (UPDATE parcial) só via whitelist de código, como em `user.database.ts`.
- [ ] **Projeção explícita de colunas** em tabelas com dados sensíveis — nunca `SELECT *` em tabela com senha/token/segredo. No módulo user, só `findByUsernameOrEmail` retorna o hash.
- [ ] Rotas protegidas: `@Middleware(jwtMiddleware.validJWTNeeded.bind(jwtMiddleware), adminMiddleware.adminOnly.bind(adminMiddleware))` — nessa ordem.
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
| `JWT_EXPIRES_IN_SECONDS` | `604800` (7d) | TTL do token de usuário |
| `SERVICE_JWT_EXPIRES_IN_SECONDS` | `2592000` (30d) | TTL do token de serviço |
| `CORS_ORIGINS` | vazio | Origens permitidas, separadas por vírgula |
| `COOKIE_DOMAIN` | vazio (host-only) | Domain do cookie de auth |
| `COOKIE_SAMESITE` | `lax` | `lax` · `strict` · `none` |
| `TRUST_PROXY` | `0` | Nº de proxies confiáveis (1 atrás de nginx) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | Limite global por IP |
| `RATE_LIMIT_LOGIN_WINDOW_MS` / `RATE_LIMIT_LOGIN_MAX` | `60000` / `5` | Limite do login (só falhas) |

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
- [[tratamento-de-erros|Tratamento de Erros]] — `handleError`, 23505, throttle Discord
- [[ciclo-de-vida|Ciclo de Vida]] — validações de boot
- [[postgres|Guia PostgreSQL]] — segurança do banco
