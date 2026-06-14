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
| `user.controller.ts` | Rotas HTTP, validação, transações |
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

- **Criação:** valida unicidade de `username` e `email`; faz hash com `bcrypt` (12 rounds); `INSERT` com `{ noRetry: true }` (não-idempotente).
- **Atualização:** parcial — só os campos enviados; revalida unicidade ao trocar `username`/`email`; refaz o hash se a senha vier.
- **Soft delete:** marca `is_active = FALSE` (idempotente). Usuários inativos não aparecem nas listagens, mas os dados são preservados.
- **Saída pública:** `toPublicUser()` nunca retorna o campo `password`.

---

## Schemas Zod

Definidos em `schema/user.schema.ts` (ver [[schemas-zod]]):

| Schema | Uso |
| --- | --- |
| `createUserSchema` | Body de criação (`.strict()`) |
| `updateUserSchema` | Body de atualização (campos opcionais, `.strict()`) |
| `authenticateUserSchema` | Input de autenticação (usado pelo [[auth]]) |
| `publicUserSchema` | Usuário público (sem `password`) |
| `dbUserRowSchema` | Linha crua do banco |
| `userResponseSchema` / `createUserResponseSchema` | Respostas Swagger |
| `usersListResponseSchema` | Listagem paginada (`createPaginatedSchema(publicUserSchema)`) |
| `messageResponseSchema` / `validationErrorResponseSchema` | Mensagem / erro de validação |

---

## Relacionado

- [[auth|Módulo Auth]] — usa `UserService.authenticate()` no login
- [[paginacao|Paginação]] — `paginationMiddleware`, `paginatedResponse`
- [[camada-de-acesso|Camada de Acesso a Dados]] — `Database`, `withTransaction`, `{ noRetry }`
- [[novo-modulo|Criar Novo Módulo]] — use este módulo como referência
