---
title: Módulo Usuários
tags:
  - modules
  - users
  - crud
---

# Módulo Usuários

CRUD completo com paginação, transações PostgreSQL (`withTransaction`) e soft delete. É o **módulo de referência** para criar novos — ver [[novo-modulo]].

**Pasta:** [`src/modules/user/`](../../../src/modules/user/).

---

## Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `user.controller.ts` | Rotas HTTP, validação, transações; expõe `createUser()` para o signup do [[auth]] reaproveitar a criação |
| `user.service.ts` | Regras de negócio (unicidade, hash de senha) |
| `user.database.ts` | Queries SQL (estende `Database`) |
| `schema/user.schema.ts` | Schemas Zod (entrada, banco e resposta) |

---

## Endpoints

Todas as rotas exigem **JWT + Admin** (`AUTHORIZATION=1`). Tabela: `"user"`.

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/user/` | Listar ativos (paginado) |
| `GET` | `/api/user/:id` | Buscar por ID |
| `POST` | `/api/user/` | Criar (em `withTransaction`) |
| `PUT` | `/api/user/:id` | Atualizar parcial (em `withTransaction`) |
| `DELETE` | `/api/user/:id` | Desativar (soft delete, em `withTransaction`) |

As respostas de item vêm envelopadas em `{ "data": ... }`.

O path param `:id` é validado com `idParamsSchema` (`parseSchema(idParamsSchema, req.params)`) — inteiro positivo, senão `400`. **Nunca use `Number(req.params.id)` cru** (`NaN` chega ao driver PG e vira 500 + alerta). Ver [[seguranca]].

---

## Paginação

`GET /api/user/` usa `paginationMiddleware()` (ver [[paginacao]]).

**Query params:** `page` (default `1`) e `limit` (default `20`, máx `100`).

**Response:**

```json
{
  "data": [ { "id": 1, "username": "admin", "email": "…", "is_active": true, "is_admin": true, "last_login_at": null, "created_at": "…", "updated_at": null } ],
  "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8, "hasNext": true, "hasPrev": false }
}
```

> [!tip] Paginação transparente entre camadas
> Os parâmetros ficam no `AsyncLocalStorage` e são lidos via `getPagination()` direto na camada Database — sem precisar passar `limit`/`offset` por parâmetro. A query usa `COUNT(*) OVER ()` para trazer o total no mesmo round-trip.

---

## Regras de negócio (Service)

- **Criação:** valida unicidade de `username` e `email`; faz hash com `bcrypt` (12 rounds); `INSERT` com `{ noRetry: true }` (não-idempotente). `username`/`email` são normalizados para **minúsculas** no schema (unicidade case-insensitive na prática). O helper `UserController.createUser()` centraliza a transação para `POST /api/user/` e `POST /api/auth/signup`.
- **Senha:** mínimo 8, máximo **72** caracteres (bcrypt trunca silenciosamente acima de 72 bytes).
- **Atualização:** parcial — só os campos enviados; revalida unicidade ao trocar `username`/`email`; refaz o hash se a senha vier.
- **Corrida de unicidade:** o check no service é UX; quem garante é a constraint UNIQUE do banco. Se a corrida acontecer, o `23505` vira `409` no `handleError` ([[tratamento-de-erros]]).
- **Soft delete:** marca `is_active = FALSE` (idempotente). Usuários inativos não aparecem nas listagens, mas os dados são preservados.
- **Autenticação (`authenticate`)**: anti-enumeração + anti-timing — inexistente, senha errada e inativo respondem o mesmo `401`; hash dummy iguala o tempo de resposta. Ver [[seguranca#Autenticação (módulo user/auth)]].
- **Saída pública:** `toPublicUser()` nunca retorna o campo `password`.

> [!important] Hash de senha não circula pelas camadas
> O repositório projeta colunas explícitas (`USER_COLUMNS`, **sem** `password`) — nunca `SELECT *`. Só `findByUsernameOrEmail` (fluxo de login) retorna o hash, tipado como `DbUserAuthRow`.

---

## Schemas Zod

Definidos em `schema/user.schema.ts` (ver [[schemas-zod]]):

| Schema | Uso |
| --- | --- |
| `createUserSchema` | Body de criação (`.strict()`, senha 8–72, lowercase em username/email) |
| `updateUserSchema` | Body de atualização (campos opcionais, `.strict()`) |
| `idParamsSchema` | Path param `:id` (`z.coerce.number().int().positive()`) |
| `authenticateUserSchema` | Input de autenticação (usado pelo [[auth]]) |
| `publicUserSchema` | Usuário público (sem `password`) |
| `dbUserRowSchema` / `DbUserRow` | Linha do banco **sem** `password` (projeção `USER_COLUMNS`) |
| `DbUserAuthRow` | `DbUserRow` + `password` — exclusivo do fluxo de login |
| `userResponseSchema` / `createUserResponseSchema` | Respostas Swagger |
| `usersListResponseSchema` | Listagem paginada (`createPaginatedSchema(publicUserSchema)`) |
| `messageResponseSchema` / `validationErrorResponseSchema` | Mensagem / erro de validação |

---

## Relacionado

- [[auth|Módulo Auth]] — usa `UserService.authenticate()` no login e `UserController.createUser()` no signup
- [[paginacao|Paginação]] — `paginationMiddleware`, `paginatedResponse`
- [[camada-de-acesso|Camada de Acesso a Dados]] — `Database`, `withTransaction`, `{ noRetry }`
- [[novo-modulo|Criar Novo Módulo]] — use este módulo como referência
