---
title: Paginação
tags:
  - global
  - utils
  - pagination
---

# Paginação

Helpers de paginação baseados em `AsyncLocalStorage` — os parâmetros fluem do middleware até a camada Database **sem** serem passados por argumento.

**Arquivo:** [`src/shared/utils/pagination.ts`](../../src/shared/utils/pagination.ts).

---

## Fluxo

```mermaid
graph LR
    MW["paginationMiddleware()\nlê page/limit"] -->|ALS.run| CTRL[Controller]
    CTRL --> SVC[Service]
    SVC -->|getPagination()| DB["Database\nLIMIT/OFFSET"]
    SVC -->|paginatedResponse(data, total)| RES[Response]
```

---

## `paginationMiddleware()`

Factory que retorna um middleware Express. Extrai e normaliza os query params e os guarda no ALS.

```typescript
@Get("/")
@Middleware(paginationMiddleware())
async findAll(req, res) { ... }
```

| Query param | Default | Limite |
| --- | --- | --- |
| `page` | `1` | mínimo `1` |
| `limit` | `20` | máximo `100` |

`offset` é derivado: `(page - 1) * limit`.

---

## `getPagination()`

Lê `{ page, limit, offset }` do contexto atual — em qualquer camada, sem parâmetros. Fora do contexto do middleware, retorna defaults (`page 1, limit 20, offset 0`).

```typescript
async findAll() {
  const { limit, offset } = getPagination();
  const result = await this.query(
    `SELECT *, COUNT(*) OVER () AS _total FROM "user"
       WHERE is_active = TRUE ORDER BY id LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  // ...
}
```

> [!tip] `COUNT(*) OVER ()`
> Traz o total no mesmo round-trip, sem uma segunda query de `COUNT`.

---

## `paginatedResponse(data, total)`

Monta o envelope com metadados de navegação (lê `page`/`limit` do ALS):

```typescript
return paginatedResponse(rows.map(toPublicUser), total);
```

```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8, "hasNext": true, "hasPrev": false }
}
```

---

## `createPaginatedSchema(itemSchema)`

Cria o schema Zod de resposta paginada para o Swagger, reutilizável com qualquer item:

```typescript
export const usersListResponseSchema = createPaginatedSchema(publicUserSchema);
```

---

## Relacionado

- [[usuarios|Módulo Usuários]] — uso real em `findAll`
- [[funcoes-globais|Funções Globais]] — catálogo
- [[schemas-zod|Schemas Zod]] — resposta paginada no Swagger
