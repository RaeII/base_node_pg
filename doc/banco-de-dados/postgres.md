---
title: Guia PostgreSQL (produção)
tags:
  - database
  - postgresql
  - production
aliases:
  - postgres
  - pg config
---

# Guia PostgreSQL com TypeScript (sem ORM)

Decisões essenciais para usar `pg` (node-postgres) em produção com alta concorrência e segurança. Foco em **por quê**, não em código — a API prática está em [[camada-de-acesso|Camada de Acesso a Dados]].

> [!info] Versões
> Postgres ≥ 14 (para `scram-sha-256` default), `pg` ≥ 8.13. Runtime: Bun (compatível com Node.js ≥ 20).

---

## 1. Instalação

`pg` + `@types/pg`. Complementos usados no projeto: `dotenv`, `zod` (validação), `pg-cursor` (streaming), `winston` (logs).

---

## 2. Variáveis de ambiente

Credenciais sempre em `.env` (no `.gitignore`) ou secret manager (AWS Secrets Manager, Vault, Doppler). Mantenha o `.env.example` versionado como template. Variáveis essenciais: host, porta, banco, usuário, senha, SSL, parâmetros do pool, timeouts e `APP_NAME` para identificação no `pg_stat_activity`. Lista completa em [[estrutura#Variáveis de Ambiente]].

---

## 3. Configuração do Pool

O pool é o componente que mais quebra em produção. Cinco armadilhas comuns:

1. **`query_timeout` igual a `statement_timeout`** cria race condition entre cancelamento server-side e desistência client-side. Regra: `query_timeout > statement_timeout` (ex.: 12s vs 10s).
2. **Faltar `lock_timeout`** deixa queries esperando lock indefinidamente. Configure 2–3s no `PoolConfig` (nunca no `postgresql.conf` — afeta todas as sessões).
3. **`SET` no evento `connect`** quebra com PgBouncer em transaction mode. Use o parâmetro `options` (startup packet) para configurações de sessão como timezone.
4. **`maxLifetimeSeconds` default é `0`** (sem limite). Defina explicitamente (ex.: 30 min) — evita conexões zumbi e ajuda balanceadores como Aurora.
5. **Sem `ALTER USER ... CONNECTION LIMIT`** no banco, uma app vazando conexões consome todo o `max_connections`.

**Parâmetros no `PoolConfig`** (ver `src/db/pool.ts`): `max`, `min`, `idleTimeoutMillis`, `connectionTimeoutMillis`, `maxLifetimeSeconds`, `statement_timeout`, `query_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, `application_name`, `keepAlive`, `options`, `ssl`.

> [!warning] Sempre registre `pool.on('error')`
> Sem isso, qualquer erro em client ocioso derruba o processo. O projeto registra em ambos os pools.

### Defaults recomendados para alta concorrência

| Parâmetro | Valor | Por quê |
| --- | --- | --- |
| `connectionTimeoutMillis` | **2 s** | Fila de 5 s sob picos causa thundering herd; fail-fast aciona circuit breaker antes |
| `idle_in_transaction_session_timeout` | **15 s** | Tx ociosa segura locks e provoca cascata; 15 s reduz o dano |
| `lock_timeout` | 2–3 s | Sob contenção alta pode cair para 1–2 s |
| `maxLifetimeSeconds` | 1800 | Recicla conexões antes de balanceadores as cortarem |

### 3.1 Dimensionamento do pool

Abordagem orçamentária, não a fórmula `cores × 2`:

```
pool_max_por_instância = (max_connections × 0.8 − reservas) ÷ num_instâncias
```

Exemplo: `max_connections=200`, 40 p/ admin/replicas, 30 p/ workers → 130 ÷ 8 pods = `max=16`.

**Regras práticas:** pool pequeno é melhor que grande (pool é backpressure, não capacidade). Queries rápidas (<50ms): 15 conexões servem muito tráfego. Queries lentas: aumentar pool **piora** o banco.

**Sinais de mal dimensionamento:** `waitingCount > 0` recorrente (pequeno ou queries lentas), `idle/total ≈ 1` o tempo todo (grande demais), connection timeout (insuficiente).

### 3.2 `Pool` vs `PoolClient`

- **`pool.query()` direto:** queries autocommit simples (no projeto: `query()`/`readQuery()`).
- **`pool.connect()` → `PoolClient`:** transações, advisory locks, cursors (no projeto: `withTransaction`, `streamRows`). Esquecer `release()` vaza conexão e satura o pool em minutos.

---

## 4. Wrapper de queries

Encapsule `pool.query` para adicionar log sanitizado, slow query log e retry de transientes — implementado em `src/db/client.ts`. Ver [[camada-de-acesso#query() e readQuery()]].

> [!danger] Nunca logue `params`
> Podem conter senhas, tokens, CPF. Logue apenas `paramCount`.

---

## 5. Queries parametrizadas

> [!danger] Regra absoluta
> Use sempre placeholders `$1, $2`. Nunca concatene input na string SQL.

- **Listas dinâmicas (IN):** use `ANY($1::int[])` com array.
- **Identificadores dinâmicos** (tabela/coluna — não parametrizáveis): use whitelist com validação em runtime. TS protege em compile-time, mas `req.query.sort` é string arbitrária em runtime.

---

## 6. Transações com retry e cleanup

Três regras (implementadas em `withTransaction` — ver [[camada-de-acesso#Transações — withTransaction]]):

1. **`client.release(true)` no caminho de erro** — devolve o client destruído em vez de envenenado.
2. **`BEGIN ISOLATION LEVEL X` em uma round trip.**
3. **Retry para `40001` e `40P01`** com backoff + jitter. Deadlock ocorre em qualquer isolation level.

> [!warning] Idempotência em transações retryáveis
> A função pode rodar mais de uma vez. Não dispare efeitos colaterais externos dentro dela — use **outbox**.

---

## 7. Validação de input

Mesmo com queries parametrizadas, valide com Zod antes do banco. **Sempre `.max()` em strings** — strings sem limite são vetor de ataque. Ver [[schemas-zod]].

---

## 8. Usuário do banco com privilégios mínimos

**Dois usuários:** `migration_user` (DDL) e `app_user` (DML, sem `SUPERUSER`/`CREATEDB`). Defina `CONNECTION LIMIT` em cada um.

> [!danger] `ALTER DEFAULT PRIVILEGES` exige `FOR ROLE`
> Default privileges só se aplicam a objetos criados pelo role em `FOR ROLE`. Se as migrations rodam com `migration_user`, é esse o role — senão tabelas novas não herdam permissão para o `app_user`.

**Autenticação:** `scram-sha-256`, nunca `md5`. Confirme com `SHOW password_encryption`.

---

## 9. Migrações sem ORM

SQL versionado em `migrations/`, rodando com `migration_user` **antes** do deploy. Detalhes e convenções em [[migrations]].

### `lock_timeout` agressivo em migrações

DDL precisa de `AccessExclusiveLock`. Se houver transação segurando lock, a migração espera — e todas as queries seguintes na tabela enfileiram atrás dela, derrubando o banco. Por isso toda migration roda com `SET lock_timeout='2s'` + `SET statement_timeout='60s'` (o runner já aplica).

---

## 10. Streaming de resultados grandes

Use `pg-cursor` para queries que retornam muitos registros — carregar tudo em memória causa OOM. Implementado em `streamRows` (ver [[camada-de-acesso#Streaming — streamRows]]). Mesma regra de cleanup da seção 6.

---

## 11. Health check e startup resiliente

`SELECT 1` valida TCP + auth, mas não detecta saturação do pool. Exponha dois sinais:

- **`ok`** → liveness probe (não reinicie pods em pressão).
- **`degraded`** → readiness probe (pare de mandar tráfego antes da saturação): `waiting > 0`, `idle === 0`, ou latência > 1s.

`GET /api/system/health` retorna **200** quando `ok` e **503** quando `degraded`/`down` — o status code deixa K8s/load balancers decidirem sem inspecionar o body. Ver [[sistema|Módulo Sistema]].

`waitForDatabase()` no boot faz retry com backoff por até ~60s antes de aceitar tráfego. Ver [[ciclo-de-vida]].

---

## 12. Observabilidade do pool

Três métricas por pool: `totalCount`, `idleCount`, `waitingCount`.

> [!danger] `waitingCount > 0` é o alarme de incêndio
> Requisições estão na fila — o banco vai saturar em seguida.

`getPoolMetrics()` é exposto como JSON em `GET /api/system/metrics` (sem Prometheus/Datadog obrigatório). O **watchdog** (`src/db/watchdog.ts`) faz polling e alerta no Discord quando o pool fica saturado por N ticks. Ver [[observabilidade]].

| Sinal | Significado | Ação |
| --- | --- | --- |
| `waiting > 0` por 30s+ | Pool saturado | P1: escalar ou investigar query lenta |
| `idle/total < 0.1` sustentado | Subdimensionado | Aumentar `max` ou otimizar |
| `connection timeout` recorrente | Pool insuficiente | Escalar horizontal |
| `idle/total > 0.9` constante | Pool grande demais | Reduzir `max` |

---

## 13. Read replicas

Pools separados: `writePool` → primário, `readPool` → réplica, com `application_name` distintos. Quando `DB_READ_HOST` não está definido, o `readPool` reutiliza o primário (dev/staging). Ver [[camada-de-acesso#query() e readQuery()]].

### Replication lag

Réplicas têm atraso (ms a segundos). Não leia de réplica logo após escrever se a consistência importa. Três padrões: **primário-only por rota** (mais simples), **sticky window** (force primário por N segundos após escrita do usuário) e **LSN-based wait** (mais complexo).

---

## 14. PgBouncer (transaction mode)

Para dezenas/centenas de instâncias.

### Funciona sem mudança
- `pool.query()` com prepared statements **sem nome** (default do `pg`).
- Parâmetros de sessão via `options` (startup packet) — é como o projeto aplica o timezone.
- Transações completas (BEGIN/COMMIT/ROLLBACK).

### NÃO funciona

| Recurso | Status | Alternativa |
| --- | --- | --- |
| `SET` fora de transação | ❌ afeta conexões aleatórias | `options` ou `SET LOCAL` em tx |
| `LISTEN/NOTIFY` | ❌ precisa sessão persistente | Conexão direta |
| Prepared statements nomeados | ⚠️ requer PgBouncer ≥ 1.21 | Use unnamed (default) |
| Temp tables | ❌ | CTE ou tabela permanente |
| `pg_advisory_lock` (session) | ❌ | `pg_advisory_xact_lock` (tx) |

Atrás de PgBouncer, use pool menor no `pg` (`max: 10`, `min: 1`) — o PgBouncer é o pool principal.

---

## 15. Graceful shutdown

`pool.end()` sozinho não basta. Ordem: parar HTTP (`server.close()`) → drenar in-flight → fechar o pool com timeout. O projeto separa `drain()` de `gracefulShutdown()` — ver [[ciclo-de-vida#Graceful Shutdown]].

### Em Kubernetes
- `terminationGracePeriodSeconds` > timeout de shutdown (ex.: 60s).
- Hook `preStop: sleep 5` antes do SIGTERM.

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
| `log_lock_waits` | `on` | Esperas longas por lock |
| `ssl` | `on` | Obrigatório |
| `password_encryption` | `scram-sha-256` | |
| `statement_timeout` | `60s` | Teto global (app reduz via PoolConfig) |
| `idle_in_transaction_session_timeout` | `30s` | |

> [!warning] `lock_timeout` no `postgresql.conf`
> **Não configure** — afeta sessões administrativas. Configure por aplicação no `PoolConfig`.

### `pg_hba.conf`
Use `hostssl` com `scram-sha-256`. Bloqueie `hostnossl all all 0.0.0.0/0 reject` em produção.

### TLS: validar o servidor

| Modo | `rejectUnauthorized` | CA | Uso |
| --- | --- | --- | --- |
| `require` | `false` | — | ❌ não usar em produção |
| `verify-ca` | `true` | sim | aceitável em rede privada |
| `verify-full` | `true` + `checkServerIdentity` | sim | ✅ **produção** (protege contra MITM) |

Em RDS/Aurora, use o bundle de CAs da AWS. O projeto ativa SSL quando `DB_SSL=true` com `rejectUnauthorized: true` + `DB_SSL_CA`.

---

## 17. Diagnóstico em produção

Consultas úteis no `pg_stat_activity`: queries ativas mais antigas; transações `idle in transaction` (seguram locks); locks bloqueando (via `pg_blocking_pids()`); conexões por `application_name` (vazamento); replication lag (`pg_stat_replication`).

**Top queries lentas:** habilite `pg_stat_statements`, ordene por `total_exec_time`. **Matar query:** `pg_cancel_backend(pid)` (gentil) ou `pg_terminate_backend(pid)` (forçado).

---

## Resumo das prioridades

### Segurança (não-negociável)
1. Queries parametrizadas em 100% dos casos.
2. SSL `verify-full` em produção.
3. SCRAM-SHA-256, nunca MD5.
4. `migration_user` (DDL) ≠ `app_user` (DML).
5. `CONNECTION LIMIT` por usuário.
6. `ALTER DEFAULT PRIVILEGES FOR ROLE migration_user`.
7. Credenciais em secret manager.
8. Zod com `.max()` em todas as strings.
9. Timeouts no `PoolConfig`.
10. Logs sem `params`.

### Resiliência (alta concorrência)
1. Pool dimensionado por orçamento.
2. `maxLifetimeSeconds` explícito.
3. `query_timeout > statement_timeout`.
4. Retry só em autocommit idempotente.
5. `client.release(true)` no erro.
6. Retry para `40001`/`40P01` + outbox.
7. `waitingCount > 0` é alarme.
8. Health check em camadas.
9. Graceful shutdown com `drain` separado.
10. `waitForDatabase` no boot.

---

## Relacionado

- [[camada-de-acesso|Camada de Acesso a Dados]] — a API que implementa estas decisões
- [[migrations|Migrations]] — DDL versionado e o runner
- [[ciclo-de-vida|Ciclo de Vida]] — boot resiliente e shutdown
- [[sistema|Módulo Sistema]] — endpoints de health e métricas
