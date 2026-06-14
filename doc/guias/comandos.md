---
title: Comandos & Execução com Bun
tags:
  - guides
  - bun
  - commands
---

# Comandos & Execução com Bun

O projeto é executado com **Bun** (compatível com Node.js ≥ 20). Bun roda TypeScript diretamente — sem etapa de compilação no dev.

> [!info] Pré-requisitos
> [Bun](https://bun.sh) instalado (`bun --version`) e um PostgreSQL acessível com as variáveis do `.env` preenchidas (ver [[estrutura#Variáveis de Ambiente]]).

---

## Setup inicial

```bash
bun install            # instala dependências (usa bun.lock)
cp .env.example .env   # preencha PORT, JWT_SECRET, DB_* etc.
```

---

## Desenvolvimento

```bash
bun dev                # script "dev": hot-reload via nodemon (ts-node)
# alternativa nativa do Bun (watch direto, sem nodemon):
bun --watch src/index.ts
```

A API sobe em `http://localhost:$PORT`. Swagger em `http://localhost:$PORT/api-docs` (apenas fora de produção).

---

## Build & produção

```bash
bun run build          # tsc + tsc-alias → dist/
bun start              # NODE_ENV=production, roda dist/index.js
```

> [!note] Bun também roda o fonte direto
> Em produção você pode rodar `NODE_ENV=production bun src/index.ts` sem build. O fluxo `build` + `start` continua disponível para ambientes que esperam artefato compilado em `dist/`.

---

## Migrations

```bash
bun run scripts/migrate.ts          # aplica migrations pendentes
bun run scripts/migrate.ts status   # lista aplicadas vs pendentes + checksum
```

Detalhes e convenções em [[migrations]].

---

## Referência: scripts do `package.json`

| Script | Comando | Observação |
| --- | --- | --- |
| `dev` | `nodemon` | hot-reload (ts-node) |
| `build` | `tsc && tsc-alias` | compila para `dist/` |
| `start` | `node dist/index.js` | produção (após build) |
| `migrate` | `node -r ts-node/register scripts/migrate.ts` | equivalente a `bun run scripts/migrate.ts` |
| `migrate:status` | `… scripts/migrate.ts status` | idem, com `status` |

Rode qualquer um com `bun run <script>` (ex.: `bun run build`). Para os scripts que invocam `node -r ts-node/register`, chamar o arquivo direto com `bun run scripts/migrate.ts` é mais simples.

---

## Docker

```bash
docker compose up --build   # usa Dockerfile + .env (rede externa "boring")
```

> [!warning] Dockerfile usa yarn
> O `Dockerfile`/`docker-compose.yml` atuais ainda referenciam `yarn`. Ao adotar Bun de ponta a ponta, atualize o `Dockerfile` para `oven/bun` (`bun install --frozen-lockfile`, `bun run build`, `bun start`).

---

## Relacionado

- [[ciclo-de-vida|Ciclo de Vida]] — o que acontece no boot
- [[migrations|Migrations]] — runner de migrations
- [[novo-modulo|Criar Novo Módulo]]
