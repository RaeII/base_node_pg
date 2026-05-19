# Migrations

SQL versionado aplicado pelo runner customizado em `scripts/migrate.ts`.

## Comandos

```bash
npm run migrate          # aplica migrations pendentes
npm run migrate:status   # lista aplicadas vs pendentes + alerta checksum mismatch
```

## Convenções

### Nome do arquivo

Prefixo numérico crescente — execução em ordem lexicográfica:

```
0001_init.sql
0002_add_users.sql
0003_create_index_orders_user_id.sql
```

### Imutabilidade

> **Migrations aplicadas NÃO podem ser editadas.**
> O runner calcula SHA-256 do conteúdo e aborta se detectar mudança em arquivo já aplicado.

Para alterar o schema, crie um novo arquivo (`0004_alter_users.sql`). Migrations são parte do histórico imutável da base.

### Idempotência defensiva

Use `IF NOT EXISTS` / `IF EXISTS` sempre que possível — protege contra reaplicação em ambientes onde o `schema_migrations` pode estar dessincronizado:

```sql
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
```

### Operações destrutivas

Nunca rode `DROP TABLE`, `DROP COLUMN` ou `TRUNCATE` em migration sem:

1. Confirmação explícita do time
2. Backup recente
3. Estratégia de rollback documentada

### Timeouts — não repita no SQL

O runner já aplica antes de cada migration:

```sql
SET lock_timeout = '2s';      -- falha rápido se outra sessão segura o lock
SET statement_timeout = '60s'; -- DDL pode ser mais longo que o teto runtime
```

Não precisa repetir esses `SET` dentro do arquivo `.sql`.

## Exemplo

```sql
-- 0001_init.sql
CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
```

## Tabela de controle

O runner cria automaticamente `schema_migrations`:

| Coluna       | Tipo          | Observação                          |
|--------------|---------------|-------------------------------------|
| `id`         | `BIGSERIAL`   | PK                                  |
| `name`       | `TEXT UNIQUE` | nome do arquivo                     |
| `checksum`   | `TEXT`        | SHA-256 do conteúdo                 |
| `applied_at` | `TIMESTAMPTZ` | default `NOW()`                     |

Para inspecionar o que já rodou:

```sql
SELECT name, applied_at FROM schema_migrations ORDER BY id;
```

## Usuário do banco

Em produção, configure `DB_MIGRATION_USER` separado (com privilégios de DDL) — diferente do `DB_APP_USER` (só DML). Em dev, se `DB_MIGRATION_USER` estiver vazio, o runner cai no `DB_APP_USER`.

Mais detalhes: [`doc-base_node_pg/postgres-config.md §8–9`](../doc-base_node_pg/postgres-config.md).
