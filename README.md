# 🚀 Base Node PG — Projeto Base para Backend

Boilerplate moderno e opinado para construir APIs RESTful com **TypeScript + Express 5 + PostgreSQL**, executado com **Bun**. Pensado para servir como ponto de partida de novos backends: arquitetura limpa e modular, roteamento por decorators, validação com Zod v4, Swagger automático, autenticação JWT e uma camada de banco resiliente (sem ORM).

> 📚 **Documentação completa** em [`doc/`](doc/index-doc.md) (vault Obsidian, organizado por objetivo).

---

## ✨ Principais Funcionalidades

- ⚡ **Express 5** com TypeScript `strict`
- 🥟 **Execução com Bun** (compatível com Node.js ≥ 20)
- 🎯 **Decorators customizados** para rotas, middlewares e documentação
- 📖 **Swagger automático** — gerado dos decorators + schemas Zod
- 🔐 **Autenticação JWT** em cookie `httpOnly` + middlewares de admin
- 🛡️ **Validação** com Zod v4 (entrada e saída)
- 🐘 **PostgreSQL sem ORM** — `pg` com pool duplo (write/read), transações, retry, streaming
- 🩺 **Observabilidade** — health check em camadas, métricas de pool, logs Winston e alertas Discord
- 📁 **Arquitetura modular** — organização por domínio (`modules`)

---

## 📦 Tecnologias

| Tecnologia | Versão | Uso |
|---|---|---|
| Bun | ≥ 1.3 | Runtime / execução |
| Node.js | ≥ 20 | Compatibilidade |
| TypeScript | ^5.3 | Linguagem |
| Express | ^5.2 | Framework HTTP |
| Zod | ^4.3 | Validação de schemas |
| pg (node-postgres) | ^8.13 | Driver PostgreSQL |
| pg-cursor | ^2.12 | Streaming de resultados |
| Swagger UI Express | ^5.0 | Documentação da API |
| jsonwebtoken | ^9.0 | Autenticação |
| cookie-parser | ^1.4 | Leitura do cookie JWT |
| bcrypt | ^6.0 | Hash de senhas |
| Winston | ^3.19 | Logs (rotação diária) |
| reflect-metadata | ^0.2 | Suporte a decorators |

---

## 🏁 Início Rápido

> **Pré-requisitos:** [Bun](https://bun.sh) instalado e um **PostgreSQL** acessível.

```bash
PROJECT=pixyou-back
# 1. Clonar o template em uma nova pasta
git clone git@github.com:RaeII/base_node_pg.git "$PROJECT"
cd "$PROJECT" || exit 1

# Começar um histórico git limpo
rm -rf .git
git init -b main
git add .
git commit -m "feat: init"

# 3. Criar o repositório no GitHub e subir automaticamente
gh repo create "$(basename "$PWD")" --private --source=. --push

# 5. Instalar dependências
bun install

# 6. Configurar variáveis de ambiente
cp .env.example .env      # preencha PORT, JWT_SECRET, DB_* etc.

# 7. Rodar em desenvolvimento (hot-reload)
bun dev
```

Build e produção:

```bash
bun run build     # tsc + tsc-alias → dist/
bun start         # NODE_ENV=production
```

Após iniciar, a API fica em `http://localhost:$PORT`. Swagger em `http://localhost:$PORT/api-docs` (apenas fora de produção).

---

## 🗂 Endpoints

> As rotas protegidas só são bloqueadas com `AUTHORIZATION=1`. Com `0` os middlewares liberam o acesso — use apenas em dev.

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Login → cookie `token_access` |
| `POST` | `/api/auth/create-jwt` | JWT + Admin | Gera JWT nomeado (service-to-service) |
| `GET` | `/api/user/` | JWT + Admin | Listar usuários (paginado) |
| `GET` | `/api/user/:id` | JWT + Admin | Buscar por ID |
| `POST` | `/api/user/` | JWT + Admin | Criar usuário (em transação) |
| `PUT` | `/api/user/:id` | JWT + Admin | Atualizar (parcial) |
| `DELETE` | `/api/user/:id` | JWT + Admin | Desativar (soft delete) |
| `GET` | `/api/system/health` | — | Health check (200/503 p/ probes K8s) |
| `GET` | `/api/system/metrics` | — | Métricas dos pools (JSON) |
| `GET` | `/api-docs` | — | Swagger UI |

---

## 📁 Estrutura de Pastas

```
src/
├── index.ts                            # Entry point — Express, watchdog, graceful shutdown
├── config/index.ts                     # env tipado (.env via dotenv)
├── db/                                 # Infraestrutura PostgreSQL (sem ORM)
│   ├── pool.ts                         # writePool + readPool, drainPool
│   ├── client.ts                       # query() / readQuery() — retry + log sanitizado
│   ├── transaction.ts                  # withTransaction (ALS) + cleanup
│   ├── health.ts · metrics.ts          # healthCheck / getPoolMetrics
│   ├── stream.ts                       # streamRows (pg-cursor)
│   └── watchdog.ts                     # alerta Discord em saturação do pool
├── modules/                            # Domínios da aplicação
│   ├── auth/                           # login, JWT
│   │   ├── auth.controller.ts
│   │   └── schemas/auth.schema.ts
│   ├── user/                           # CRUD de usuário
│   │   ├── user.controller.ts · user.service.ts · user.database.ts
│   │   └── schema/user.schema.ts
│   └── system/                         # health + metrics
│       ├── system.controller.ts
│       └── schemas/system.schema.ts
└── shared/
    ├── core/                           # Controller base, decorators, swagger, registro
    ├── infra/database/Database.ts      # Classe base de repositórios
    ├── loaders/                        # Bootstrap (json, cookie-parser, cors, error handlers)
    ├── middlewares/                    # jwt.middleware.ts, admin.middleware.ts
    └── utils/                          # error, pagination, logger, sendDiscord, getDateTimeBr…
migrations/                             # SQL versionado (rodado pelo migration_user)
scripts/migrate.ts                      # Runner com lock_timeout agressivo + checksum
doc/                                    # Documentação (Obsidian)
```

Cada módulo é **self-contained** (controller, service, database, schemas). Código compartilhado vive em `src/shared`; o acesso ao Postgres em `src/db`.

---

## 🎯 Sistema de Decorators

Rotas declarativas via decorators TypeScript — sem arquivos de rota separados. O decorator de rota é exportado como `Controller` e importado com alias `Route` para não colidir com a classe base `Controller`.

```typescript
import Controller from "@/shared/core/Controller";                          // classe base
import { Controller as Route, Get, Post, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags, ApiParam } from "@/shared/core/decorators/index";

@Route("/items")
@ApiTags("Itens")
class ItemController extends Controller {
  @Get("/:id")
  @ApiSummary("Buscar item", "Retorna um item pelo ID")
  @ApiParam("id", { type: "integer" })
  @ApiResponse(200, "Item encontrado", itemResponseSchema)
  async findById(req: Request, res: Response) { ... }
}
```

| Rota | Documentação (Swagger) |
|---|---|
| `@Controller(prefix)` / `@Route(prefix)`, `@Get` `@Post` `@Put` `@Patch` `@Delete`, `@Middleware(...)` | `@ApiTags`, `@ApiSummary`, `@ApiBody`, `@ApiResponse`, `@ApiParam` |

Detalhes em [`doc/arquitetura/decorators.md`](doc/arquitetura/decorators.md).

---

## 🔐 Autenticação

JWT assinado com `JWT_SECRET`, entregue em cookie `httpOnly` `token_access`. Dois middlewares (instâncias — use `.bind`):

```typescript
@Post("/")
@Middleware(
  jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
  adminMiddleware.adminOnly.bind(adminMiddleware),
)
async create(req: Request, res: Response) { ... }
```

- `jwtMiddleware` valida o cookie e popula `res.locals.jwt`.
- `adminMiddleware` exige a claim `admin`.

---

## 🐘 Banco de Dados (PostgreSQL, sem ORM)

Repositórios estendem `Database` e usam `this.query(...)`. Transações via `withTransaction`. Leitura em réplica via `readQuery`.

```typescript
await this.query(`SELECT * FROM "user" WHERE id = $1`, [id]);
await withTransaction(() => service.doMultipleWrites(input));
```

Pool com timeouts e SSL configuráveis, retry de transientes, health check em camadas e watchdog com alerta Discord. Guia completo em [`doc/banco-de-dados/`](doc/banco-de-dados/postgres.md).

### Migrations

```bash
bun run scripts/migrate.ts          # aplica pendentes
bun run scripts/migrate.ts status   # lista aplicadas vs pendentes
```

Convenções (prefixo numérico, imutabilidade, checksum) em [`migrations/README.md`](migrations/README.md).

---

## ⚙️ Comandos

| Ação | Comando |
|---|---|
| Instalar | `bun install` |
| Desenvolvimento | `bun dev` (hot-reload) |
| Build | `bun run build` |
| Produção | `bun start` |
| Migrations | `bun run scripts/migrate.ts [status]` |

---

## 📝 Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha. Principais:

```env
PORT=3003
AUTHORIZATION=1
JWT_SECRET=                 # obrigatório (a app não sobe sem ele)
APP_NAME=base_node_pg

# PostgreSQL
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=
DB_APP_USER=
DB_APP_PASSWORD=

# DDL (opcional; cai no app user em dev)
DB_MIGRATION_USER=
DB_MIGRATION_PASSWORD=

# SSL (produção: verify-full)
DB_SSL=false
DB_SSL_CA=

DISCORD_WEBHOOK=            # opcional — alertas de erro e saturação de pool
```

Lista completa e defaults do pool em [`doc/arquitetura/estrutura.md`](doc/arquitetura/estrutura.md#variáveis-de-ambiente).

---

## 🐳 Docker

```bash
docker compose up --build
```

A imagem usa `oven/bun`. Veja [`Dockerfile`](Dockerfile) e [`docker-compose.yml`](docker-compose.yml).
