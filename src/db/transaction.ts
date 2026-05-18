import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { writePool } from "@/db/pool";
import logger from "@/shared/utils/logger";

export type IsolationLevel = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

interface TxContext {
    client: PoolClient;
}

const txStore = new AsyncLocalStorage<TxContext>();

/**
 * Retorna o cliente da transação atual, se houver.
 * Usado pelo wrapper `query()` para que camadas inferiores não precisem receber o client.
 */
export const getTxClient = (): PoolClient | undefined => txStore.getStore()?.client;

/**
 * Indica se a execução atual está dentro de uma transação.
 */
export const isInTransaction = (): boolean => txStore.getStore() !== undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isFatalConnError = (err: any): boolean => {
    const code = err?.code ?? "";
    if (/^(08|57P0)/.test(code)) return true;
    if (err?.errno === "ECONNRESET" || err?.errno === "EPIPE") return true;
    return false;
};

/**
 * Executa `fn` dentro de uma transação.
 *
 * - `BEGIN ISOLATION LEVEL X` em uma round trip.
 * - `client.release(true)` quando o cliente está envenenado (erros fatais ou ROLLBACK falhou).
 * - Retry automático para `40001` (serialization) e `40P01` (deadlock) com backoff + jitter.
 *
 * ATENÇÃO: `fn` pode ser executada mais de uma vez em caso de retry.
 * Nunca envie email/SMS, chame API externa ou publique em fila dentro dela.
 * Use o padrão **outbox**: grave o evento numa tabela dentro da tx e dispare o efeito
 * colateral em worker separado.
 */
export async function withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    isolation: IsolationLevel = "READ COMMITTED",
    maxRetries?: number
): Promise<T> {
    const retries = maxRetries ?? (isolation === "SERIALIZABLE" ? 3 : 2);

    let attempt = 0;
    while (true) {
        const client = await writePool.connect();
        let destroy = false;
        try {
            await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
            const result = await txStore.run({ client }, () => fn(client));
            await client.query("COMMIT");
            return result;
        } catch (err: any) {
            if (isFatalConnError(err)) {
                destroy = true;
            } else {
                try {
                    await client.query("ROLLBACK");
                } catch (rollbackErr) {
                    logger.warn("ROLLBACK failed — destroying client", {
                        original: err?.message,
                        rollback: (rollbackErr as Error)?.message,
                    });
                    destroy = true;
                }
            }

            const retryable = err?.code === "40001" || err?.code === "40P01";
            if (retryable && ++attempt <= retries) {
                const backoff = 50 * 2 ** attempt + Math.random() * 50;
                await sleep(backoff);
                continue;
            }
            throw err;
        } finally {
            client.release(destroy);
        }
    }
}
