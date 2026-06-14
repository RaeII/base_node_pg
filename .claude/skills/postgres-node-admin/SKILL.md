---
name: postgres-node-admin
description: >
  Use this skill for ANY PostgreSQL task in this Node.js + TypeScript project (uses `pg` / node-postgres, no ORM).
  Trigger whenever the user asks about: pool setup, writing queries or transactions, creating migrations, health checks,
  observability/metrics, PgBouncer, graceful shutdown, slow queries, connection leaks, SSL/TLS, read replicas,
  query wrappers, retry logic, database users/permissions, postgresql.conf, or any db-related code.
  Also trigger when the user shows code touching `pool.query`, `pool.connect`, `withTransaction`, `pg.Pool`,
  `PoolClient`, or any file in `src/db/`. Apply proactively — don't wait for explicit request.
version: 1.0.0
---

# PostgreSQL Admin — Node.js + TypeScript (sem ORM)

Stack: **Node.js ≥ 20 LTS · `pg` ≥ 8.13 · TypeScript strict · sem ORM**
Documentação completa: `doc/postgres-config.md`

---

## Estrutura de Arquivos

```
src/db/
├── pool.ts          # Pool write + read separados
├── client.ts        # query() com retry + log sanitizado
├── transaction.ts   # withTransaction com cleanup correto
├── health.ts        # healthCheck em camadas + waitForDatabase
├── metrics.ts       # getPoolMetrics (Prometheus/Datadog)
└── stream.ts        # streamRows com pg-cursor
migrations/          # SQL versionado — rodado com migration_user
scripts/migrate.ts   # runner com lock_timeout agressivo
```

---

## Regras Absolutas

1. **Queries parametrizadas 100%** — `$1, $2`. Nunca concatenar input na string SQL.
2. **Nunca logar `params`** — pode conter senhas/tokens/CPF. Logar só `params?.length`.
3. **`client.release(true)` no caminho de erro** de transação — destrói o cliente envenenado.
4. **SSL `verify-full` em produção** — `ssl: true` só criptografa, não valida o servidor.
5. **`query_timeout > statement_timeout`** — ex: 12 s vs 10 s. Inversão cria race condition.
6. **`ALTER DEFAULT PRIVILEGES FOR ROLE migration_user`** — sem o `FOR ROLE` novas tabelas não herdam permissões para `app_user`.
7. **`maxLifetimeSeconds` explícito** — default é `0` (sem limite); definir ex: `1800`.
8. **`pool.on('error')` sempre registrado** — sem isso erro em client ocioso derruba o processo.

---

## Pool (pool.ts)

Dois pools sempre — `writePool` (primário) e `readPool` (réplica). Quando `DB_READ_HOST` não está
definido, `readPool` reusa o host do primário (ideal em dev/staging) mas mantém `application_name`
distinto para separar tráfego no `pg_stat_activity` e no PgBouncer.

```typescript
import { Pool, type PoolConfig } from 'pg';

const baseConfig: PoolConfig = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_APP_USER,
  password: env.DB_APP_PASSWORD,
  ssl: env.DB_SSL ? { rejectUnauthorized: true, ca: env.DB_SSL_CA } : false,
  max: env.DB_POOL_MAX,                              // 16 — fórmula orçamentária (ver pool-config.md)
  min: env.DB_POOL_MIN,                              // 2
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,         // 10_000
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS, // 2_000 — fail-fast sob alta carga
  maxLifetimeSeconds: env.DB_MAX_LIFETIME_SECONDS,   // 1_800 — NUNCA deixar em 0
  application_name: env.APP_NAME,
  keepAlive: true,
  options: `-c timezone=${env.DB_TIMEZONE}`,         // startup packet, não SET no evento connect
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,    // 10_000
  query_timeout: env.DB_QUERY_TIMEOUT_MS,            // 12_000 (> statement_timeout)
  lock_timeout: env.DB_LOCK_TIMEOUT_MS,              // 3_000
  idle_in_transaction_session_timeout: env.DB_IDLE_TX_TIMEOUT_MS, // 15_000 — tx ociosa segura locks
};

export const writePool = new Pool(baseConfig);
writePool.on('error', (err) => logger.error('Write pool idle client error', { err }));

export const readPool = new Pool({
  ...baseConfig,
  host: env.DB_READ_HOST || env.DB_HOST,
  port: env.DB_READ_PORT || env.DB_PORT,
  max: env.DB_READ_POOL_MAX || env.DB_POOL_MAX,
  min: env.DB_READ_POOL_MIN,
  application_name: `${env.APP_NAME}_read`,
});
readPool.on('error', (err) => logger.error('Read pool idle client error', { err }));

export const drainPool = async (timeoutMs = 10_000): Promise<void> => {
  await Promise.race([
    Promise.all([writePool.end(), readPool.end()]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Pool drain timeout')), timeoutMs)),
  ]);
};
```

> **Defaults atualizados para alta concorrência (≥10k usuários):**
> `DB_CONNECTION_TIMEOUT_MS=2000` (era 5000 — fail-fast evita thundering herd) e
> `DB_IDLE_TX_TIMEOUT_MS=15000` (era 30000 — tx ociosa segura locks e causa efeito cascata).

Para **dimensionamento orçamentário**, **replication lag** e **PgBouncer** → `references/pool-config.md`

---

## Query Wrappers (client.ts)

Duas funções: `query()` para escritas (e leituras dentro de transação via ALS) e `readQuery()`
para SELECTs autocommit que devem ir à réplica.

```typescript
const SLOW_QUERY_MS = 500;
const MAX_RETRIES = 3;
// Transient errors safe to retry (autocommit idempotent queries only)
const RETRYABLE = new Set(['08006','08001','08004','57P03','ECONNRESET','ECONNREFUSED','EPIPE']);

/** Escrita (ou leitura dentro de tx). Usa o client da tx (ALS) se houver. */
export async function query<T>(sql: string, params?: unknown[], opts: QueryOptions = {}) {
  const executor = opts.client ?? getTxClient() ?? writePool;
  const allowRetry = !opts.noRetry && !opts.client && !getTxClient();
  // … loop com retry exponencial + jitter
}

/** SELECT na réplica. Nunca usar dentro de transação — use query() com o client da tx. */
export async function readQuery<T>(sql: string, params?: unknown[]) {
  // mesma lógica, mas executor = readPool, sem ALS, retry sempre habilitado
}
```

**Decisão rápida — qual usar:**

| Cenário | Função |
|---|---|
| `SELECT` autocommit fora de transação | `readQuery()` → réplica |
| `INSERT/UPDATE/DELETE` autocommit | `query()` → primário |
| Qualquer query dentro de `withTransaction` | `query()` (pega o client via ALS) |
| Leitura após escrita do mesmo usuário com consistência forte | `query()` (força primário) |

> Retry só em queries **idempotentes**: `UPDATE … WHERE id`, `DELETE`, `INSERT … ON CONFLICT DO NOTHING`.
> Para `INSERT` simples ou contadores → `opts.noRetry = true`.

> **Replication lag:** réplicas atrasam ms a segundos. Não use `readQuery()` imediatamente após
> uma escrita se a consistência importar — veja padrão **sticky window** em `references/pool-config.md`.

Para **listas dinâmicas** (`ANY($1::int[])`), **identificadores dinâmicos** e **streaming** → `references/query-patterns.md`

---

## Transactions (transaction.ts)

```typescript
type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  isolation: IsolationLevel = 'READ COMMITTED',
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  while (true) {
    const client = await writePool.connect();
    let destroy = false;
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); // uma round trip
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      const fatalConn = /^(08|57P0)/.test(err.code ?? '') || err.errno === 'ECONNRESET';
      if (fatalConn) {
        destroy = true;
      } else {
        try { await client.query('ROLLBACK'); } catch { destroy = true; }
      }
      const retryable = err.code === '40001' || err.code === '40P01'; // serialization / deadlock
      if (retryable && ++attempt <= maxRetries) {
        await sleep(50 * 2 ** attempt + Math.random() * 50);
        continue;
      }
      throw err;
    } finally {
      client.release(destroy); // true → destrói; false → devolve ao pool
    }
  }
}
```

> `fn` pode executar mais de uma vez. **Nunca** enviar email/SMS, chamar API externa ou publicar em fila dentro dela. Use **outbox pattern**.

Para **isolation levels**, **cleanup de erros fatais** e **outbox** → `references/transactions.md`

---

## Segurança — Usuários e Permissões

```sql
-- Dois usuários distintos
CREATE USER migration_user WITH PASSWORD '…' CONNECTION LIMIT 3;
CREATE USER app_user       WITH PASSWORD '…' CONNECTION LIMIT 50;

GRANT CONNECT ON DATABASE mydb TO app_user;
GRANT USAGE   ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- FOR ROLE é obrigatório — sem ele novas tabelas não herdam automaticamente
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_user IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO app_user;
```

```conf
# pg_hba.conf — scram-sha-256 obrigatório
hostssl   all  app_user       0.0.0.0/0  scram-sha-256
hostssl   all  migration_user 10.0.0.0/8 scram-sha-256
hostnossl all  all            0.0.0.0/0  reject
```

Para **SSL verify-full**, **postgresql.conf completo** e **validação Zod** → `references/security.md`

---

## Migrações (scripts/migrate.ts)

```typescript
async function runMigration(client: PoolClient, sql: string) {
  // lock_timeout agressivo: falha rápido em vez de bloquear o banco inteiro
  await client.query(`SET lock_timeout = '2s'; SET statement_timeout = '60s'`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}
```

> DDL precisa de `AccessExclusiveLock`. Com `lock_timeout = '2s'`, a migração falha rápido e pode tentar novamente em vez de enfileirar todas as queries da aplicação.
> Executar **antes do deploy** com `migration_user`. Ferramentas: `node-pg-migrate` ou `dbmate`.

---

## Health Check & Startup (health.ts)

Monitorar **ambos** os pools — saturação no readPool é tão crítica quanto no writePool sob alta carga.

```typescript
export async function healthCheck() {
  try {
    const t0 = Date.now();
    await writePool.query('SELECT 1');
    const ms = Date.now() - t0;
    const write = { waitingCount: writePool.waitingCount, idleCount: writePool.idleCount, totalCount: writePool.totalCount };
    const read  = { waitingCount: readPool.waitingCount,  idleCount: readPool.idleCount,  totalCount: readPool.totalCount  };
    const degraded =
      write.waitingCount > 0 || write.idleCount === 0 ||
      read.waitingCount  > 0 || read.idleCount  === 0 ||
      ms > 1_000;
    return { status: degraded ? 'degraded' : 'ok', detail: { ms, write, read } };
  } catch (err) {
    return { status: 'down', detail: { error: String(err) } };
  }
}

// Bootstrap: waitForDatabase → runMigrations → app.listen()
export async function waitForDatabase(retries = 10): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try { await writePool.query('SELECT 1'); return; } catch {}
    await sleep(Math.min(1_000 * 2 ** i, 30_000));
  }
  throw new Error('Database unavailable after retries');
}
```

- **`ok`** → liveness probe (não reiniciar em pressão)
- **`degraded`** → readiness probe (parar tráfego antes da saturação)

`getPoolMetrics()` deve retornar `{ write, read }` — Prometheus/Datadog precisam de séries
separadas para detectar qual pool saturou primeiro.

---

## Graceful Shutdown

```typescript
export async function drain(): Promise<void> {
  await Promise.race([
    Promise.all([writePool.end(), readPool.end()]),  // fechar ambos os pools
    sleep(10_000).then(() => { throw new Error('Pool drain timeout'); }),
  ]);
}

export async function gracefulShutdown(): Promise<void> {
  await drain();
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT',  gracefulShutdown);
process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception', { err });
  await drain();
  process.exit(1); // exit(1), não gracefulShutdown — orquestrador K8s precisa ver crash
});
process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { err }));
```

Para **métricas Prometheus**, **alertas**, **diagnóstico em produção** e **K8s terminationGracePeriod** → `references/operations.md`

---

## Referências

| Arquivo | Quando ler |
|---|---|
| `references/pool-config.md` | Dimensionamento, read replicas, PgBouncer |
| `references/query-patterns.md` | ANY($1), identificadores dinâmicos, pg-cursor streaming |
| `references/transactions.md` | Isolation levels, outbox pattern, erros fatais |
| `references/security.md` | SSL verify-full, postgresql.conf completo, Zod |
| `references/operations.md` | Métricas, alertas, diagnóstico, K8s shutdown |
