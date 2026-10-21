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

Boilerplate de API REST com **TypeScript + Express 5 + PostgreSQL**, executado com **Bun**. Roteamento por decorators, validação com Zod, Swagger automático e camada de banco sem ORM (`pg`).

> [!tip] Início rápido
> ```bash
> bun install
> cp .env.example .env      # preencha as variáveis
> bun dev                   # hot-reload em http://localhost:$PORT
> ```
> Detalhes em [[comandos|Comandos & Execução com Bun]].

> [!info] Para que serve este projeto
> É a **base para iniciar novos backends**. A documentação está organizada por objetivo (arquitetura, banco, módulos, funções globais, guias) justamente para que clonar e estender seja rápido e previsível.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Runtime / execução | **Bun** (compatível com Node.js ≥ 20 LTS) |
| Framework HTTP | Express 5 |
| Linguagem | TypeScript 5.3 (`strict`, decorators) |
| Validação | Zod v4 (`toJSONSchema` nativo) |
| Banco | PostgreSQL — `pg` (node-postgres, pool duplo write/read) |
| Auth | Access token JWT (15 min) + refresh token rotativo, ambos em cookie httpOnly (`sameSite=lax`) + bcrypt · login com Google (GIS ID token, `google-auth-library`) · sessão admin elevada (step-up) validada no banco |
| Segurança HTTP | helmet + rate limit (`express-rate-limit`) + CORS por env |
| Docs | Swagger UI / OpenAPI 3.0 (gerado dos decorators) |
| Observabilidade | Winston (rotação diária) + alertas Discord (com throttle) |

---

## Mapa da Documentação

### 🏛 Arquitetura

- [[estrutura|Estrutura do Projeto]] — árvore de pastas, camadas e fluxo de uma requisição
- [[decorators|Sistema de Decorators]] — `@Controller`/`@Route`, `@Get`, `@ApiBody` e Swagger automático
- [[ciclo-de-vida|Ciclo de Vida da Aplicação]] — bootstrap, loaders, watchdog e graceful shutdown
- [[tratamento-de-erros|Tratamento de Erros]] — `AppError`, `throwUser`, `throwInternal`, `handleError`
- [[seguranca|Segurança]] — fail-closed, rate limit, cookie/CORS, JWT, checklist para módulos novos ⚠️ **leia antes de criar módulos**

### 🗄 Banco de Dados

- [[camada-de-acesso|Camada de Acesso a Dados]] — `Database`, `query`/`readQuery`, `withTransaction`, streaming, health e métricas
- [[postgres|Guia PostgreSQL (produção)]] — pool, transações, segurança, PgBouncer, réplicas
- [[migrations|Migrations]] — runner customizado, convenções e checksum

### 📦 Módulos

- [[auth|Módulo Auth]] — login, login com Google, sessão (access + refresh rotativo), token de serviço
- [[usuarios|Módulo Usuários]] — CRUD completo, paginação, soft delete
- [[sistema|Módulo Sistema]] — health check e métricas dos pools
- [[admin|Módulo Admin]] — área administrativa: sessão admin elevada, painel, sistema, auditoria

### 🌐 Funções Globais

- [[funcoes-globais|Funções Globais]] — catálogo de helpers reutilizáveis em todo o projeto
- [[paginacao|Paginação]] — `paginationMiddleware`, `getPagination`, `paginatedResponse`
- [[observabilidade|Observabilidade]] — logger Winston e alertas Discord

### 📚 Guias

- [[comandos|Comandos & Execução com Bun]] — todos os comandos do dia a dia
- [[novo-modulo|Criar Novo Módulo]] — passo a passo completo
- [[schemas-zod|Schemas Zod]] — convenção: nunca inline no controller

---

## Endpoints

> [!warning] Autorização
> **JWT + Admin** = access token válido **e** sessão admin elevada (login em `/api/auth/admin/login`), checada no banco a cada request — ver [[admin]].
> As rotas protegidas só são efetivamente bloqueadas quando `AUTHORIZATION=1` no `.env`. Com `AUTHORIZATION=0` os middlewares deixam passar — útil em dev. **Em produção o boot falha se `AUTHORIZATION != 1`** (fail-closed — ver [[seguranca]]).

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | Rate limit | Login → cookies `token_access` + `token_refresh` |
| `POST` | `/api/auth/admin/login` | Rate limit | Login admin: reautentica, abre sessão nova **elevada** (15 min sem uso / 8 h máx.) |
| `POST` | `/api/auth/signup` | Rate limit | Cadastro de usuário comum com email obrigatório → cookies de sessão |
| `POST` | `/api/auth/google` | Rate limit | Login/cadastro com Google (ID token GIS) → cookies de sessão **ou** `registration_required` (1º acesso) |
| `POST` | `/api/auth/google/register` | Rate limit | Conclui o 1º acesso pelo Google (prova + username) → cria conta sem senha + cookies |
| `POST` | `/api/auth/refresh` | Cookie refresh | Renova a sessão (rotação do refresh token) |
| `GET` | `/api/auth/me` | JWT | Usuário da sessão (lido do banco) |
| `POST` | `/api/auth/logout` | — | Revoga a sessão e remove os cookies |
| `POST` | `/api/auth/create-jwt` | JWT + Admin | Gera JWT de serviço (`type: "service"`) |
| `GET` | `/api/user/` | JWT + Admin | Listar usuários (paginado, `?search=` e `?status=active\|inactive\|all`) |
| `GET` | `/api/user/:id` | JWT + Admin | Buscar por ID |
| `POST` | `/api/user/` | JWT + Admin | Criar usuário (em transação, auditado) |
| `PUT` | `/api/user/:id` | JWT + Admin | Atualizar (parcial, em transação, auditado) |
| `DELETE` | `/api/user/:id` | JWT + Admin | Desativar (soft delete, auditado) |
| `POST` | `/api/user/:id/revoke-sessions` | JWT + Admin | Encerrar todas as sessões do usuário (auditado) |
| `GET` | `/api/admin/me` | JWT + Admin | Admin da sessão elevada (403 sem elevação) |
| `GET` | `/api/admin/stats` | JWT + Admin | Números do painel (usuários, sessões) |
| `GET` | `/api/admin/system` | JWT + Admin | Saúde, runtime, banco e config de segurança efetiva |
| `GET` | `/api/admin/audit` | JWT + Admin | Trilha de auditoria (paginada) |
| `GET` | `/api/system/health` | — | Health check em camadas (200/503 p/ probes K8s) |
| `GET` | `/api/system/metrics` | — | Stats dos pools `write` + `read` em JSON |
| `GET` | `/api-docs` | — | Swagger UI (apenas fora de produção) |
| `GET` | `/api-docs-json` | — | Spec OpenAPI 3.0 crua |

---

## Convenções do projeto

- **Camadas**: `Controller → Service → Database`. SQL só na camada Database. Veja [[estrutura]].
- **Schemas Zod**: sempre em `*.schema.ts`, nunca inline no controller. Veja [[schemas-zod]].
- **Validação total de input**: body **e path params** via `parseSchema` (ex.: `idParamsSchema` para `:id`). Veja [[seguranca]].
- **Erros**: `throwUser` (vai ao cliente) vs `throwInternal` (loga + Discord, com throttle). Veja [[tratamento-de-erros]].
- **Transações**: mutações multi-tabela ficam dentro de `withTransaction(...)` no controller. Veja [[camada-de-acesso]].
- **Health do pool**: pool de leitura ainda não utilizado (`totalCount=0`) é saudável; só há saturação sem conexões ociosas quando ele já possui conexões.
- **Segurança**: checklist obrigatório para módulos novos em [[seguranca#Regras para módulos novos (checklist de segurança)]].
- **Alias de import**: `@/*` aponta para `src/*` (configurado no `tsconfig.json`).
