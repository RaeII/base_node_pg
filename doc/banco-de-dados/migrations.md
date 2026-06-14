---
title: Migrations
tags:
  - database
  - migrations
  - postgresql
---

# Migrations

SQL versionado em [`migrations/`](../../migrations/), aplicado pelo runner customizado [`scripts/migrate.ts`](../../scripts/migrate.ts) — sem ORM e sem dependência externa.

> [!info] Fonte canônica
> As convenções completas vivem em [`migrations/README.md`](../../migrations/README.md). Esta página resume e conecta ao restante da documentação.

---

## Comandos (Bun)

```bash
bun run scripts/migrate.ts          # aplica migrations pendentes
bun run scripts/migrate.ts status   # lista aplicadas vs pendentes + checksum mismatch
```

> [!note] Atalhos do package.json
> Os scripts `migrate` / `migrate:status` do `package.json` usam `node -r ts-node/register`. Com Bun, rodar `bun run scripts/migrate.ts` diretamente é mais simples e é o uso documentado no próprio script. Ver [[comandos]].

---

## O que o runner faz

- Aplica `SET lock_timeout='2s'` + `SET statement_timeout='60s'` **antes de cada migration** (falha rápido em vez de bloquear o banco).
- **Transação por migration** com cleanup correto: `release(true)` em erro fatal de conexão.
- **Retry com backoff** quando há contenção de lock (`55P03` `lock_not_available`).
- **Checksum SHA-256** de cada arquivo — detecta migration já aplicada que foi editada e **aborta** antes de corromper o histórico.
- Cria automaticamente a tabela de controle `schema_migrations`.
- Conecta com `DB_MIGRATION_USER` (cai no `DB_APP_USER` se omitido — útil em dev).

---

## Convenções

### Nome do arquivo

Prefixo numérico crescente — execução em ordem lexicográfica:

```
0000_setup_roles.sql
0001_initial_user.sql
0002_add_orders.sql
```

### Imutabilidade

> [!danger] Migration aplicada NÃO se edita
> O runner recalcula o SHA-256 e aborta se o conteúdo mudou. Para alterar o schema, crie um **novo** arquivo (`0003_alter_users.sql`). Migrations são histórico imutável.

### Idempotência defensiva

Use `IF NOT EXISTS` / `IF EXISTS` sempre que possível:

```sql
CREATE TABLE IF NOT EXISTS "user" (...);
CREATE INDEX IF NOT EXISTS idx_user_email ON "user" (email);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
```

### Timeouts — não repita no SQL

O runner já aplica `lock_timeout`/`statement_timeout` antes de cada migration. Não repita esses `SET` dentro do `.sql`.

### Operações destrutivas

Nunca rode `DROP TABLE`, `DROP COLUMN` ou `TRUNCATE` sem confirmação do time, backup recente e estratégia de rollback documentada.

---

## Tabela `schema_migrations`

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `id` | `BIGSERIAL` | PK |
| `name` | `TEXT UNIQUE` | nome do arquivo |
| `checksum` | `TEXT` | SHA-256 do conteúdo |
| `applied_at` | `TIMESTAMPTZ` | default `NOW()` |

```sql
SELECT name, applied_at FROM schema_migrations ORDER BY id;
```

---

## Usuário do banco

Em produção, configure `DB_MIGRATION_USER` separado (privilégios de DDL), distinto do `DB_APP_USER` (só DML). Em dev, se vazio, o runner usa o `DB_APP_USER`.

> [!danger] `ALTER DEFAULT PRIVILEGES FOR ROLE migration_user`
> Default privileges só valem para objetos criados pelo role indicado em `FOR ROLE`. Se as migrations rodam com `migration_user`, é esse o role no `FOR ROLE` — senão tabelas novas não herdam permissões para o `app_user`. Detalhes em [[postgres#8. Usuário do banco com privilégios mínimos]].

---

## Relacionado

- [[postgres#9. Migrações sem ORM|Guia PostgreSQL §9]] — racional do `lock_timeout` agressivo
- [[camada-de-acesso|Camada de Acesso a Dados]] — como a app consome o schema
- [[ciclo-de-vida|Ciclo de Vida]] — rode migrations no deploy, antes do `listen`
