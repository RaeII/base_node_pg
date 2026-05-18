# Operations — Métricas, Alertas, Diagnóstico, Kubernetes

## Métricas de Pool (Prometheus / Datadog)

```typescript
// metrics.ts
export function getPoolMetrics() {
  return {
    total:   writePool.totalCount,   // idle + active + connecting
    idle:    writePool.idleCount,    // disponíveis
    waiting: writePool.waitingCount, // na fila — alarme de incêndio
  };
}

// Expor a cada N segundos para o coletor
setInterval(() => {
  const m = getPoolMetrics();
  prometheus.gauge('db_pool_total',   m.total);
  prometheus.gauge('db_pool_idle',    m.idle);
  prometheus.gauge('db_pool_waiting', m.waiting);
}, 5_000);
```

## Alertas Sugeridos

| Sinal | Significado | Ação |
|---|---|---|
| `waiting > 0` por 30s+ | Pool saturado | P1: escalar ou investigar query lenta |
| `idle/total < 0.1` sustentado | Subdimensionado | Aumentar `max` ou otimizar queries |
| Connection timeout recorrente | Pool insuficiente | Escalar horizontal |
| `idle/total > 0.9` constante | Pool grande demais | Reduzir `max` |

> `waitingCount > 0` é o alarme de incêndio — o banco vai saturar em seguida.

---

## Diagnóstico em Produção

```sql
-- Queries ativas há mais de 30s
SELECT pid, now() - query_start AS duration, state, query
FROM pg_stat_activity
WHERE state != 'idle' AND query_start < now() - interval '30 seconds'
ORDER BY duration DESC;

-- Transações idle in transaction (seguram locks)
SELECT pid, now() - state_change AS duration, query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
ORDER BY duration DESC;

-- Locks bloqueando outras queries
SELECT blocked.pid, blocked.query, blocking.pid AS blocking_pid, blocking.query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0;

-- Conexões por application_name (detecta vazamento)
SELECT application_name, count(*), state
FROM pg_stat_activity
GROUP BY application_name, state
ORDER BY count DESC;

-- Top queries lentas (requer pg_stat_statements)
SELECT query, calls, total_exec_time / calls AS avg_ms, total_exec_time
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Replication lag
SELECT client_addr, application_name,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;
```

### Matar query problemática

```sql
-- Cancelamento gentil (equivale a Ctrl+C na sessão)
SELECT pg_cancel_backend(pid);

-- Terminação forçada
SELECT pg_terminate_backend(pid);
```

### Habilitar pg_stat_statements

```sql
-- postgresql.conf
shared_preload_libraries = 'pg_stat_statements'

-- Após restart do Postgres
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

---

## Graceful Shutdown — Kubernetes

```yaml
# deployment.yaml
spec:
  terminationGracePeriodSeconds: 60  # > APP_SHUTDOWN_TIMEOUT + DB_SHUTDOWN_TIMEOUT

  containers:
  - lifecycle:
      preStop:
        exec:
          command: ["/bin/sleep", "5"]  # dá tempo ao kube-proxy de remover o pod do endpoint
```

**Sequência correta no código:**
1. `server.close()` — para de aceitar novas conexões HTTP
2. Aguardar requisições em flight (timeout ~30 s)
3. `writePool.end()` com timeout de ~10 s

```typescript
export async function drain(): Promise<void> {
  // Parar HTTP primeiro
  await new Promise<void>((res, rej) =>
    server.close((err) => (err ? rej(err) : res())),
  );
  // Fechar pool com timeout (pool.end() pode travar para sempre sem isso)
  await Promise.race([
    writePool.end(),
    sleep(10_000).then(() => { throw new Error('Pool end timeout'); }),
  ]);
}
```

### Por que `drain` separado de `gracefulShutdown`

O handler de `uncaughtException` precisa de `exit(1)` (crash visível ao orquestrador). Se chamasse `gracefulShutdown()` (que usa `exit(0)`), o K8s/systemd veria saída limpa e poderia não aplicar a política de restart.

```typescript
process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception', { err });
  await drain();
  process.exit(1); // ← exit(1), não gracefulShutdown
});
```

---

## Migrations — runner.ts (com retry)

```typescript
import { Pool } from 'pg';

const migPool = new Pool({
  user: process.env.MIGRATION_USER,
  password: process.env.MIGRATION_PASSWORD,
  // ... demais params
});

async function runMigrations(files: string[]) {
  for (const file of files) {
    let attempt = 0;
    while (true) {
      const client = await migPool.connect();
      try {
        await client.query(`SET lock_timeout = '2s'; SET statement_timeout = '60s'`);
        await client.query('BEGIN');
        await client.query(require('fs').readFileSync(file, 'utf8'));
        await client.query('COMMIT');
        break; // sucesso
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '55P03' && ++attempt < 5) { // lock_timeout
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }
}
```
