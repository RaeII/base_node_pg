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
| Auth | JWT (cookie httpOnly) + bcrypt |
| Docs | Swagger UI / OpenAPI 3.0 (gerado dos decorators) |
| Observabilidade | Winston (rotação diária) + alertas Discord |

---

## Mapa da Documentação

### 🏛 Arquitetura

- [[estrutura|Estrutura do Projeto]] — árvore de pastas, camadas e fluxo de uma requisição
- [[decorators|Sistema de Decorators]] — `@Controller`/`@Route`, `@Get`, `@ApiBody` e Swagger automático
- [[ciclo-de-vida|Ciclo de Vida da Aplicação]] — bootstrap, loaders, watchdog e graceful shutdown
- [[tratamento-de-erros|Tratamento de Erros]] — `AppError`, `throwUser`, `throwInternal`, `handleError`

### 🗄 Banco de Dados

- [[camada-de-acesso|Camada de Acesso a Dados]] — `Database`, `query`/`readQuery`, `withTransaction`, streaming, health e métricas
- [[postgres|Guia PostgreSQL (produção)]] — pool, transações, segurança, PgBouncer, réplicas
- [[migrations|Migrations]] — runner customizado, convenções e checksum

### 📦 Módulos

- [[auth|Módulo Auth]] — login, cookie JWT, geração de token de serviço
- [[usuarios|Módulo Usuários]] — CRUD completo, paginação, soft delete
- [[sistema|Módulo Sistema]] — health check e métricas dos pools

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
> As rotas protegidas só são efetivamente bloqueadas quando `AUTHORIZATION=1` no `.env`. Com `AUTHORIZATION=0` os middlewares deixam passar — útil em dev, **nunca em produção**. Veja [[auth#Middlewares de Autenticação]].

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | — | Login → cookie `token_access` |
| `POST` | `/api/auth/create-jwt` | JWT + Admin | Gera JWT nomeado (service-to-service) |
| `GET` | `/api/user/` | JWT + Admin | Listar usuários (paginado) |
| `GET` | `/api/user/:id` | JWT + Admin | Buscar por ID |
| `POST` | `/api/user/` | JWT + Admin | Criar usuário (em transação) |
| `PUT` | `/api/user/:id` | JWT + Admin | Atualizar (parcial, em transação) |
| `DELETE` | `/api/user/:id` | JWT + Admin | Desativar (soft delete) |
| `GET` | `/api/system/health` | — | Health check em camadas (200/503 p/ probes K8s) |
| `GET` | `/api/system/metrics` | — | Stats dos pools `write` + `read` em JSON |
| `GET` | `/api-docs` | — | Swagger UI (apenas fora de produção) |
| `GET` | `/api-docs-json` | — | Spec OpenAPI 3.0 crua |

---

## Convenções do projeto

- **Camadas**: `Controller → Service → Database`. SQL só na camada Database. Veja [[estrutura]].
- **Schemas Zod**: sempre em `*.schema.ts`, nunca inline no controller. Veja [[schemas-zod]].
- **Erros**: `throwUser` (vai ao cliente) vs `throwInternal` (loga + Discord). Veja [[tratamento-de-erros]].
- **Transações**: mutações multi-tabela ficam dentro de `withTransaction(...)` no controller. Veja [[camada-de-acesso]].
- **Alias de import**: `@/*` aponta para `src/*` (configurado no `tsconfig.json`).
