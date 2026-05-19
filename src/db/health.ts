import { writePool, readPool } from "@/db/pool";
import logger from "@/shared/utils/logger";

export type HealthStatus = "ok" | "degraded" | "down";

export interface HealthCheckResult {
    status: HealthStatus;
    detail: Record<string, unknown>;
}

/**
 * Health check em camadas:
 * - `ok`       → vincule à liveness probe (não reinicie pods em pressão)
 * - `degraded` → vincule à readiness probe (pare de mandar tráfego antes da saturação)
 * - `down`     → DB inacessível
 */
export async function healthCheck(): Promise<HealthCheckResult> {
    try {
        const t0 = Date.now();
        await writePool.query("SELECT 1");
        const ms = Date.now() - t0;

        const write = { waitingCount: writePool.waitingCount, idleCount: writePool.idleCount, totalCount: writePool.totalCount };
        const read  = { waitingCount: readPool.waitingCount,  idleCount: readPool.idleCount,  totalCount: readPool.totalCount  };

        const degraded =
            write.waitingCount > 0 || write.idleCount === 0 ||
            read.waitingCount  > 0 || read.idleCount  === 0 ||
            ms > 1_000;

        return {
            status: degraded ? "degraded" : "ok",
            detail: { ms, write, read },
        };
    } catch (err) {
        return {
            status: "down",
            detail: { error: err instanceof Error ? err.message : String(err) },
        };
    }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Aguarda o banco ficar disponível antes da app aceitar tráfego.
 * Backoff exponencial (1s → 2s → 4s … cap 30s). Falha após `retries`.
 *
 * Bootstrap recomendado: `waitForDatabase()` → `runMigrations()` → `app.listen()`.
 */
export async function waitForDatabase(retries = 10): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            await writePool.query("SELECT 1");
            logger.info("Database connection established");
            return;
        } catch (err) {
            const wait = Math.min(1_000 * 2 ** i, 30_000);
            logger.warn(`Database not ready (attempt ${i + 1}/${retries}) — retrying in ${wait}ms`, {
                error: err instanceof Error ? err.message : String(err),
            });
            await sleep(wait);
        }
    }
    throw new Error(`Database unavailable after ${retries} retries`);
}
