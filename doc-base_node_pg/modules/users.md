---
title: Módulo Usuários
tags:
  - modules
  - users
  - crud
---

# Módulo Usuários

CRUD completo com paginação, transações PostgreSQL (`withTransaction`) e soft delete.

---

## Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `user.controller.ts` | Rotas HTTP, validação de input |
| `user.service.ts` | Regras de negócio |
| `user.database.ts` | Queries SQL |
| `schema/user.schema.ts` | Schemas Zod |

---

## Endpoints

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| `GET` | `/api/user/` | JWT + Admin | Listar (paginado) |
| `GET` | `/api/user/:id` | — | Buscar por ID |
| `POST` | `/api/user/` | — | Criar usuário |
| `PUT` | `/api/user/:id` | — | Atualizar (parcial) |
| `DELETE` | `/api/user/:id` | — | Desativar (soft delete) |

---

## Paginação

`GET /api/user/` usa `paginationMiddleware()`.

**Query params:**

- `page` — número da página (default: `1`)
- `limit` — itens por página (default: `20`, max: `100`)

**Response:**

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

Paginação é armazenada no `AsyncLocalStorage` e acessada via `getPagination()` na camada Database — sem precisar passar parâmetros explicitamente entre camadas.

---

## Criação de Usuário

- Password hasheado com `bcrypt` (custo: 12 rounds)
- Verifica unicidade de `username` e `email` antes de inserir
- Retorna dados públicos sem o campo `password`

---

## Soft Delete

`DELETE /api/user/:id` marca `is_active = FALSE` no banco. O usuário não aparece em listagens mas os dados são preservados.

---

## Schemas Zod

Definidos em `schema/user.schema.ts`:

| Schema | Uso |
| --- | --- |
| `createUserSchema` | Validação do body de criação |
| `updateUserSchema` | Validação do body de atualização (campos opcionais) |
| `authenticateUserSchema` | Validação do body de login |
| `publicUserSchema` | Shape do usuário público (sem password) |
| `usersListResponseSchema` | Shape da listagem paginada |
| `dbUserRowSchema` | Shape do retorno raw do banco |

> [!tip] Veja [[guides/schemas-zod|Schemas Zod]] para a convenção de organização.

---

## Relacionado

- [[modules/auth|Módulo Auth]] — usa `UserService.authenticate()` no login
- [[guides/new-module|Criar Novo Módulo]] — use o módulo user como referência
- [[core/error-handling|Tratamento de Erros]] — `throwUser` para 404, `throwInternal` para falhas de banco
