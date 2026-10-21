---
title: Módulo Auth
tags:
  - modules
  - auth
  - jwt
---

# Módulo Auth

Autenticação de usuários com **access token curto + refresh token rotativo** (ambos em cookie httpOnly), **login com Google** (sem senha) e geração de tokens JWT de serviço.

**Pasta:** [`src/modules/auth/`](../../../src/modules/auth/) — `auth.controller.ts` (HTTP + cookies), `auth.service.ts` (sessão, rotação, reuso, Google), `auth.database.ts` (tabelas `auth_session` e `auth_identity`) + `schemas/auth.schema.ts`.

> [!note] Depende do módulo de usuários
> O login usa `UserService.authenticate()`; o signup reutiliza `UserController.createUser()` para criar usuário comum em transação. Ver [[usuarios|Módulo Usuários]].

---

## Modelo de sessão

| Cookie | Conteúdo | TTL | `path` |
| --- | --- | --- | --- |
| `token_access` | JWT HS256 (payload abaixo) | `JWT_EXPIRES_IN_SECONDS` (default **15 min**) | `/` |
| `token_refresh` | `<id da sessão>.<segredo>` opaco | `REFRESH_TOKEN_EXPIRES_IN_SECONDS` (default **7 dias**, deslizante) | `/api/auth` |

Ambos `httpOnly`, `secure` em produção, `sameSite`/`domain` de `authCookieOptions()`. O refresh só trafega para `/api/auth` (refresh e logout).

- Cada login/signup abre **uma linha** em `auth_session` (migration `0002_auth_session.sql`). Só o **SHA-256 do segredo** é gravado.
- Access vencido → a API responde `401` → o front chama `POST /auth/refresh` e repete a request.
- **Rotação:** cada refresh troca o segredo e renova o prazo. Sessão inativa por mais que o TTL do refresh morre.
- **Detecção de reuso:** segredo antigo da mesma sessão reapresentado = token vazado → a sessão inteira é revogada e o evento é logado (`Refresh token reuse detected`).
- **Concorrência:** `SELECT … FOR UPDATE` serializa renovações da mesma sessão; o segredo imediatamente anterior é aceito por **30 s** após a rotação (duas abas renovando juntas) e devolve só um novo access, sem novo refresh.
- **Revogação:** logout revoga a sessão; troca de senha e desativação revogam **todas** as sessões do usuário. O access já emitido vale até expirar (≤ 15 min).
- **Limpeza:** sessões expiradas/revogadas do usuário são apagadas no próximo login.
- **`sid`:** o access token carrega o id da sessão. É por ele que o `adminOnly` acha a sessão e valida a **elevação admin** (`auth_session.admin_expires_at`, aberta só pelo login admin, abaixo). Refresh preserva a elevação. Ver [[admin]].

---

## Endpoints

### POST `/api/auth/login`

Autentica, abre uma sessão e define os cookies `token_access` e `token_refresh`. **Sem** middleware de auth, mas com **rate limit dedicado** (`loginRateLimiter` — default 5 tentativas falhas/min por IP; ver [[seguranca]]).

**Body** (`loginSchema`) — informe **exatamente um** identificador + senha:

```json
{ "login": "admin", "password": "senha123" }
```

- `login` (3–255), `email` (≤45, formato email) ou `username` (3–45) — **exatamente um** deles.
- `password` — obrigatório, 6–255.
- Schema é `.strict()` (rejeita campos extras) e valida via `superRefine` que apenas um identificador veio.
- O identifier é normalizado para **minúsculas** antes da busca (username/email são salvos em minúsculas na criação).

**Response 200:**

```json
{
  "data": {
    "id": 1, "username": "admin", "email": "admin@x.com",
    "is_active": true, "is_admin": true,
    "last_login_at": "2026-06-14T12:00:00.000Z",
    "created_at": "…", "updated_at": "…"
  },
  "expiresIn": 900
}
```

`expiresIn` é o TTL do **access token** em segundos — `JWT_EXPIRES_IN_SECONDS` (default 15 min). Cookies conforme [[#Modelo de sessão]]: `httpOnly`, `secure` em produção, `sameSite` de `COOKIE_SAMESITE` (default `lax`), `domain` de `COOKIE_DOMAIN` (vazio = host-only).

**Erros:** `400` (validação), `401` (credenciais inválidas — mesma resposta para inexistente, senha errada e inativo, anti-enumeração), `429` (rate limit).

**Payload do JWT (login):**

```typescript
{ sub: string, sid: string /* id da sessão */, userId: number, username: string, email: string|null, type: "user" }
// iat / exp / iss gerados pelo jsonwebtoken (issuer = APP_NAME)
```

> [!note] Sem claim `admin`
> Permissão admin é checada **no banco** pelo `adminOnly` (via `sid`), nunca no token — claim ficaria velho até o token expirar. Ver [[admin#Modelo de acesso (step-up)]].

---

### POST `/api/auth/admin/login`

Login da **área administrativa** (step-up). Mesmo body e resposta do login; mesmo `loginRateLimiter` (bucket compartilhado por IP).

- Exige `is_admin` e `is_active`. **Não-admin recebe o mesmo `401 "Credenciais inválidas"`** de senha errada — não revela quem é admin (`authenticate({ requireAdmin: true })`).
- Sempre abre uma **sessão nova** com elevação admin, revogando a sessão anterior do navegador (cookie `token_refresh`, se houver) — anti session fixation. Revogação + criação + auditoria (`admin.login`) numa transação; o bcrypt fica fora dela.
- A elevação expira após `ADMIN_SESSION_IDLE_SECONDS` sem uso (default 15 min) ou `ADMIN_SESSION_MAX_SECONDS` após o login (default 8 h). Depois disso a sessão segue como usuário comum.
- Auditoria: `logger.info("Admin login success", { userId, ip })` / `logger.warn("Admin login failed", { ip })` + linha em `audit_log`.

**Erros:** `400` (validação), `401` (credenciais inválidas ou não-admin), `429` (rate limit).

---

### POST `/api/auth/signup`

Cria uma conta de usuário comum, abre uma sessão e define os cookies de sessão. **Sem** middleware de auth, mas com **rate limit dedicado** (`signupRateLimiter` — default 5 tentativas/min por IP; ver [[seguranca]]).

**Body** (`signupSchema`) — apenas campos públicos:

```json
{ "username": "maria", "email": "maria@x.com", "password": "senha1234" }
```

- `username` — obrigatório, 3–45, normalizado para minúsculas.
- `email` — obrigatório, ≤45, formato email, normalizado para minúsculas.
- `password` — obrigatório, 8–72.
- Schema é `.strict()` e rejeita `is_admin`, `is_active` ou qualquer campo extra.
- O servidor força `is_active: true` e `is_admin: false`; cadastro público nunca cria admin.

**Response 201:**

```json
{
  "data": {
    "id": 2, "username": "maria", "email": "maria@x.com",
    "is_active": true, "is_admin": false,
    "last_login_at": null,
    "created_at": "…", "updated_at": null
  },
  "expiresIn": 900
}
```

`expiresIn`, cookies e payload JWT seguem o mesmo padrão do login (`type: "user"`, `admin: false`, issuer `APP_NAME`).

**Erros:** `400` (validação), `409` (username/e-mail duplicado), `429` (rate limit).

---

### POST `/api/auth/google`

Login **e** cadastro com Google na mesma rota (mesmo padrão do cidoa — clicar em "entrar" ou "criar conta" faz o mesmo). Recebe o `credential` (ID token JWT) que o **Google Identity Services** (GIS) devolve no front. Sem middleware de auth; com `loginRateLimiter` (só falhas contam).

**Body** (`googleAuthSchema`, `.strict()`):

```json
{ "credential": "eyJ...ID_token_do_Google" }
```

Fluxo em `AuthService.authenticateWithGoogle()`:

1. **Verifica o ID token** com `google-auth-library` (`OAuth2Client.verifyIdToken`, `audience = GOOGLE_CLIENT_ID`): assinatura (JWKS do Google, cacheado), `aud`, `iss` e expiração. Nenhum campo do payload é confiável sem isso.
2. **Identidade Google já vinculada** (`auth_identity` `provider='google'`, `provider_account_id=<sub>`) → entra.
3. Senão, exige `email_verified=true`; **e-mail já tem conta** (ex.: cadastro por senha) → **vincula** o Google a ela e entra.
4. Senão (1º acesso) → **não cria nada**: devolve `registration_required` com `email` (verificado, não editável) e `username` **sugerido** (do nome do Google, sem acento, `[a-z0-9_]`; colisão → sufixo numérico). O usuário confirma em `POST /api/auth/google/register`.

Nos casos 2 e 3 abre sessão igual ao login (`createSession` + cookies `token_access`/`token_refresh`) e atualiza `last_login_at`.

**Response 200 — conta existente:** `{ "status": "authenticated", "data": PublicUser, "expiresIn": 900 }` + cookies.

**Response 200 — 1º acesso** (sem cookie):

```json
{
  "status": "registration_required",
  "registrationToken": "eyJ...",
  "expiresAt": "2026-10-21T12:15:00.000Z",
  "email": "maria@gmail.com",
  "username": "mariasilva"
}
```

`registrationToken` — JWT HS256 de 15 min, `type=registration`, `sub=<email>`, `gsub=<sub do Google>`, assinado com chave **derivada** do `JWT_SECRET` (HMAC com contexto) → nunca valida como token de sessão.

**Erros:** `400` (validação ou e-mail do Google não verificado), `401` (ID token inválido/expirado), `403` (conta desativada), `429` (rate limit), `500` (`GOOGLE_CLIENT_ID` ausente).

> [!important] Decisão: colisão de e-mail (Google × conta por senha)
> Se o e-mail do Google **já tem conta**, vinculamos em vez de duplicar (**uma pessoa = uma conta por e-mail**). Só é seguro porque o Google marca `email_verified=true`; sem isso, não vincula nem cria. A conta continua aceitando a senha antiga.

> [!note] Admin e conta sem senha
> Login com Google abre sessão **comum** — a área admin continua exigindo `POST /auth/admin/login` (senha, step-up). Conta criada pelo Google tem `password = NULL`: o login por senha compara contra o hash dummy e responde o mesmo `401`. Um admin pode definir senha via `PUT /api/user/:id`.

---

### POST `/api/auth/google/register`

Conclui o 1º acesso pelo Google. Com `signupRateLimiter`. **Body** (`googleRegisterSchema`, `.strict()`):

```json
{ "registrationToken": "eyJ...", "username": "mariasilva" }
```

- `registrationToken` — prova devolvida pelo `/auth/google`; e-mail e `sub` vêm do token assinado, nunca do body.
- `username` — obrigatório, 3–45, normalizado para minúsculas (mesma regra do signup).
- Em `withTransaction`: cria o usuário com `password = NULL`, `is_active = true`, `is_admin = false` + grava `auth_identity` (`google`, `<sub>`). As `UNIQUE` de `email`/`username` fecham corridas (`23505` → `409`).

**Response 201:** `{ "data": PublicUser, "expiresIn": 900 }` + cookies de sessão.

**Erros:** `400` (validação ou prova inválida/expirada — o front volta a pedir o Google), `409` (e-mail ou username em uso), `429` (rate limit).

> [!note] Fluxo escolhido: GIS ID token (sem client secret)
> Só `GOOGLE_CLIENT_ID` é necessário — o front usa o botão "Sign in with Google", recebe o ID token e faz `POST /auth/google`. Não usamos authorization-code (exigiria `GOOGLE_CLIENT_SECRET`) porque só autenticamos, não acessamos APIs do Google. No Google Console, registre a **origem** do front em *Origens JavaScript autorizadas* (ex.: `http://localhost:5173`); URI de redirecionamento não é usada.

---

### POST `/api/auth/refresh`

Troca o refresh token (cookie `token_refresh`) por um novo access token **e** um novo refresh token (rotação). Sem body e sem middleware de auth (o access normalmente já venceu). Roda em `withTransaction` com `SELECT … FOR UPDATE` na sessão.

**Response 200:** mesmo formato do login (`{ data, expiresIn }`) + cookies novos. Na janela de tolerância de 30 s (token anterior), só `token_access` é renovado.

**Erros:** `401 "Sessão expirada"` — cookie ausente/malformado, sessão inexistente, expirada ou revogada, reuso detectado ou usuário inativo. Todo `401` aqui **limpa os dois cookies**.

---

### GET `/api/auth/me`

Retorna `{ "data": PublicUser }` do usuário do access token, **lido do banco** (reflete `is_admin`/`is_active` atuais). Middleware `jwtMiddleware`; aceita só token `type: "user"`. O front chama no boot e quando a aba volta a ficar visível.

**Erros:** `401` — sem access token, access expirado (o front renova e repete), token de serviço ou usuário inativo.

---

### POST `/api/auth/logout`

Revoga no banco a sessão do cookie `token_refresh` (só se o segredo confere) e remove os dois cookies (`clearCookie` com os **mesmos atributos** do set, inclusive `path` — obrigatório para o browser aceitar a remoção). Sem middleware de auth; falha ao revogar não impede a limpeza dos cookies.

**Response 200:** `{ "message": "Logout realizado com sucesso" }`

> [!note] O access token vale até expirar
> O JWT de acesso não é revogável — um access copiado antes do logout vale por até `JWT_EXPIRES_IN_SECONDS` (15 min). Por isso ele é curto. Ver [[seguranca#JWT]].

---

### POST `/api/auth/create-jwt`

Gera um JWT **de serviço** identificado por um nome (service-to-service). Requer `jwtMiddleware` + `adminMiddleware`. Body validado com `parseSchema` e a emissão é auditada no log (`Service JWT issued`).

**Body** (`createJwtBodySchema`, `.strict()`):

```json
{ "name": "nome-do-servico" }
```

- `name` — obrigatório, 3–100 caracteres.

**Response 200:**

```json
{ "accessToken": "eyJ...", "expiresIn": 2592000 }
```

`expiresIn` vem de `SERVICE_JWT_EXPIRES_IN_SECONDS` (default 30 dias). Payload do JWT: `{ name, type: "service" }` — **sem `sid`**, então passa no `jwtMiddleware` mas nunca no `adminMiddleware`. Emissão auditada (`service_token.create`).

---

## Middlewares de Autenticação

Auxiliar deste módulo: [[middlewares-auth|Middlewares de Autenticação]] (`jwtMiddleware` e `adminMiddleware`) — usados aqui e no [[usuarios|módulo de usuários]].

```typescript
@Post("/create-jwt")
@Middleware(
  jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
  adminMiddleware.adminOnly.bind(adminMiddleware),
)
async createJWT(req, res) { ... }
```

> [!warning] `AUTHORIZATION=0` desliga a proteção — só em dev
> Com `AUTHORIZATION=0` no `.env`, ambos os middlewares deixam passar sem verificar. **Em produção o boot falha se `AUTHORIZATION != 1`** (fail-closed — ver [[seguranca]]).

---

## Segurança

Proteções aplicadas neste módulo (detalhes e racional em [[seguranca]]):

- **Anti-enumeração + anti-timing** — inexistente, senha errada e inativo respondem o mesmo `401`; usuário inexistente compara contra hash dummy para igualar o tempo de resposta.
- **Rate limit no login** — `loginRateLimiter`, conta só tentativas falhas.
- **Rate limit no signup** — `signupRateLimiter`, conta tentativas bem-sucedidas e falhas para reduzir criação abusiva de contas (também no `/auth/google/register`).
- **Login com Google** — ID token verificado pela lib oficial (`aud` = `GOOGLE_CLIENT_ID`); vínculo por e-mail só com `email_verified`; prova de cadastro assinada com chave derivada (não vira sessão). Ver [[#POST `/api/auth/google`]].
- **Cadastro público sem admin** — `signupSchema` não aceita flags administrativas e o controller força `is_admin: false`.
- **Login admin separado (step-up)** — reautenticação, sessão nova, timeout curto e validação no banco a cada request. Ver [[admin]].
- **JWT endurecido** — `algorithms: ["HS256"]` + `issuer` fixos na verificação; claim `type` distingue token de usuário e de serviço; `JWT_SECRET` mínimo de 32 chars validado no boot.
- **Cookies endurecidos** — `httpOnly`, `secure` em produção, `sameSite=lax` por default (defesa CSRF), host-only por default; refresh restrito a `path=/api/auth`. Atributos centralizados em `authCookieOptions()`.
- **Refresh token rotativo** — só o SHA-256 é gravado; rotação a cada uso; reuso revoga a sessão; logout, troca de senha e desativação revogam. Ver [[#Modelo de sessão]].
- **Auditoria** — sucesso/falha de login, sucesso de signup, login/cadastro com Google (`Login (google) success`, `Signup (google) success`), reuso de refresh token e emissão de token de serviço vão para o Winston (nunca senha/token).
- **Leitura de cookie via `cookie-parser`** — registrado nos loaders pré-rota; sem ele `req.cookies` seria `undefined` e o JWT nunca seria lido. Ver [[middlewares-auth]].

> [!tip] Antes de produção
> Rode as migrations `0002_auth_session.sql`, `0003_admin.sql` e `0004_google_auth.sql`, defina `GOOGLE_CLIENT_ID`, `CORS_ORIGINS`, avalie `COOKIE_DOMAIN`/`COOKIE_SAMESITE` e mantenha `AUTHORIZATION=1` (o boot exige). Checklist completo em [[seguranca]].

---

## Relacionado

- [[seguranca|Segurança]] — convenções globais (cookie, CORS, rate limit, JWT)
- [[middlewares-auth|Middlewares de Autenticação]]
- [[admin|Módulo Admin]] — sessão admin elevada e auditoria
- [[usuarios|Módulo Usuários]] — `authenticate()`, `createUser()` e `is_admin`
- [[schemas-zod|Schemas Zod]] — `loginSchema`, `signupSchema`, `googleAuthSchema`, `googleRegisterSchema`, `createJwtBodySchema`
- [[tratamento-de-erros|Tratamento de Erros]] — `parseSchema`, `handleError`
