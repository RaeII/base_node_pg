import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { writePool, readPool } from "@/db/pool";
import { getTxClient } from "@/db/transaction";
import logger from "@/shared/utils/logger";

const SLOW_QUERY_MS = 500;
const MAX_RETRIES = 3;

// Transient errors safe to retry (autocommit idempotent queries only)
const RETRYABLE_SQLSTATE = new Set([
    "08000", // connection_exception
    "08001", // sqlclient_unable_to_establish_sqlconnection
    "08003", // connection_does_not_exist
    "08004", // sqlserver_rejected_establishment
    "08006", // connection_failure
    "57P03", // cannot_connect_now
]);

const RETRYABLE_ERRNO = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRetryable = (err: any): boolean => {
    if (!err) return false;
    if (err.code && RETRYABLE_SQLSTATE.has(err.code)) return true;
    if (err.errno && RETRYABLE_ERRNO.has(err.errno)) return true;
    if (err.code && RETRYABLE_ERRNO.has(err.code)) return true;
    return false;
};

export interface QueryOptions {
    /** Cliente explícito (transação). Se omitido, tenta o ALS; depois cai no pool. */
    client?: PoolClient;
    /** Desabilita retry — usar em queries não-idempotentes (INSERT simples, UPDATE com contador). */
    noRetry?: boolean;
}

/** Executa query de escrita (ou leitura dentro de transação) via writePool. */
export async function query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
    opts: QueryOptions = {}
): Promise<QueryResult<T>> {
    const executor: PoolClient | typeof writePool = opts.client ?? getTxClient() ?? writePool;

    // Em transação não há retry (a transação precisa ser controlada por withTransaction)
    const allowRetry = !opts.noRetry && !opts.client && !getTxClient();

    let attempt = 0;
    while (true) {
        const t0 = Date.now();
        try {
            const result = await executor.query<T>(sql, params as any[]);
            const ms = Date.now() - t0;
            if (ms > SLOW_QUERY_MS) {
                logger.warn("Slow query", { sql, ms, paramCount: params?.length ?? 0 });
            }
            return result;
        } catch (err: any) {
            if (!allowRetry || !isRetryable(err) || ++attempt >= MAX_RETRIES) {
                logger.error("Query failed", {
                    sql,
                    paramCount: params?.length ?? 0,
                    code: err?.code,
                    message: err?.message,
                });
                throw err;
            }
            const backoff = Math.min(100 * 2 ** attempt + Math.random() * 100, 2_000);
            await sleep(backoff);
        }
    }
}

/**
 * Executa SELECT via readPool (réplica de leitura).
 * NÃO usar dentro de transações — use `query()` com o client da tx.
 * Retry automático para erros transientes com backoff exponencial + jitter.
 */
export async function readQuery<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
): Promise<QueryResult<T>> {
    let attempt = 0;
    while (true) {
        const t0 = Date.now();
        try {
            const result = await readPool.query<T>(sql, params as any[]);
            const ms = Date.now() - t0;
            if (ms > SLOW_QUERY_MS) {
                logger.warn("Slow read query", { sql, ms, paramCount: params?.length ?? 0 });
            }
            return result;
        } catch (err: any) {
            if (!isRetryable(err) || ++attempt >= MAX_RETRIES) {
                logger.error("Read query failed", {
                    sql,
                    paramCount: params?.length ?? 0,
                    code: err?.code,
                    message: err?.message,
                });
                throw err;
            }
            const backoff = Math.min(100 * 2 ** attempt + Math.random() * 100, 2_000);
            await sleep(backoff);
        }
    }
}
