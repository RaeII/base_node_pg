---
title: Estrutura do Projeto
tags:
  - architecture
  - structure
---

# Estrutura do Projeto

Árvore de diretórios e responsabilidade de cada camada da aplicação.

## Árvore de Diretórios

```
base_node_pg/
├── src/
│   ├── index.ts                          # Entry point — Express + graceful shutdown
│   ├── config/
│   │   └── index.ts                      # Variáveis de ambiente (.env)
│   ├── db/                               # Infraestrutura PostgreSQL (sem ORM)
│   │   ├── pool.ts                       # Pool com timeouts, SSL, application_name
│   │   ├── client.ts                     # query() — retry transiente, log sanitizado
│   │   ├── transaction.ts                # withTransaction com cleanup e retry 40001/40P01
│   │   ├── health.ts                     # healthCheck em camadas + waitForDatabase
│   │   ├── metrics.ts                    # getPoolMetrics (Prometheus/Datadog)
│   │   └── stream.ts                     # streamRows com pg-cursor
│   ├── modules/                          # Domínios da aplicação
│   │   ├── auth/
│   │   │   ├── auth.controller.ts        # Rotas de autenticação
│   │   │   └── schemas/
│   │   │       └── auth.schema.ts        # Schemas Zod do módulo auth
│   │   └── user/
│   │       ├── user.controller.ts        # Rotas CRUD de usuário
│   │       ├── user.service.ts           # Regras de negócio
│   │       ├── user.database.ts          # Acesso ao banco
│   │       └── schema/
│   │           └── user.schema.ts        # Schemas Zod do módulo user
│   └── shared/                           # Infraestrutura compartilhada
│       ├── core/
│       │   ├── Controller.ts             # Classe base dos controllers
│       │   ├── decorators.ts             # @Controller, @Get, @Post, @Middleware...
│       │   ├── registerControllers.ts    # Auto-registro no Express
│       │   ├── decorators/
│       │   │   └── swagger.decorators.ts # @ApiBody, @ApiResponse, @ApiTags...
│       │   └── swagger/
│       │       ├── swagger.generator.ts  # Gera spec OpenAPI 3.0
│       │       └── swagger.setup.ts      # Serve /api-docs
│       ├── infra/
│       │   └── database/
│       │       └── Database.ts           # Classe base de repositórios (delega para src/db/client.ts)
│       ├── loaders/
│       │   └── express.ts               # Middlewares globais (pre e post rotas)
│       ├── middlewares/
│       │   ├── jwt.middleware.ts         # Valida JWT do cookie
│       │   └── admin.middleware.ts       # Verifica claim admin
│       └── utils/
│           ├── error.ts                 # AppError, throwUser, throwInternal, parseSchema
│           ├── pagination.ts            # Middleware e helpers de paginação
│           ├── response_collection.ts   # Helpers de response
│           ├── logger.ts                # Winston
│           ├── sendDiscord.ts           # Alertas de erro via webhook
│           └── getDateTimeBr.ts         # Utilitário timezone BR
├── migrations/                          # SQL versionado — rodado pelo migration_user
├── scripts/
│   └── migrate.ts                       # Runner com lock_timeout agressivo
├── dev/                                 # Scripts de estudo de TypeScript/decorators
├── doc-base_node_pg/                    # Esta documentação (vault Obsidian)
├── .env.example                         # Template de variáveis de ambiente
├── package.json
├── tsconfig.json
├── nodemon.json
├── Dockerfile                           # Multi-stage (node:20-alpine)
└── docker-compose.yml                   # Serviço com rede externa "boring"
```

---

## Camadas da Aplicação

```mermaid
graph LR
    REQ[HTTP Request] --> MW[Middlewares\njwt · admin · pagination]
    MW --> CTRL[Controller\n@Controller @Get @Post]
    CTRL --> SVC[Service\nRegras de negócio]
    SVC --> DBCLS[Database Class\nSQL puro]
    DBCLS --> CLIENT[src/db/client.ts\nquery + retry]
    CLIENT --> POOL[(PostgreSQL Pool)]
    SVC -. transações .-> TX[withTransaction\nALS-based client]
    TX --> POOL

    CTRL --> SWAGGER[Swagger\nOpenAPI 3.0]
    CTRL --> ERR[Error Handler\nAppError]
    ERR --> LOG[Winston + Discord]
```

| Camada | Arquivo | Responsabilidade |
| --- | --- | --- |
| **Controller** | `*.controller.ts` | Entrada HTTP: valida input, delega ao Service, responde |
| **Service** | `*.service.ts` | Regras de negócio, orquestra chamadas ao Database |
| **Database** | `*.database.ts` | SQL puro — sem lógica de negócio, estende `Database` |
| **Schema** | `*.schema.ts` | Schemas Zod para validação e documentação Swagger |
| **Core** | `decorators.ts` | Metadados de rota e Swagger via `reflect-metadata` |
| **DB Infra** | `src/db/*` | Pool PostgreSQL, `withTransaction`, health, métricas, streaming |
| **Utils** | `error.ts` | Hierarquia de erros e handler centralizado |

---

## Fluxo de uma Requisição

1. Middlewares executam na ordem definida pelos decorators (paginação, JWT, admin)
2. Controller valida body com `parseSchema(schema, req.body)`
3. Para operações que mutam estado, controller envolve a chamada em `withTransaction(...)`
4. Service executa lógica, chama Database (`this.query(sql, params)`)
5. `Database.query` delega para `src/db/client.ts`, que:
   - Usa o `PoolClient` da transação ativa (via AsyncLocalStorage), se houver
   - Caso contrário, usa o `writePool` em autocommit
6. Resposta via `res.status(...).json(...)` ou helpers do `Controller`
7. Em erro dentro de `withTransaction`, ROLLBACK automático + `client.release(true)` se cliente envenenado

---

## Variáveis de Ambiente

| Variável | Descrição |
| --- | --- |
| `PORT` | Porta HTTP |
| `AUTHORIZATION` | `1` = JWT obrigatório · `0` = desabilitado (dev) |
| `JWT_SECRET` | Segredo para assinar/verificar tokens |
| `APP_NAME` | `application_name` enviado ao Postgres (visível em `pg_stat_activity`) |
| `DB_HOST` | Host do PostgreSQL |
| `DB_PORT` | Porta PostgreSQL (default `5432`) |
| `DB_NAME` | Nome do banco |
| `DB_APP_USER` | Usuário da aplicação (DML — não use o `migration_user` aqui) |
| `DB_APP_PASSWORD` | Senha do `app_user` |
| `DB_SSL` | `true` em produção → TLS com `rejectUnauthorized` |
| `DB_SSL_CA` | Conteúdo PEM da CA (obrigatório em produção para `verify-full`) |
| `DB_POOL_MAX` / `DB_POOL_MIN` | Tamanho do pool (default 16/2) |
| `DB_STATEMENT_TIMEOUT_MS` | Default 10 000 |
| `DB_QUERY_TIMEOUT_MS` | Default 12 000 — deve ser **maior** que `statement_timeout` |
| `DB_LOCK_TIMEOUT_MS` | Default 3 000 |
| `DB_IDLE_TX_TIMEOUT_MS` | `idle_in_transaction_session_timeout` — default 30 000 |
| `DB_IDLE_TIMEOUT_MS` / `DB_CONNECTION_TIMEOUT_MS` | Pool internals |
| `DB_MAX_LIFETIME_SECONDS` | Default 1 800 — NUNCA deixar em 0 |
| `DB_TIMEZONE` | Aplicado via startup packet (default `America/Sao_Paulo`) |
| `DISCORD_WEBHOOK` | URL do webhook para alertas de erros internos |

---

## Relacionado

- [[core/decorators|Sistema de Decorators]] — como `@Controller` e `@ApiBody` funcionam
- [[core/error-handling|Tratamento de Erros]] — `AppError` e `handleError`
- [[guides/schemas-zod|Schemas Zod]] — regra: nunca inline no controller
- [[modules/users|Módulo Usuários]] — exemplo completo de CRUD
