---
title: Guia PostgreSQL — Node.js + TypeScript
tags:
  - database
  - postgresql
  - production
aliases:
  - postgres
  - pg config
---

# Guia rápido: PostgreSQL com Node.js + TypeScript (sem ORM)

Configurações essenciais para usar `pg` (node-postgres) em produção com alta concorrência e segurança. Foco em decisões, não em código.

> [!info] Versões mínimas
> Node.js ≥ 20 LTS, `pg` ≥ 8.13.

---

## 1. Instalação

Instale `pg` e `@types/pg`. Complementos recomendados: `dotenv`, `zod` (validação), `pino` (logs), `pg-cursor` (streaming).

---

## 2. Variáveis de ambiente

Credenciais sempre em `.env` (no `.gitignore`) ou secret manager (AWS Secrets Manager, Vault, Doppler). Mantenha um `.env.example` versionado como template.

Variáveis essenciais: host, porta, banco, usuário, senha, configurações de SSL, parâmetros do pool, timeouts, e `APP_NAME` para identificação no `pg_stat_activity`.

---

## 3. Configuração do Pool

O pool é o componente que mais quebra em produção. Cinco armadilhas comuns:

1. **`query_timeout` igual a `statement_timeout`** cria race condition entre cancelamento server-side e desistência client-side. Regra: `query_timeout > statement_timeout` (ex: 12s vs 10s).
2. **Faltar `lock_timeout`** deixa queries esperando lock indefinidamente. Configure 2–3s no `PoolConfig` (nunca no `postgresql.conf` — afeta todas as sessões).
3. **`SET` no evento `connect`** quebra com PgBouncer em transaction mode. Use o parâmetro `options` (startup packet) para configurações de sessão como timezone.
4. **`maxLifetimeSeconds` default é `0`** (sem limite). Defina explicitamente (ex: 30 min) — evita conexões zumbi e ajuda balanceadores como Aurora.
5. **Sem `ALTER USER ... CONNECTION LIMIT`** no banco, uma app vazando conexões consome todo o `max_connections`.

**Parâmetros que devem estar no `PoolConfig`:** `max`, `min`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `maxLifetimeSeconds`, `statement_timeout`, `query_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `application_name`, `keepAlive`, `options`, `ssl`.

> [!warning] Sempre registre `pool.on('error')`
> Sem isso, qualquer erro em client ocioso derruba o processo.

### Defaults recomendados para alta concorrência (≥10k usuários)

| Parâmetro | Valor | Por quê |
| --- | --- | --- |
| `connectionTimeoutMillis` | **2 s** (não 5 s) | Fila de 5 s sob picos causa thundering herd; fail-fast aciona circuit breaker antes |
| `idle_in_transaction_session_timeout` | **15 s** (não 30 s) | Tx ociosa por 30 s segura locks e provoca efeito cascata; 15 s mantém margem mas reduz dano |
| `lock_timeout` | 2–3 s | Sob contenção alta pode cair para 1–2 s |
| `maxLifetimeSeconds` | 1800 | Recicla conexões antes de balanceadores (Aurora, PgBouncer) as cortarem |

### 3.1 Dimensionamento do pool

Use abordagem orçamentária, não a fórmula `cores × 2 + spindles`:

```
pool_max_por_instância = (max_connections × 0.8 − reservas) ÷ num_instâncias
```

Exemplo: `max_connections=200`, 40 para admin/replicas, 30 para workers → 130 disponíveis ÷ 8 pods = `max=16` por instância.

**Regras práticas:**

- Pool pequeno é melhor que grande. Pool é backpressure, não capacidade.
- Queries rápidas (< 50ms): 15 conexões servem muito tráfego.
- Queries lentas: aumentar pool **piora** o banco.
- Acima de ~50 por instância, o gargalo vira o banco.

**Sinais de mal dimensionamento:** `waitingCount > 0` recorrente (pool pequeno ou queries lentas), `idle/total ≈ 1` o tempo todo (grande demais), erros de connection timeout (insuficiente).

### 3.2 `Pool` vs `PoolClient`

- **`pool.query()` direto:** queries autocommit simples. Cada chamada pode usar uma conexão diferente.
- **`pool.connect()` (retorna `PoolClient`):** transações, advisory locks, cursors, ou qualquer estado de sessão entre statements. Esquecer `release()` vaza conexão e satura o pool em minutos.

---

## 4. Wrapper de queries

Encapsule `pool.query` para adicionar:

- **Log sanitizado:** NUNCA logue `params` — podem conter senhas, tokens, CPF. Logue apenas o tamanho do array.
- **Slow query log:** loga queries acima de um threshold configurável (ex: 500ms).
- **Retry para erros transientes:** classes `08*` (Connection Exception), `57P03` (cannot_connect_now), `40001`/`40P01` (raros em autocommit mas possíveis), e erros de socket Node.js (`ECONNRESET`, `ECONNREFUSED`, `EPIPE`). Use backoff exponencial com jitter.

> [!warning] Retry em escrita autocommit
> Retry só é seguro se a query for **idempotente** (`UPDATE ... WHERE id`, `DELETE`, `INSERT ... ON CONFLICT DO NOTHING`). Para `INSERT` simples ou updates baseados em contadores, desabilite retry.

---

## 5. Queries parametrizadas

> [!danger] Regra absoluta
> Use sempre placeholders `$1, $2`. Nunca concatene input na string SQL.

**Listas dinâmicas (IN):** use `ANY($1::int[])` com array.

**Identificadores dinâmicos** (nome de tabela/coluna — não podem ser parametrizados): use whitelist com validação em runtime, não só TypeScript. TS protege em compile-time, mas `req.query.sort` é `string` arbitrária em runtime.

---

## 6. Transações com retry e cleanup

Três regras críticas:

1. **`client.release(true)` no caminho de erro.** Quando uma transação falha, o cliente pode estar envenenado (transação não-rollbacked, ROLLBACK que também falhou, erro de conexão). Devolver com `release()` simples espalha o problema para o próximo request. `release(true)` destrói o cliente em vez de devolvê-lo ao pool.

2. **`BEGIN ISOLATION LEVEL X` em uma round trip** em vez de `BEGIN` + `SET TRANSACTION` em duas.

3. **Retry para `40001` (serialization) e `40P01` (deadlock)** com backoff exponencial + jitter. **Importante:** deadlock pode ocorrer em qualquer isolation level, inclusive READ COMMITTED. Default de retries: 3 para SERIALIZABLE, 2 para os demais.

### Idempotência em transações retryáveis

> [!warning] A função passada para `withTransaction` pode ser executada mais de uma vez
> - **Não envie email/SMS, não chame API externa, não publique em fila dentro da função.** Esses efeitos vão acontecer múltiplas vezes em caso de retry.
> - **Não dependa de timestamps capturados antes do BEGIN.**
> - **Pattern recomendado: outbox.** Escreva o evento numa tabela `outbox` dentro da transação. Um worker separado consome a outbox e dispara efeitos colaterais com deduplicação.

### Cleanup correto

Distinguir dois tipos de erro no `catch`:

- **Fatal de conexão** (classes SQLSTATE `08*`, `57P0*`, ou erros de socket): NÃO tente ROLLBACK, marque o cliente para destruição.
- **Outros erros:** tente ROLLBACK; se o próprio ROLLBACK falhar, também marque para destruição.

No `finally`, sempre `client.release(destroyClient)`.

---

## 7. Validação de input

Mesmo com queries parametrizadas, valide com Zod antes de chegar ao banco. **Sempre use `.max()` em strings** — strings sem limite são vetor de ataque (memória, índices, payloads gigantes).

---

## 8. Usuário do banco com privilégios mínimos

**Dois usuários distintos:**

- **`migration_user`:** executa DDL (CREATE, ALTER, DROP). Permissões amplas no schema.
- **`app_user`:** apenas DML (SELECT, INSERT, UPDATE, DELETE). Sem `SUPERUSER`, sem `CREATEDB`.

Defina `CONNECTION LIMIT` em cada um.

### Gotcha crítica: `ALTER DEFAULT PRIVILEGES`

> [!danger] FOR ROLE obrigatório
> Default privileges só se aplicam a objetos criados pelo role indicado em `FOR ROLE`. Se as migrações rodam com `migration_user`, esse é o role que precisa estar no `FOR ROLE` — não o usuário atual da sessão. Esquecer isso significa que novas tabelas não vão herdar permissões para `app_user`, e você descobre quando uma feature nova quebra em produção.

### Autenticação

Use `scram-sha-256`, nunca `md5`. Default em PG ≥ 14, mas confirme com `SHOW password_encryption`. No `pg_hba.conf`, use `scram-sha-256` em todas as linhas de aplicação.

---

## 9. Migrações sem ORM

SQL versionado em `migrations/`, executado em ordem, rodando com `migration_user` **antes** do deploy da aplicação. Opções: `node-pg-migrate`, `dbmate`, ou runner customizado (este projeto usa o último).

### Runner customizado no projeto

`scripts/migrate.ts` — standalone, sem dependência nova. Características:

- **Aplica `SET lock_timeout='2s' + statement_timeout='60s'`** antes de cada migração.
- **Retry com backoff exponencial** quando `55P03` (`lock_not_available`).
- **Cleanup correto:** `client.release(true)` em erros fatais de conexão; ROLLBACK + retry para os demais.
- **Checksum SHA-256** detecta migrações já aplicadas que foram editadas — aborta antes de corromper o histórico.
- **Tabela de controle `schema_migrations`** criada automaticamente.
- **Conecta com `DB_MIGRATION_USER`** (cai no `DB_APP_USER` em dev, sem precisar de role separado).

**Convenção de nomes:** prefixo numérico (`0001_init.sql`, `0002_add_users.sql`) — execução em ordem lexicográfica.

**Comandos:**

```bash
npm run migrate          # aplica migrações pendentes
npm run migrate:status   # lista aplicadas vs pendentes; alerta checksum mismatch
```

> [!warning] Migrações são imutáveis
> Depois de aplicada, **não edite** o arquivo SQL. Crie um novo arquivo (`0002_alter_users.sql`). O runner aborta com erro se detectar checksum diferente.

Convenções completas (idempotência, operações destrutivas, exemplo, tabela `schema_migrations`) em [`migrations/README.md`](../migrations/README.md).

### `lock_timeout` agressivo em migrações

DDL precisa de `AccessExclusiveLock`. Se houver transação ativa segurando lock, a migração espera — e enquanto espera, **todas as queries seguintes na tabela enfileiram atrás dela**, derrubando o banco.

Solução: toda migração de DDL deve começar com `SET lock_timeout = '2s'` (mais agressivo que runtime normal) e `SET statement_timeout = '60s'` (DDL pode ser mais longo). O runner já aplica isso automaticamente — não repita no SQL da migração.

---

## 10. Streaming de resultados grandes

Use `pg-cursor` para queries que retornam muitos registros. Carregar tudo em memória causa OOM.

> [!warning] Cleanup em streaming
> Mesma regra da seção 6 — `client.release(true)` no caminho de erro, incluindo erro no `cursor.close()`.

---

## 11. Health check e startup resiliente

### Health check em camadas

`SELECT 1` valida TCP + auth, mas não detecta saturação do pool. Exponha dois sinais:

- **`ok`:** banco acessível (vincule à **liveness probe** — não reinicie pods em pressão).
- **`degraded`:** pool sob pressão (`waiting > 0`, `idle === 0`, ou latência > 1s). Vincule à **readiness probe** — pare de mandar tráfego antes da saturação total.

### Endpoint no projeto

`GET /api/system/health` (`src/modules/system/system.controller.ts`) retorna **HTTP 200** quando `ok` e **HTTP 503** quando `degraded`/`down` — o status code permite que K8s/load balancers façam a decisão sem inspecionar o body. O body JSON inclui métricas de **ambos** os pools:

```json
{
  "status": "degraded",
  "detail": {
    "ms": 1234,
    "write": { "totalCount": 16, "idleCount": 0, "waitingCount": 3 },
    "read":  { "totalCount": 16, "idleCount": 5, "waitingCount": 0 }
  }
}
```

### `waitForDatabase` no startup

Se o banco não estiver pronto quando a app subir (deploy, K8s, restart), a app morre. Faça retry com backoff por até ~60s antes de aceitar tráfego. No bootstrap: `waitForDatabase()` → `runMigrations()` → `app.listen()`.

---

## 12. Observabilidade do pool

Três métricas essenciais por pool:

- **`pool.totalCount`:** total de conexões (idle + active + connecting).
- **`pool.idleCount`:** conexões ociosas disponíveis.
- **`pool.waitingCount`:** requisições aguardando conexão.

> [!danger] `waitingCount > 0` é o alarme de incêndio
> Requisições estão na fila — o banco vai saturar em seguida.

### Endpoint `/api/system/metrics` no projeto

`getPoolMetrics()` é exposto como JSON simples — sem dependência de Prometheus/Datadog. Qualquer ferramenta gratuita (Grafana Cloud free tier, scraper bash, Uptime Kuma) consegue consumir:

```json
{
  "write": { "totalCount": 16, "idleCount": 12, "waitingCount": 0 },
  "read":  { "totalCount": 16, "idleCount": 14, "waitingCount": 0 }
}
```

### Watchdog com alerta Discord

`src/db/watchdog.ts` faz polling periódico (`POOL_WATCHDOG_INTERVAL_MS`, default 10s) e dispara webhook no `DISCORD_WEBHOOK` quando o pool fica saturado por **N ticks seguidos** (`POOL_WATCHDOG_SATURATION_TICKS`, default 3 = 30s). Cooldown configurável evita flood no canal (`POOL_WATCHDOG_COOLDOWN_MS`, default 5min).

Wiring: `startPoolWatchdog()` no boot (`src/index.ts`) e `stopPoolWatchdog()` no `drain()`.

**Alertas sugeridos:**

| Sinal | Significado | Ação |
| --- | --- | --- |
| `waiting > 0` por 30s+ | Pool saturado | P1: escalar ou investigar query lenta |
| `idle/total < 0.1` sustentado | Subdimensionado | Aumentar `max` ou otimizar |
| `connection timeout` recorrente | Pool insuficiente | Escalar horizontal |
| `idle/total > 0.9` constante | Pool grande demais | Reduzir `max` |

---

## 13. Read replicas

Para muitos usuários, separe pools de leitura e escrita: `writePool` apontando ao primário, `readPool` à réplica. Use `application_name` diferentes para identificar tráfego no `pg_stat_activity`.

### Implementação no projeto

Os dois pools são criados em `src/db/pool.ts`. Quando `DB_READ_HOST` não está definido, o `readPool` reutiliza o host do primário — útil em dev/staging onde não há réplica. O `application_name` distinto (`{APP_NAME}_read`) mantém a separação no `pg_stat_activity` e no PgBouncer mesmo nesse cenário.

**Wrapper de queries (`src/db/client.ts`):**

- `query(sql, params)` → escrita. Usa o client da transação atual (ALS) se houver; senão, `writePool`.
- `readQuery(sql, params)` → SELECT na réplica via `readPool`. **Nunca** chamar dentro de transação.

| Cenário | Função |
| --- | --- |
| `SELECT` autocommit sem requisito de consistência forte | `readQuery()` |
| `INSERT/UPDATE/DELETE` autocommit | `query()` |
| Qualquer query dentro de `withTransaction` | `query()` (pega o client via ALS) |
| Leitura após escrita do mesmo usuário com consistência forte | `query()` (força primário) |

**Variáveis de ambiente:**

```env
DB_READ_HOST=        # vazio → aponta ao primário (dev/staging)
DB_READ_PORT=        # vazio → usa DB_PORT
DB_READ_POOL_MAX=    # vazio → usa DB_POOL_MAX
DB_READ_POOL_MIN=1
```

### Replication lag

Réplicas têm atraso (ms a segundos). Não leia de réplica imediatamente após escrever se a consistência importa.

**Três padrões, do mais simples ao mais complexo:**

1. **Primário-only por rota:** marque rotas críticas explicitamente para usar `query()` (writePool) mesmo em SELECT. Réplica só onde lag de segundos é aceitável (listas, dashboards).
2. **Sticky window:** após qualquer escrita do usuário, force leituras dele para o primário pelos próximos N segundos (cookie ou Redis).
3. **LSN-based wait:** capture o LSN no primário após COMMIT (`pg_current_wal_lsn()`), espere a réplica alcançar antes de ler. PG 18+ tem `pg_wal_replay_wait()` nativa; versões anteriores fazem polling em `pg_last_wal_replay_lsn()` com timeout.

### Métricas e health check com dois pools

`getPoolMetrics()` e `healthCheck()` devem retornar `{ write, read }` separadamente — saturação no `readPool` é tão crítica quanto no `writePool` sob alta carga, e Prometheus/Datadog precisam de séries distintas para identificar qual pool degradou primeiro. O `drain()` precisa fechar ambos no shutdown.

---

## 14. PgBouncer (transaction mode)

Quando você tem dezenas/centenas de instâncias, PgBouncer entra entre app e Postgres.

### O que funciona sem mudança

- Queries via `pool.query()` com prepared statements **sem nome** (default do `pg`).
- Parâmetros de sessão via `options` no `PoolConfig` (vão no startup packet).
- Transações completas (BEGIN/COMMIT/ROLLBACK).

### O que NÃO funciona

| Recurso | Status | Alternativa |
| --- | --- | --- |
| `SET` fora de transação | ❌ afeta conexões aleatórias | Use `options` ou `SET LOCAL` em transação |
| `LISTEN/NOTIFY` | ❌ precisa sessão persistente | Conexão direta, sem PgBouncer |
| Prepared statements nomeados | ⚠️ requer PgBouncer ≥ 1.21 + `max_prepared_statements > 0` | Use unnamed (default) |
| Temp tables | ❌ visibilidade entre transações | CTE ou tabela permanente |
| `pg_advisory_lock` (session) | ❌ | `pg_advisory_xact_lock` (transação) |

### Pool fragmentation

PgBouncer separa pools por chave (database + user + startup parameters). Cada `application_name` distinto cria um pool de servidor separado. Bom para observabilidade (separa writer/reader), mas dimensione `default_pool_size` × número de `application_name`s.

### Configuração no `pg`

Atrás de PgBouncer, use pool menor (`max: 10`, `min: 1`) — o PgBouncer é o pool principal. Mantenha timeouts via `options`.

---

## 15. Graceful shutdown

`pool.end()` sozinho não basta. Ordem correta:

1. **Para de aceitar requisições HTTP** (`server.close()`).
2. **Drena requisições em flight** (com timeout de ~30s).
3. **Fecha o pool** (`pool.end()` com timeout de ~10s — pode travar para sempre sem isso).

### Separe `drain` de `gracefulShutdown`

Quem chama decide o exit code. `drain()` faz só o trabalho de fechar. `gracefulShutdown()` chama `drain()` e sai com `0`.

**Por que isso importa:** o handler de `uncaughtException` precisa chamar `drain()` e depois `process.exit(1)`. Se chamasse `gracefulShutdown()` (que termina com `exit(0)`), o orquestrador (K8s/systemd) veria saída limpa mesmo em crash e poderia não aplicar a política de restart correta.

**Handlers globais:**

- `SIGTERM`/`SIGINT` → `gracefulShutdown` → exit 0.
- `uncaughtException` → `drain` → exit 1.
- `unhandledRejection` → apenas log; promise rejeitada sozinha não derruba a app.

### Em Kubernetes

- `terminationGracePeriodSeconds` > `APP_SHUTDOWN_TIMEOUT + DB_SHUTDOWN_TIMEOUT` (ex: 60s).
- Hook `preStop: sleep 5` antes do SIGTERM — dá tempo ao kube-proxy de remover o pod do endpoint antes de você começar a recusar tráfego.

---

## 16. `postgresql.conf` e `pg_hba.conf`

### `postgresql.conf` essencial

| Parâmetro | Valor | Observação |
| --- | --- | --- |
| `max_connections` | 100–200 | PgBouncer se precisar de mais |
| `shared_buffers` | 25% da RAM | |
| `effective_cache_size` | 50–75% da RAM | |
| `work_mem` | 4–16 MB | Por operação, cuidado |
| `maintenance_work_mem` | 256 MB–1 GB | VACUUM, CREATE INDEX |
| `wal_level` | `replica` | Para réplicas/backups |
| `log_min_duration_statement` | 500 | Loga queries lentas |
| `log_connections` / `log_disconnections` | `on` | Auditoria |
| `log_lock_waits` | `on` | Esperas longas por lock |
| `ssl` | `on` | Obrigatório |
| `password_encryption` | `scram-sha-256` | |
| `statement_timeout` | `60s` | Teto global (app reduz via PoolConfig) |
| `idle_in_transaction_session_timeout` | `30s` | |
| `transaction_timeout` (PG 17+) | `120s` | Duração total de transação |

> [!warning] `lock_timeout` no `postgresql.conf`
> **Não configure** — afeta sessões administrativas. Configure por aplicação no `PoolConfig`.

### `pg_hba.conf`

Use `hostssl` com `scram-sha-256`. Bloqueie `hostnossl all all 0.0.0.0/0 reject` em produção.

### TLS: validar o servidor, não só criptografar

`ssl: true` apenas criptografa, não valida quem está do outro lado.

| Modo | `rejectUnauthorized` | CA | Uso |
| --- | --- | --- | --- |
| `require` | `false` | — | ❌ não usar em produção |
| `verify-ca` | `true` | sim | aceitável em rede privada |
| `verify-full` | `true` + `checkServerIdentity` | sim | ✅ **produção** (protege contra MITM) |

Em RDS/Aurora, use o bundle de CAs da AWS (`rds-ca-rsa2048-bundle.pem`).

---

## 17. Diagnóstico em produção

Mantenha à mão consultas no `pg_stat_activity` para:

- Queries ativas ordenadas pela mais antiga.
- Transações `idle in transaction` (perigosas — seguram locks).
- Locks bloqueando outras queries (via `pg_blocking_pids()`).
- Conexões por `application_name` (detecta vazamento).
- Replication lag (`pg_stat_replication`).

**Top queries lentas:** habilite `pg_stat_statements` em `shared_preload_libraries` e crie a extensão. Ordene por `total_exec_time` para encontrar maiores ofensores.

**Matar query problemática:** `pg_cancel_backend(pid)` (gentil) ou `pg_terminate_backend(pid)` (forçado).

---

## Resumo das prioridades

### Segurança (não-negociável)

1. Queries parametrizadas em 100% dos casos.
2. SSL `verify-full` em produção.
3. SCRAM-SHA-256, nunca MD5.
4. Usuários separados: `migration_user` (DDL) e `app_user` (DML).
5. `ALTER USER ... CONNECTION LIMIT` por usuário.
6. `ALTER DEFAULT PRIVILEGES FOR ROLE migration_user` (não esqueça o `FOR ROLE`).
7. Credenciais em secret manager.
8. Validação Zod com `.max()` em todas as strings.
9. `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` no `PoolConfig`.
10. Logs sem `params`.
11. Whitelist runtime para identificadores dinâmicos.

### Resiliência (alta concorrência)

1. Pool dimensionado por orçamento, não por chute.
2. `maxLifetimeSeconds` explícito (default é 0).
3. `query_timeout > statement_timeout`.
4. `Pool` para autocommit; `PoolClient` para transações.
5. Retry em queries autocommit idempotentes.
6. `client.release(true)` no caminho de erro.
7. `BEGIN ISOLATION LEVEL X` em uma round trip.
8. Retry para `40001` e `40P01` com backoff + jitter.
9. Idempotência em qualquer transação retryável (deadlock ocorre em qualquer isolation level).
10. Outbox para efeitos colaterais.
11. `waitingCount > 0` é alarme de incêndio.
12. Health check em camadas (`ok` vs `degraded`).
13. Graceful shutdown com `drain` separado de `process.exit`.
14. `waitForDatabase` no startup.
15. `lock_timeout` agressivo em migrações.
16. PgBouncer transaction mode para muitas instâncias.

---

## Estrutura de pastas (este projeto)

```
src/
├── db/
│   ├── pool.ts          # writePool + readPool, drainPool fecha ambos
│   ├── client.ts        # query() + readQuery() com retry e log sanitizado
│   ├── transaction.ts   # withTransaction com cleanup correto + ALS
│   ├── health.ts        # healthCheck em camadas + waitForDatabase
│   ├── metrics.ts       # getPoolMetrics retorna { write, read }
│   ├── stream.ts        # streamRows com pg-cursor
│   └── watchdog.ts      # alerta Discord em saturação do pool
├── modules/
│   └── system/          # GET /api/system/health e /api/system/metrics
└── index.ts             # bootstrap + graceful shutdown + startPoolWatchdog
migrations/              # SQL versionado (prefixo numérico 0001_*.sql)
scripts/
├── migrate.ts           # runner com lock_timeout='2s' + checksum SHA-256
└── tsconfig.json        # type-check isolado do script
.env / .env.example
```

---

## Relacionado

- [[structure|Estrutura do Projeto]] — como o projeto atual organiza o acesso ao banco
- [[core/error-handling|Tratamento de Erros]] — `throwInternal` para erros de banco
