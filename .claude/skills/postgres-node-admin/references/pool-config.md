# Pool Config — Dimensionamento, Read Replicas, PgBouncer

## Fórmula de Dimensionamento (orçamentária)

```
pool_max_por_instância = (max_connections × 0.8 − reservas) ÷ num_instâncias
```

**Exemplo**: `max_connections=200`, reserva 40 (admin + replicas) + 30 (workers) → 130 disponíveis ÷ 8 pods = **`max: 16`**

### Regras práticas

- Pool **pequeno** é melhor que grande. Pool é backpressure, não capacidade.
- Queries rápidas (< 50 ms): 15 conexões servem muito tráfego.
- Queries lentas: aumentar `max` **piora** o banco — mais paralelismo não ajuda IO-bound.
- Acima de ~50 conexões por instância, o gargalo vira o próprio banco.

### Sinais de mal-dimensionamento

| Sinal | Diagnóstico | Ação |
|---|---|---|
| `waitingCount > 0` recorrente | Pool pequeno ou queries lentas | Investigar query lenta antes de aumentar `max` |
| `idle/total ≈ 1` constante | Pool grande demais | Reduzir `max` |
| Connection timeout recorrente | `max` insuficiente | Escalar horizontal + revisar queries |

---

## Pool vs PoolClient

| Caso | API | Motivo |
|---|---|---|
| Query autocommit simples | `pool.query()` | Devolve conexão imediatamente |
| Transação | `pool.connect()` → `PoolClient` | Mantém estado entre statements |
| Advisory locks | `pool.connect()` → `PoolClient` | Lock é de sessão |
| Cursors / streaming | `pool.connect()` → `PoolClient` | Cursor precisa da mesma conexão |

> **Esquecer `client.release()`** vaza conexão e satura o pool em minutos. Sempre usar `try/finally`.

---

## Read Replicas

```typescript
export const writePool = new Pool({
  host: process.env.DB_PRIMARY_HOST,
  application_name: `${process.env.APP_NAME}-writer`,
  // ... demais configurações
});

export const readPool = new Pool({
  host: process.env.DB_REPLICA_HOST,
  application_name: `${process.env.APP_NAME}-reader`,
  // ... demais configurações
});
```

### Cuidados com replication lag

Réplicas têm atraso (ms a segundos). Nunca ler de réplica imediatamente após escrever se consistência importar.

**Três estratégias:**

1. **Primário-only por rota** — rotas críticas usam `writePool` mesmo em SELECT. Réplica só onde lag de segundos é aceitável (listas, dashboards).

2. **Sticky window** — após qualquer escrita do usuário, forçar leituras para o primário por N segundos (cookie ou Redis).

3. **LSN-based wait** — capturar LSN no primário após COMMIT (`pg_current_wal_lsn()`), esperar réplica alcançar antes de ler. PG 18+ tem `pg_wal_replay_wait()` nativa; versões anteriores fazem polling em `pg_last_wal_replay_lsn()` com timeout.

---

## PgBouncer (transaction mode)

Quando há dezenas/centenas de instâncias de app, usar PgBouncer entre app e Postgres.

### O que funciona

- Queries via `pool.query()` com prepared statements **sem nome** (default do `pg`)
- Parâmetros de sessão via `options` no `PoolConfig` (startup packet)
- Transações completas (BEGIN / COMMIT / ROLLBACK)

### O que NÃO funciona

| Recurso | Status | Alternativa |
|---|---|---|
| `SET` fora de transação | ❌ afeta conexões aleatórias | Usar `options` ou `SET LOCAL` em transação |
| `LISTEN/NOTIFY` | ❌ precisa sessão persistente | Conexão direta, sem PgBouncer |
| Prepared statements nomeados | ⚠️ requer PgBouncer ≥ 1.21 + `max_prepared_statements > 0` | Usar unnamed (default) |
| Temp tables | ❌ visibilidade entre transações | CTE ou tabela permanente |
| `pg_advisory_lock` (session) | ❌ | `pg_advisory_xact_lock` (transação) |

### Config do pool atrás de PgBouncer

```typescript
// PgBouncer É o pool — usar valores menores no lado da app
const pool = new Pool({
  max: 10,
  min: 1,
  // Timeouts via options (startup packet), não SET
  options: '-c statement_timeout=10000 -c lock_timeout=3000',
});
```

### Pool fragmentation

PgBouncer separa pools por chave `(database + user + startup_parameters)`. Cada `application_name` distinto cria um pool de servidor separado. Dimensionar `default_pool_size` × número de `application_name`s.
