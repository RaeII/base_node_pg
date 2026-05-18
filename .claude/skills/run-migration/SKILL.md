---
name: run-migration
description: Executa as migrations SQL pendentes usando as credenciais do migration_user. Nunca usa app_user para migrations.
disable-model-invocation: true
---

# Skill: run-migration

Executa o runner de migrations do projeto (`scripts/migrate.ts`).

## Como usar

```
/run-migration
```

## O que faz

Roda `scripts/migrate.ts` via `ts-node`, que:
1. Conecta com `migration_user` (nunca `app_user`)
2. Aplica `lock_timeout = '2s'` antes de cada migration
3. Rastreia migrations aplicadas em `schema_migrations`
4. Aplica apenas arquivos `.sql` ainda não registrados, em ordem alfabética

## Instruções para o Claude

Ao invocar esta skill, execute o seguinte comando e mostre o output ao usuário:

```bash
cd /Users/israel/dev/base_node_pg && \
  DB_HOST=${DB_HOST:-localhost} \
  DB_PORT=${DB_PORT:-5432} \
  DB_NAME=${DB_NAME:?'DB_NAME é obrigatório'} \
  MIGRATION_USER=${MIGRATION_USER:?'MIGRATION_USER é obrigatório'} \
  MIGRATION_PASSWORD=${MIGRATION_PASSWORD:?'MIGRATION_PASSWORD é obrigatório'} \
  npx ts-node -r tsconfig-paths/register scripts/migrate.ts
```

### Variáveis necessárias

| Variável            | Descrição                          | Default     |
|---------------------|------------------------------------|-------------|
| `DB_HOST`           | Host do PostgreSQL                 | `localhost` |
| `DB_PORT`           | Porta do PostgreSQL                | `5432`      |
| `DB_NAME`           | Nome do banco de dados             | obrigatório |
| `MIGRATION_USER`    | Usuário com permissão de migration | obrigatório |
| `MIGRATION_PASSWORD`| Senha do migration_user            | obrigatório |

### Regras importantes

- **NUNCA** usar `app_user` para rodar migrations — ele não tem permissão DDL
- Se falhar com `lock timeout`, significa que outra transação está segurando um lock; aguarde e tente novamente
- Migrations já aplicadas (registradas em `schema_migrations`) são ignoradas automaticamente
- Se o usuário não tiver as variáveis de ambiente, oriente-o a verificar o `.env.example`

### Antes de executar

Pergunte ao usuário se as variáveis de ambiente estão configuradas. Se não estiver claro, mostre o `.env.example` e peça confirmação.
