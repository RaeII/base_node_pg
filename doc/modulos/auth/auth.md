---
title: Módulo Auth
tags:
  - modules
  - auth
  - jwt
---

# Módulo Auth

Autenticação de usuários e geração de tokens JWT.

**Pasta:** [`src/modules/auth/`](../../../src/modules/auth/) — `auth.controller.ts` + `schemas/auth.schema.ts`.

> [!note] Depende do módulo de usuários
> O login usa `UserService.authenticate()`. Ver [[usuarios|Módulo Usuários]].

---

## Endpoints

### POST `/api/auth/login`

Autentica e define o cookie JWT. **Sem** middleware de auth, mas com **rate limit dedicado** (`loginRateLimiter` — default 5 tentativas falhas/min por IP; ver [[seguranca]]).

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
  "expiresIn": 604800
}
```

`expiresIn` é em **segundos** — vem de `JWT_EXPIRES_IN_SECONDS` (default 7 dias). Define o cookie `token_access` via `authCookieOptions()`: `httpOnly`, `secure` em produção, `sameSite` de `COOKIE_SAMESITE` (default `lax`), `domain` de `COOKIE_DOMAIN` (vazio = host-only).

**Erros:** `400` (validação), `401` (credenciais inválidas — mesma resposta para inexistente, senha errada e inativo, anti-enumeração), `429` (rate limit).

**Payload do JWT (login):**

```typescript
{ sub: string, userId: number, username: string, email: string|null, admin: boolean, type: "user" }
// iat / exp / iss gerados pelo jsonwebtoken (issuer = APP_NAME)
```

---

### POST `/api/auth/logout`

Remove o cookie `token_access` (`clearCookie` com os **mesmos atributos** do set — obrigatório para o browser aceitar a remoção). Sem middleware de auth.

**Response 200:** `{ "message": "Logout realizado com sucesso" }`

> [!note] O token continua tecnicamente válido
> Logout só remove o cookie do navegador — não há revogação server-side. Ver [[seguranca#JWT]].

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

`expiresIn` vem de `SERVICE_JWT_EXPIRES_IN_SECONDS` (default 30 dias). Payload do JWT: `{ name, type: "service" }` — **sem claim `admin`**, então passa no `jwtMiddleware` mas nunca no `adminMiddleware`.

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
- **JWT endurecido** — `algorithms: ["HS256"]` + `issuer` fixos na verificação; claim `type` distingue token de usuário e de serviço; `JWT_SECRET` mínimo de 32 chars validado no boot.
- **Cookie endurecido** — `httpOnly`, `secure` em produção, `sameSite=lax` por default (defesa CSRF), host-only por default. Atributos centralizados em `authCookieOptions()`.
- **Auditoria** — sucesso/falha de login e emissão de token de serviço vão para o Winston (nunca senha/token).
- **Leitura de cookie via `cookie-parser`** — registrado nos loaders pré-rota; sem ele `req.cookies` seria `undefined` e o JWT nunca seria lido. Ver [[middlewares-auth]].

> [!tip] Antes de produção
> Defina `CORS_ORIGINS`, avalie `COOKIE_DOMAIN`/`COOKIE_SAMESITE` e mantenha `AUTHORIZATION=1` (o boot exige). Checklist completo em [[seguranca]].

---

## Relacionado

- [[seguranca|Segurança]] — convenções globais (cookie, CORS, rate limit, JWT)
- [[middlewares-auth|Middlewares de Autenticação]]
- [[usuarios|Módulo Usuários]] — `authenticate()` e `is_admin`
- [[schemas-zod|Schemas Zod]] — `loginSchema`, `createJwtBodySchema`
- [[tratamento-de-erros|Tratamento de Erros]] — `parseSchema`, `handleError`
