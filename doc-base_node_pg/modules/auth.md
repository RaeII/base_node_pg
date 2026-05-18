---
title: Módulo Auth
tags:
  - modules
  - auth
  - jwt
---

# Módulo Auth

Autenticação de usuários e geração de tokens JWT.

**Arquivo:** `src/modules/auth/auth.controller.ts`

---

## Endpoints

### POST `/api/auth/login`

Autentica um usuário e define o cookie JWT.

**Body:**

```json
{
  "identifier": "admin",
  "password": "senha123"
}
```

`identifier` aceita username **ou** email.

**Response 200:**

```json
{
  "user": { "id": 1, "username": "admin", "email": "...", "admin": true },
  "expiresIn": "30d"
}
```

Define cookie `token_access` (httpOnly, validade 30 dias).

**Erros:**
- `401` — Credenciais inválidas

---

### POST `/api/auth/create-jwt`

Gera um JWT identificado por um nome — útil para autenticação service-to-service.

Requer `jwtMiddleware` + `adminMiddleware`.

**Body:**

```json
{ "name": "nome-do-servico" }
```

**Response 200:**

```json
{ "token": "eyJ..." }
```

---

## Middlewares de Autenticação

### jwt.middleware.ts

Valida o cookie `token_access` em rotas protegidas.

```typescript
@Middleware(jwtMiddleware)
@Get("/rota-protegida")
async handler(req: Request, res: Response) { ... }
```

- Lê `req.cookies['token_access']`
- Verifica assinatura com `JWT_SECRET`
- Coloca payload decodificado em `res.locals.jwt`
- Retorna `403` se token inválido ou expirado

> [!warning] AUTHORIZATION=0
> Se `AUTHORIZATION=0` no `.env`, o middleware deixa passar sem verificar. Útil em dev — **nunca em produção**.

### admin.middleware.ts

Verifica se `res.locals.jwt.admin === true`. Deve ser usado **após** `jwtMiddleware`.

```typescript
@Middleware(jwtMiddleware, adminMiddleware)
@Get("/admin-only")
async handler(req: Request, res: Response) { ... }
```

---

## Payload do JWT

```typescript
{
  id: number
  username: string
  email: string
  admin: boolean
  // iat e exp gerados automaticamente pelo jsonwebtoken
}
```

---

## Relacionado

- [[modules/users|Módulo Usuários]] — `UserService.authenticate()` é chamado pelo login
- [[core/decorators|Decorators]] — como `@Middleware` funciona
- [[structure|Estrutura do Projeto]] — localização dos arquivos
