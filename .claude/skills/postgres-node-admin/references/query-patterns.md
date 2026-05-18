# Query Patterns — Parametrização, Identificadores Dinâmicos, Streaming

## Queries Parametrizadas

```typescript
// ✅ Correto — placeholder $N
const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);

// ❌ Nunca — concatenação abre SQL injection
const { rows } = await query(`SELECT * FROM users WHERE id = ${userId}`);
```

## Listas Dinâmicas (IN)

Nunca construir `IN ($1, $2, $3, …)` dinamicamente. Usar `ANY` com array:

```typescript
// ✅ Array passado como parâmetro único
const ids = [1, 2, 3];
const { rows } = await query(
  'SELECT * FROM users WHERE id = ANY($1::int[])',
  [ids],
);
```

## Identificadores Dinâmicos (nome de tabela/coluna)

Identificadores não podem ser parametrizados. Usar **whitelist** com validação em runtime — TypeScript só protege em compile time, `req.query.sort` é `string` arbitrária em runtime.

```typescript
const ALLOWED_SORT_COLUMNS = ['name', 'created_at', 'email'] as const;
type SortColumn = typeof ALLOWED_SORT_COLUMNS[number];

function validateSortColumn(col: string): SortColumn {
  if (!ALLOWED_SORT_COLUMNS.includes(col as SortColumn)) {
    throw new AppError(400, `Invalid sort column: ${col}`);
  }
  return col as SortColumn;
}

const col = validateSortColumn(req.query.sort as string);
const { rows } = await query(`SELECT * FROM users ORDER BY ${col} ASC`);
```

> Nunca usar `req.query.*` diretamente como identificador, mesmo que pareça inofensivo.

## UPSERT / Idempotência

```typescript
// INSERT seguro para retry
await query(
  `INSERT INTO events (id, payload) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
  [eventId, payload],
);

// UPDATE idempotente
await query(
  'UPDATE orders SET status = $1 WHERE id = $2',
  ['shipped', orderId],
);
```

## Streaming com pg-cursor

Para queries que retornam muitos registros. Carregar tudo em memória causa OOM.

```typescript
import Cursor from 'pg-cursor';

export async function* streamRows<T>(
  sql: string,
  params: unknown[],
  batchSize = 100,
): AsyncGenerator<T> {
  const client = await writePool.connect();
  let destroy = false;
  const cursor = client.query(new Cursor(sql, params));
  try {
    while (true) {
      const rows: T[] = await new Promise((resolve, reject) =>
        cursor.read(batchSize, (err, rows) => (err ? reject(err) : resolve(rows as T[]))),
      );
      if (rows.length === 0) break;
      for (const row of rows) yield row;
    }
  } catch (err) {
    destroy = true;
    throw err;
  } finally {
    // Mesma regra da transação: release(true) no caminho de erro
    await cursor.close().catch(() => { destroy = true; });
    client.release(destroy);
  }
}

// Uso
for await (const user of streamRows<User>('SELECT * FROM users WHERE active = $1', [true])) {
  await processUser(user);
}
```
