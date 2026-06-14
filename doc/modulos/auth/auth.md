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

Autentica e define o cookie JWT. **Sem** middleware de auth.

**Body** (`loginSchema`) — informe **exatamente um** identificador + senha:

```json
{ "login": "admin", "password": "senha123" }
```

- `login` (3–255), `email` (≤45, formato email) ou `username` (3–45) — **exatamente um** deles.
- `password` — obrigatório, 6–255.
- Schema é `.strict()` (rejeita campos extras) e valida via `superRefine` que apenas um identificador veio.

**Response 200:**

```json
{
  "data": {
    "id": 1, "username": "admin", "email": "admin@x.com",
    "is_active": true, "is_admin": true,
    "last_login_at": "2026-06-14T12:00:00.000Z",
    "created_at": "…", "updated_at": "…"
  },
  "expiresIn": 2592000
}
```

`expiresIn` é em **segundos** (30 dias). Define o cookie `token_access` (httpOnly; `secure`/`sameSite=none` em produção; `domain` `.example.com` em produção, `localhost` em dev).

**Erros:** `400` (validação), `401` (credenciais inválidas), `403` (usuário inativo).

**Payload do JWT (login):**

```typescript
{ sub: string, userId: number, username: string, email: string|null, admin: boolean }
// iat / exp gerados pelo jsonwebtoken
```

---

### POST `/api/auth/create-jwt`

Gera um JWT identificado por um nome — útil para autenticação service-to-service. Requer `jwtMiddleware` + `adminMiddleware`.

**Body** (`createJwtBodySchema`):

```json
{ "name": "nome-do-servico" }
```

**Response 200:**

```json
{ "accessToken": "eyJ...", "expiresIn": 2592000 }
```

Payload do JWT: `{ name }`.

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

> [!warning] `AUTHORIZATION=0` desliga a proteção
> Com `AUTHORIZATION=0` no `.env`, ambos os middlewares deixam passar sem verificar. Útil em dev — **nunca em produção**.

---

## Segurança

Proteções já aplicadas neste módulo:

- **Senha verificada com `await bcrypt.compare(...)`** — comparação real do hash (custo 12 rounds). Falha → `401` genérico, sem revelar se o identificador existe.
- **`JWT_SECRET` sem fallback inseguro** — o boot aborta se a variável não estiver definida (ver [[ciclo-de-vida]]); não há mais `"default_secret_key"`.
- **Cookie endurecido** — `httpOnly`, `secure` + `sameSite=none` em produção, `maxAge` em milissegundos coerente com a validade do token.
- **Leitura de cookie via `cookie-parser`** — registrado nos loaders pré-rota; sem ele `req.cookies` seria `undefined` e o JWT nunca seria lido. Ver [[middlewares-auth]].

> [!tip] Antes de produção
> Ajuste o `domain` do cookie em `auth.controller.ts` (placeholder `.example.com`) para o domínio real e mantenha `AUTHORIZATION=1`.

---

## Relacionado

- [[middlewares-auth|Middlewares de Autenticação]]
- [[usuarios|Módulo Usuários]] — `authenticate()` e `is_admin`
- [[schemas-zod|Schemas Zod]] — `loginSchema`, `createJwtBodySchema`
- [[tratamento-de-erros|Tratamento de Erros]] — `parseSchema`, `handleError`
