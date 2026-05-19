---
title: Base Node PG — Documentação
tags:
  - index
  - base-node
aliases:
  - Home
  - Índice
---

# Base Node PG

Boilerplate de API REST com **Node.js 20 + Express 5 + TypeScript**, com roteamento via decorators, validação Zod, Swagger automático e PostgreSQL.

> [!tip] Início rápido
> Configure o `.env` a partir do `.env.example` e rode `bun dev`.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Runtime | Node.js 20 LTS |
| Framework | Express 5 |
| Linguagem | TypeScript 5.3 (strict) |
| Validação | Zod v4 |
| Banco | PostgreSQL — `pg` (node-postgres, pool) |
| Auth | JWT + bcrypt (12 rounds) |
| Docs | Swagger UI / OpenAPI 3.0 |
| Logger | Winston + alertas Discord |

---

## Documentação

### Arquitetura

- [[structure|Estrutura do Projeto]] — árvore de pastas e responsabilidades por camada
- [[core/decorators|Sistema de Decorators]] — `@Controller`, `@Get`, `@ApiBody`, Swagger automático
- [[core/error-handling|Tratamento de Erros]] — `AppError`, `throwUser`, `throwInternal`

### Banco de Dados

- [[postgres-config|Guia PostgreSQL]] — pool, transações, segurança, PgBouncer, graceful shutdown
- [`migrations/README.md`](../migrations/README.md) — convenções de migrations SQL versionadas

### Módulos

- [[modules/auth|Módulo Auth]] — login, JWT, cookie httpOnly
- [[modules/users|Módulo Usuários]] — CRUD completo, paginação, soft delete

### Guias

- [[guides/schemas-zod|Schemas Zod]] — convenção: nunca inline no controller
- [[guides/new-module|Criar Novo Módulo]] — passo a passo completo

---

## Endpoints

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | — | Login e geração de JWT |
| `POST` | `/api/auth/create-jwt` | JWT + Admin | JWT para serviços |
| `GET` | `/api/user/` | JWT + Admin | Listar usuários (paginado) |
| `GET` | `/api/user/:id` | — | Buscar por ID |
| `POST` | `/api/user/` | — | Criar usuário |
| `PUT` | `/api/user/:id` | — | Atualizar usuário |
| `DELETE` | `/api/user/:id` | — | Desativar (soft delete) |
| `GET` | `/api/system/health` | — | Health check em camadas (200/503 para K8s probes) |
| `GET` | `/api/system/metrics` | — | Pool stats em JSON (`write` + `read`) |
| `GET` | `/api-docs` | — | Swagger UI |

---

## Observabilidade (sem custo)

- **`/api/system/health`** → liveness/readiness probes (HTTP 200 = ok, 503 = degradado/down)
- **`/api/system/metrics`** → JSON consumível por qualquer ferramenta gratuita (Grafana Cloud free, Uptime Kuma, scraper bash)
- **Watchdog Discord** → alerta automático via `DISCORD_WEBHOOK` quando o pool satura (`src/db/watchdog.ts`)

Detalhes em [[postgres-config|Guia PostgreSQL]] §11–12.

---

## Comandos

```bash
bun dev                  # desenvolvimento com hot-reload (nodemon)
bun run build            # compila TypeScript → dist/
bun start                # produção (NODE_ENV=production)
npm run migrate          # aplica migrations pendentes (lock_timeout='2s' agressivo)
npm run migrate:status   # lista aplicadas vs pendentes
```
