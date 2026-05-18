# Segurança — SSL, postgresql.conf, Zod

## SSL / TLS — verify-full

```typescript
import fs from 'fs';

// Três modos de SSL
// ❌ require    — só criptografa, não valida o servidor (vulnerável a MITM)
// ⚠️ verify-ca  — valida CA, mas não o hostname
// ✅ verify-full — valida CA + hostname (produção obrigatório)

const pool = new Pool({
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync(process.env.DB_SSL_CA_PATH!).toString(),
    // Para RDS/Aurora: rds-ca-rsa2048-bundle.pem
    checkServerIdentity: (hostname, cert) => {
      // undefined = aceita; throw = rejeita
      // Implementação padrão do tls.checkServerIdentity já cobre hostname
      return undefined;
    },
  },
});
```

### Modos comparados

| Modo | `rejectUnauthorized` | CA | Uso |
|---|---|---|---|
| `require` | `false` | — | ❌ não usar em produção |
| `verify-ca` | `true` | sim | aceitável em rede privada |
| `verify-full` | `true` + `checkServerIdentity` | sim | ✅ produção |

---

## postgresql.conf — Parâmetros Essenciais

```ini
# Conexões
max_connections = 100              # usar PgBouncer se precisar de mais

# Memória
shared_buffers = 25%               # 25% da RAM
effective_cache_size = 50%         # 50–75% da RAM
work_mem = 4MB                     # por operação; cuidado com parallelism
maintenance_work_mem = 256MB       # VACUUM, CREATE INDEX

# Replicação
wal_level = replica                # para réplicas/backups

# Logs e diagnóstico
log_min_duration_statement = 500   # loga queries > 500 ms
log_connections = on
log_disconnections = on
log_lock_waits = on                # esperas longas por lock

# Segurança
ssl = on
password_encryption = scram-sha-256

# Timeouts globais (app sobrescreve via PoolConfig)
statement_timeout = 60s
idle_in_transaction_session_timeout = 30s
transaction_timeout = 120s         # PG 17+

# NUNCA definir lock_timeout aqui — afeta sessões administrativas
# lock_timeout = ...  ← não fazer
```

---

## Autenticação — pg_hba.conf

```
# Produção: hostssl + scram-sha-256
hostssl   all  app_user       0.0.0.0/0   scram-sha-256
hostssl   all  migration_user 10.0.0.0/8  scram-sha-256
hostnossl all  all            0.0.0.0/0   reject

# Verificar configuração atual
SHOW password_encryption;  -- deve retornar scram-sha-256
```

---

## Validação Zod com `.max()` Obrigatório

Strings sem limite de tamanho são vetor de ataque (memória, índices, payloads gigantes).

```typescript
import { z } from 'zod';

// ✅ Sempre .max() em strings
const CreateUserSchema = z.object({
  name:     z.string().min(1).max(100),
  email:    z.string().email().max(254),
  bio:      z.string().max(1000).optional(),
  password: z.string().min(8).max(72), // bcrypt limite
});

// ❌ String sem limite — vetor de ataque
const BadSchema = z.object({
  name: z.string(),  // ← sem .max()
});
```

Validar **antes** de chegar ao banco:

```typescript
// Controller
const body = parseSchema(CreateUserSchema, req.body); // lança AppError 400 se inválido
await userService.create(body);
```

---

## Variáveis de Ambiente — Checklist

```env
# .env.example (versionado no git — sem valores reais)
DB_HOST=
DB_PORT=5432
DB_NAME=
APP_USER=
APP_PASSWORD=
MIGRATION_USER=
MIGRATION_PASSWORD=
DB_SSL_CA_PATH=
APP_NAME=myapp
DB_POOL_MAX=16
DB_POOL_MIN=2
```

Credenciais reais: sempre em **secret manager** (AWS Secrets Manager, Vault, Doppler) — nunca em `.env` commitado.
