import Cursor from "pg-cursor";
import type { PoolClient, QueryResultRow } from "pg";
import { writePool } from "@/db/pool";
import logger from "@/shared/utils/logger";

/**
 * Faz streaming de uma query grande usando `pg-cursor`.
 * Carrega `batchSize` linhas por vez — evita OOM em SELECT que retorna muitos registros.
 *
 * O cliente é liberado com `release(true)` em caso de erro (cursor envenenado).
 */
export async function* streamRows<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
    batchSize = 500
): AsyncGenerator<T> {
    const client: PoolClient = await writePool.connect();
    const cursor = client.query(new Cursor(sql, params as any[]));
    let destroy = false;
    try {
        while (true) {
            const rows: T[] = await new Promise((resolve, reject) => {
                cursor.read(batchSize, (err, batch) => {
                    if (err) reject(err);
                    else resolve(batch as T[]);
                });
            });
            if (rows.length === 0) break;
            for (const row of rows) yield row;
        }
    } catch (err) {
        destroy = true;
        throw err;
    } finally {
        try {
            await new Promise<void>((resolve) => cursor.close(() => resolve()));
        } catch (closeErr) {
            logger.warn("Cursor close failed", {
                error: closeErr instanceof Error ? closeErr.message : String(closeErr),
            });
            destroy = true;
        }
        client.release(destroy);
    }
}
