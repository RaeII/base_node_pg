---
title: Middlewares de Autenticação
tags:
  - modules
  - auth
  - middleware
---

# Middlewares de Autenticação

Arquivo auxiliar do [[auth|Módulo Auth]]. São middlewares globais reutilizados por qualquer rota protegida.

**Arquivos:** [`src/shared/middlewares/jwt.middleware.ts`](../../../src/shared/middlewares/jwt.middleware.ts) e [`admin.middleware.ts`](../../../src/shared/middlewares/admin.middleware.ts).

---

## `jwtMiddleware.validJWTNeeded`

Valida o cookie `token_access` em rotas protegidas.

- Lê `req.cookies['token_access']`.
- Verifica a assinatura com `JWT_SECRET`.
- Coloca o payload decodificado em `res.locals.jwt`.
- Responde `403` se inválido/expirado, `401` se ausente.

São **instâncias de classe** — passe com `.bind`:

```typescript
@Middleware(jwtMiddleware.validJWTNeeded.bind(jwtMiddleware))
```

> [!warning] Depende de `AUTHORIZATION`
> Toda a verificação só roda quando `env.AUTHORIZATION` é truthy (`AUTHORIZATION=1`). Com `0`, o middleware chama `next()` direto — sem proteção. Use apenas em dev.

> [!note] Cookies já são parseados
> O middleware lê `req.cookies` — habilitado pelo `cookie-parser` registrado nos loaders pré-rota (ver [[ciclo-de-vida]]). Sem ele `req.cookies` seria `undefined`.

---

## `adminMiddleware.adminOnly`

Verifica se o usuário autenticado é administrador. Deve vir **depois** de `jwtMiddleware`.

- Se `AUTHORIZATION` não está habilitado → `next()` (não bloqueia).
- Lê `res.locals.jwt.admin` e aceita como admin: `true`, `1`, `"true"`, `"1"`, `"admin"`, `"yes"`.
- Caso contrário responde `403`.

```typescript
@Middleware(
  jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
  adminMiddleware.adminOnly.bind(adminMiddleware),
)
@Get("/admin-only")
async handler(req, res) { ... }
```

---

## Relacionado

- [[auth|Módulo Auth]] — login e payload do JWT
- [[decorators|Decorators]] — como `@Middleware` aplica a ordem
- [[usuarios|Módulo Usuários]] — todas as rotas usam estes middlewares
