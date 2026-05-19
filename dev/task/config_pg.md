# Config PostgreSQL — preparação para 20k usuários simultâneos

## Tarefas

- [ ] Configurar e ver como funciona **PgBouncer** (entra na frente do Postgres e faz pool de conexões)
- [ ] Verificar se o projeto aguenta mais de 20k usuários simultâneos em ambiente real
- [ ] Configurar **réplica de leitura** real e popular `DB_READ_HOST` no `.env`
- [ ] Criar **dois usuários no banco** (`migration_user` para DDL, `app_user` para DML) com `CONNECTION LIMIT`
- [ ] Habilitar **SSL `verify-full`** em produção (`DB_SSL=true` + `DB_SSL_CA`)
- [ ] Ajustar **`postgresql.conf`** (`max_connections`, `shared_buffers`, `work_mem`, `log_min_duration_statement`, etc.)
- [ ] Habilitar extensão **`pg_stat_statements`** para encontrar queries lentas
- [ ] **Escalar horizontalmente** o Node.js (múltiplos pods/instâncias — `max=16` por instância pressupõe ~8 pods)
- [ ] Criar **manifests K8s** com `terminationGracePeriodSeconds`, `preStop: sleep 5`, probes apontando para `/api/system/health`

---

## ✅ O que já está pronto no código

| Item | Localização |
|---|---|
| `writePool` + `readPool` separados | `src/db/pool.ts` |
| `query()` + `readQuery()` com retry exponencial + jitter | `src/db/client.ts` |
| `withTransaction` com cleanup correto + ALS | `src/db/transaction.ts` |
| Graceful shutdown (SIGTERM/SIGINT/uncaughtException) | `src/index.ts:75-87` |
| `drainPool` fecha **ambos** os pools | `src/db/pool.ts` |
| `waitForDatabase` no startup | `src/shared/loaders/index.ts:13` |
| `pool.on('error')` registrado nos dois pools | `src/db/pool.ts` |
| Timeouts calibrados para alta concorrência | `DB_CONNECTION_TIMEOUT_MS=2000`, `DB_IDLE_TX_TIMEOUT_MS=15000` |
| **Endpoint `GET /api/system/health`** (200/503 para K8s probes) | `src/modules/system/system.controller.ts` |
| **Endpoint `GET /api/system/metrics`** (JSON com pool stats) | `src/modules/system/system.controller.ts` |
| **Watchdog do pool com alerta Discord** | `src/db/watchdog.ts` — webhook quando `waitingCount > 0` ou `idleCount === 0` sustentado |
| **Sistema de migrations** com `lock_timeout='2s'` agressivo | `scripts/migrate.ts` — checksum SHA-256, retry em `55P03`, cleanup `release(true)` |
| Comandos `npm run migrate` / `npm run migrate:status` | `package.json` |

---

## ❌ O que ainda falta — infraestrutura/operação

| Lacuna | Estado atual | Necessário |
|---|---|---|
| **PgBouncer** | não configurado | obrigatório acima de ~10 instâncias Node.js — transaction mode |
| **Read replica real** | `DB_READ_HOST=` vazio (aponta ao primário) | provisionar réplica e popular a env var |
| **SSL/TLS** | `DB_SSL=false` no `.env` | `verify-full` em produção (protege contra MITM) |
| **Usuários separados** | conecta como `postgres` (superuser) | `migration_user` (DDL) e `app_user` (DML) com `CONNECTION LIMIT` + `ALTER DEFAULT PRIVILEGES FOR ROLE migration_user` |
| **`postgresql.conf`** | defaults do Postgres | `max_connections`, `shared_buffers`, `work_mem`, `log_min_duration_statement`, `statement_timeout` global, `idle_in_transaction_session_timeout`, etc. |
| **`pg_stat_statements`** | não habilitado | sem ele, fica cego para queries que matam o banco |
| **Escala horizontal** | 1 processo Node.js | múltiplas instâncias (K8s/cluster) — a fórmula `max=16` por instância pressupõe ~8 pods |
| **K8s manifests** | inexistentes | `terminationGracePeriodSeconds > 60s`, `preStop: sleep 5`, probes apontando para `/api/system/health` |

---

## Ordem de prioridade sugerida (do mais barato ao mais caro)

1. ~~Endpoints `/health` e `/metrics`~~ — ✅ **feito**
2. ~~Sistema de migrations + runner com `lock_timeout` agressivo~~ — ✅ **feito**
3. ~~Alerta Discord para saturação do pool~~ — ✅ **feito** (bônus, usa `DISCORD_WEBHOOK` que já existia)
4. **Dois usuários DB** + `CONNECTION LIMIT` + `ALTER DEFAULT PRIVILEGES FOR ROLE migration_user`
5. **SSL `verify-full`** em produção
6. **Tuning do `postgresql.conf`** + `pg_stat_statements`
7. **Escala horizontal** (múltiplos pods Node.js)
8. **Read replica** real + popular `DB_READ_HOST`
9. **PgBouncer** em transaction mode
10. **Manifests K8s** com probes/graceful shutdown wiring

---

## Como testar a observabilidade que já existe

```bash
# Health (200 = ok, 503 = degradado/down — use em K8s readiness probe)
curl -i http://localhost:3000/api/system/health

# Métricas dos pools — JSON sem dependência de Prometheus
curl -s http://localhost:3000/api/system/metrics | jq

# Forçar migration
npm run migrate          # aplica pendentes (pasta migrations/, prefixo numérico 0001_*.sql)
npm run migrate:status   # lista o que foi aplicado + detecta checksum mismatch
```

O **watchdog Discord** dispara automaticamente quando o pool satura sob carga — sem precisar configurar nada além do `DISCORD_WEBHOOK` no `.env` (cooldown e thresholds em `POOL_WATCHDOG_*`).
