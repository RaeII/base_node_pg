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
- Verifica assinatura com `JWT_SECRET` **restrita a `algorithms: ["HS256"]` + `issuer: APP_NAME`** — tokens de outra app (mesmo com o mesmo secret) ou com algoritmo trocado são rejeitados.
- Coloca o payload decodificado em `res.locals.jwt` — **mesmo com `AUTHORIZATION=0`** (só não bloqueia). Sem isso, `GET /auth/me` não saberia quem é o usuário em dev.
- Responde `401` se ausente, inválido ou expirado. **Nunca `403`** aqui: o front trata `401` como access vencido (renova via `POST /auth/refresh` e, se falhar, volta ao login); `403` é reservado a "autenticado, sem permissão" (ver `adminOnly`).

> [!note] Tokens de usuário E de serviço passam aqui
> Qualquer JWT válido (claim `type: "user"` ou `"service"`) é aceito. Se a rota é exclusiva de usuários, cheque `res.locals.jwt.type === "user"` no handler. Ver [[seguranca#JWT]].

São **instâncias de classe** — passe com `.bind`:

```typescript
@Middleware(jwtMiddleware.validJWTNeeded.bind(jwtMiddleware))
```

> [!warning] Depende de `AUTHORIZATION`
> O **bloqueio** só acontece quando `env.AUTHORIZATION` é truthy (`AUTHORIZATION=1`). Com `0`, o middleware decodifica o token se houver e chama `next()` sempre — sem proteção. Use apenas em dev: **em produção o boot falha se `AUTHORIZATION != 1`** (fail-closed, ver [[seguranca]]).

> [!note] Cookies já são parseados
> O middleware lê `req.cookies` — habilitado pelo `cookie-parser` registrado nos loaders pré-rota (ver [[ciclo-de-vida]]). Sem ele `req.cookies` seria `undefined`.

---

## `adminMiddleware.adminOnly`

Exige **sessão admin elevada** (aberta por `POST /auth/admin/login`), validada **no banco** a cada request. Deve vir **depois** de `jwtMiddleware`. É assíncrono (uma query).

- Lê `res.locals.jwt.sid` (só token `type: "user"`; token de serviço não tem `sid` → nunca passa).
- Uma única `UPDATE … RETURNING` em `auth_session` + `"user"` confere: sessão não revogada e não expirada, `admin_expires_at` no prazo, dentro do teto `ADMIN_SESSION_MAX_SECONDS` desde o login admin e usuário **ainda** `is_active` e `is_admin` — e já desliza o prazo de inatividade (`ADMIN_SESSION_IDLE_SECONDS`).
- Sucesso → `res.locals.adminId` (ator da auditoria; ver `auditActor(req, res)` no mesmo arquivo).
- Falha → **`403`** `"Acesso restrito: entre pela área administrativa"` (o usuário pode estar autenticado; falta a elevação). Erro de banco → `handleError`.
- Se `AUTHORIZATION` não está habilitado → `next()` (não bloqueia), mas `res.locals.adminId` continua preenchido quando há elevação.

> [!important] Não confie em claim de token para admin
> Rebaixar, desativar, trocar a senha ou encerrar as sessões corta o acesso **na hora** porque a checagem é no banco. Ver [[admin#Modelo de acesso (step-up)]].

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
- [[admin|Módulo Admin]] — sessão admin elevada
