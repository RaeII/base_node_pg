# Transactions — Isolation Levels, Cleanup, Outbox Pattern

## Isolation Levels

| Nível | Protege contra | Usar quando |
|---|---|---|
| `READ COMMITTED` | Dirty reads | Maioria dos casos (default) |
| `REPEATABLE READ` | Non-repeatable reads | Relatórios que leem a mesma linha duas vezes |
| `SERIALIZABLE` | Phantom reads, anomalias de concorrência | Transferências financeiras, inventário crítico |

- Default de retries: **3** para SERIALIZABLE, **2** para os demais.
- Deadlock (`40P01`) pode ocorrer em qualquer isolation level, inclusive READ COMMITTED.

## Cleanup Correto — Dois Tipos de Erro

```typescript
} catch (err: any) {
  // Erro fatal de conexão (SQLSTATE 08*, 57P0*, socket errors)
  // → NÃO tentar ROLLBACK: conexão já está morta
  const fatalConn =
    /^(08|57P0)/.test(err.code ?? '') ||
    ['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(err.errno ?? '');

  if (fatalConn) {
    destroy = true;
  } else {
    // Erro de negócio: tentar ROLLBACK
    try {
      await client.query('ROLLBACK');
    } catch {
      // ROLLBACK também falhou → destruir o cliente
      destroy = true;
    }
  }
} finally {
  client.release(destroy);
  // release(true)  → destrói o cliente (não volta ao pool)
  // release(false) → devolve ao pool normalmente
}
```

> `release()` simples quando cliente está envenenado espalha o problema para a próxima requisição que pegar esse cliente.

## BEGIN em Uma Round Trip

```typescript
// ✅ Uma round trip
await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');

// ❌ Duas round trips desnecessárias
await client.query('BEGIN');
await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
```

## Outbox Pattern — Efeitos Colaterais em Transações Retryáveis

A função passada para `withTransaction` pode executar **mais de uma vez** (retry em deadlock/serialization). Nunca colocar efeitos colaterais externos dentro dela.

```typescript
// ❌ Erro: email disparado múltiplas vezes em caso de retry
await withTransaction(async (client) => {
  await client.query('INSERT INTO orders …');
  await sendEmail(user.email, 'Order confirmed'); // ← PROBLEMA
});

// ✅ Correto: outbox — efeito colateral fica dentro da transação como dado
await withTransaction(async (client) => {
  await client.query('INSERT INTO orders …');
  await client.query(
    'INSERT INTO outbox (type, payload) VALUES ($1, $2)',
    ['order_confirmed', JSON.stringify({ userId, orderId })],
  );
  // Worker separado lê a outbox e dispara o email com deduplicação
});
```

### Worker de Outbox (básico)

```typescript
async function processOutbox() {
  await withTransaction(async (client) => {
    const { rows } = await client.query<OutboxEvent>(
      `SELECT * FROM outbox WHERE processed_at IS NULL
       ORDER BY created_at LIMIT 10
       FOR UPDATE SKIP LOCKED`,
    );
    for (const event of rows) {
      await dispatchEvent(event); // idempotente por design
      await client.query(
        'UPDATE outbox SET processed_at = NOW() WHERE id = $1',
        [event.id],
      );
    }
  });
}
```

## Advisory Locks em Transação

```typescript
// ✅ pg_advisory_xact_lock — liberado no COMMIT/ROLLBACK (funciona com PgBouncer)
await client.query('SELECT pg_advisory_xact_lock($1)', [resourceId]);

// ❌ pg_advisory_lock (sessão) — não funciona com PgBouncer transaction mode
await client.query('SELECT pg_advisory_lock($1)', [resourceId]);
```
