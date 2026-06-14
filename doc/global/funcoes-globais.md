---
title: Funções Globais
tags:
  - global
  - utils
  - reference
---

# Funções Globais

Catálogo de helpers reutilizáveis em **todo o projeto**, em [`src/shared/utils/`](../../src/shared/utils/) e `src/db/`. Importe por alias `@/…`. Ao iniciar um novo projeto a partir desta base, estas são as funções que você usa o tempo todo.

---

## Tabela rápida

| Função / símbolo | Import | Para quê |
| --- | --- | --- |
| `throwUser(msg, status?, issues?)` | `@/shared/utils/error` | Erro destinado ao usuário (sem log) |
| `throwInternal(msg, status?)` | `@/shared/utils/error` | Erro interno (log + Discord) |
| `parseSchema(schema, data)` | `@/shared/utils/error` | Valida com Zod ou lança `400` |
| `handleError(err, res)` | `@/shared/utils/error` | Resposta de erro padronizada (use no `catch`) |
| `AppError` | `@/shared/utils/error` | Classe de erro do projeto |
| `paginationMiddleware()` | `@/shared/utils/pagination` | Middleware que captura `page`/`limit` |
| `getPagination()` | `@/shared/utils/pagination` | Lê `{ page, limit, offset }` do contexto |
| `paginatedResponse(data, total)` | `@/shared/utils/pagination` | Monta resposta paginada |
| `createPaginatedSchema(item)` | `@/shared/utils/pagination` | Schema Zod paginado (Swagger) |
| `logger` | `@/shared/utils/logger` | Winston (rotação diária) |
| `sendDiscord` | `@/shared/utils/sendDiscord` | Alertas via webhook |
| `getDateTimeBr(date?)` | `@/shared/utils/getDateTimeBr` | Data/hora em `America/Sao_Paulo` |
| `getErrorMessage` / `getSuccessMessage` / `getErrorStatusCode` | `@/shared/utils/response_collection` | Mensagens e status codes padronizados |
| `query` / `readQuery` | `@/db/client` | Queries com retry e log sanitizado |
| `withTransaction` / `isInTransaction` | `@/db/transaction` | Transações com cleanup |
| `streamRows` | `@/db/stream` | Streaming de resultados grandes |
| `healthCheck` / `waitForDatabase` | `@/db/health` | Saúde e boot do banco |
| `getPoolMetrics` | `@/db/metrics` | Métricas dos pools |

---

## Erros — `error.ts`

Documentado em detalhe em [[tratamento-de-erros|Tratamento de Erros]].

```typescript
import { throwUser, throwInternal, parseSchema, handleError } from "@/shared/utils/error";

const data = parseSchema(createUserSchema, req.body);  // 400 + issues se inválido
if (!user) throwUser("Não encontrado", 404);           // vai ao cliente
throwInternal("Falha ao gravar");                      // genérico + log + Discord
// no catch do controller:
return handleError(err, res);
```

---

## Banco de dados — `src/db/*`

Documentado em [[camada-de-acesso|Camada de Acesso a Dados]]. Resumo:

```typescript
import { query, readQuery } from "@/db/client";
import { withTransaction } from "@/db/transaction";

await query("UPDATE \"user\" SET is_active = FALSE WHERE id = $1", [id]);
await readQuery("SELECT * FROM \"user\"");             // réplica de leitura
await withTransaction(() => service.doMultipleWrites(input));
```

---

## Paginação — `pagination.ts`

Página dedicada: [[paginacao|Paginação]].

---

## Observabilidade — `logger.ts` e `sendDiscord.ts`

Página dedicada: [[observabilidade|Observabilidade]].

---

## Data/hora BR — `getDateTimeBr.ts`

Retorna um objeto `moment` no fuso `America/Sao_Paulo`. É `async`.

```typescript
import { getDateTimeBr } from "@/shared/utils/getDateTimeBr";

const now = await getDateTimeBr();              // agora, em horário de Brasília
const d = await getDateTimeBr("2026-06-14");   // data específica
now.format("YYYY-MM-DD HH:mm");
```

> [!note] Usado nos alertas Discord
> `sendDiscord` usa `getDateTimeBr()` para carimbar data/hora local nas notificações.

---

## Mensagens e status — `response_collection.ts`

Coleções centralizadas de mensagens de erro/sucesso e um mapa de status HTTP.

```typescript
import { getErrorMessage, getSuccessMessage, getErrorStatusCode } from "@/shared/utils/response_collection";

getErrorMessage("notFound", "Usuário");   // "Registro não encontrado: Usuário"
getSuccessMessage("create", "Usuário");   // "Usuário criado com sucesso"
getErrorStatusCode("unauthorized");        // 401
```

`getErrorStatusCode` mapeia rótulos → códigos: `notFound`→404, `badRequest`→400, `unauthorized`→401, `forbidden`→403, default→500.

> [!tip] Convergir para `AppError`
> Para novos fluxos prefira `throwUser`/`throwInternal` (que já carregam status + mensagem). As coleções deste arquivo são úteis para padronizar textos reaproveitados; combine-as com `throwUser(getErrorMessage("notFound", "Pedido"), 404)`.

---

## Relacionado

- [[tratamento-de-erros|Tratamento de Erros]]
- [[paginacao|Paginação]]
- [[observabilidade|Observabilidade]]
- [[camada-de-acesso|Camada de Acesso a Dados]]
