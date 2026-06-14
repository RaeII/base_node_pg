---
title: Ciclo de Vida da Aplicação
tags:
  - architecture
  - bootstrap
  - shutdown
---

# Ciclo de Vida da Aplicação

Como a aplicação sobe, registra middlewares e desliga de forma graciosa. Implementado em [`src/index.ts`](../../src/index.ts) e [`src/shared/loaders/`](../../src/shared/loaders/).

---

## Bootstrap

```mermaid
graph TD
    START["startServer()"] --> PRE["initializePreRouteLoaders(app)"]
    PRE --> JWT{"JWT_SECRET definido?"}
    JWT -->|não| FAIL["throw — app não sobe"]
    JWT -->|sim| WAIT["waitForDatabase()"]
    WAIT --> MW["json + cors"]
    MW --> REG["registerControllers(app, /api, controllers)"]
    REG --> SWG["setupSwagger(...) (fora de produção)"]
    SWG --> POST["initializePostRouteLoaders(app) — 404 + error handlers"]
    POST --> LISTEN["app.listen(PORT)"]
    LISTEN --> WD["startPoolWatchdog()"]
```

Ordem garantida em `startServer()`:

1. **Pré-rota** (`initializePreRouteLoaders`):
   - valida `JWT_SECRET` (lança erro e impede o boot se ausente);
   - `waitForDatabase()` — espera o Postgres ficar disponível com backoff exponencial (1s→2s→…→30s, até 10 tentativas);
   - registra `express.json({ limit: '10mb' })`, `cookie-parser` (necessário p/ ler o cookie JWT) e `cors` (`credentials: true`, origin `http://localhost:3000`).
2. **Rotas**: `registerControllers(app, "/api", controllers)`.
3. **Swagger**: `setupSwagger(...)` — pulado em produção.
4. **Pós-rota** (`initializePostRouteLoaders`): handler 404 + handlers de erro do Express.
5. `app.listen(PORT)`.
6. `startPoolWatchdog()` — monitor periódico dos pools (ver [[observabilidade]]).

> [!warning] `waitForDatabase` antes do `listen`
> A app só passa a aceitar tráfego depois que o banco responde a `SELECT 1`. Em K8s/deploy isso evita servir requisições antes do banco estar pronto. O bootstrap recomendado é `waitForDatabase()` → migrations → `listen()` (rode as migrations no pipeline de deploy — ver [[migrations]]).

---

## Loaders

| Função | Arquivo | Papel |
| --- | --- | --- |
| `initializePreRouteLoaders(app)` | `loaders/index.ts` | Valida env, espera o banco, carrega middlewares pré-rota |
| `loadPreRouteMiddlewares(app)` | `loaders/express.ts` | `json` + `cookie-parser` + `cors` |
| `initializePostRouteLoaders(app)` | `loaders/index.ts` | Carrega handlers pós-rota |
| `loadPostRouteMiddlewares(app)` | `loaders/express.ts` | 404 → erro; tratamento de `UnauthorizedError`; handler final 500 |

---

## Graceful Shutdown

`pool.end()` sozinho não basta. O projeto separa **`drain`** (só fecha) de **`gracefulShutdown`** (decide o exit code).

```mermaid
graph TD
    SIG["SIGTERM / SIGINT"] --> GS["gracefulShutdown()"]
    GS --> DRAIN1["drain()"]
    DRAIN1 --> EXIT0["process.exit(0)"]
    UE["uncaughtException"] --> DRAIN2["drain()"]
    DRAIN2 --> EXIT1["process.exit(1)"]
    UR["unhandledRejection"] --> LOG["apenas loga"]
```

`drain()` executa, em ordem:

1. `stopPoolWatchdog()` — para o monitor.
2. `server.close()` — para de aceitar novas conexões HTTP.
3. `drainPool(10_000)` — fecha `writePool` + `readPool` com timeout de 10s (sem o timeout, `pool.end()` pode travar para sempre).

Handlers globais:

| Sinal/Evento | Ação | Exit code |
| --- | --- | --- |
| `SIGTERM` / `SIGINT` | `gracefulShutdown` → `drain` | `0` |
| `uncaughtException` | `drain` | `1` |
| `unhandledRejection` | apenas `logger.error` | — (não derruba o processo) |

> [!important] Por que `uncaughtException` sai com `1`
> Se ele chamasse `gracefulShutdown` (exit `0`), o orquestrador (K8s/systemd) veria saída limpa mesmo num crash e poderia não aplicar a política de restart. Por isso o handler chama `drain()` direto e força `exit(1)`.

> [!tip] Kubernetes
> Configure `terminationGracePeriodSeconds` maior que o timeout do `drainPool` (ex.: 60s) e um hook `preStop: sleep 5` para dar tempo ao kube-proxy de remover o pod do endpoint antes do `SIGTERM`. Detalhes em [[postgres#15. Graceful shutdown]].

---

## Relacionado

- [[estrutura|Estrutura do Projeto]] — onde cada loader vive
- [[camada-de-acesso|Camada de Acesso a Dados]] — `drainPool`, `waitForDatabase`
- [[observabilidade|Observabilidade]] — watchdog do pool e logger
