import { writePool } from "@/db/pool";

export interface PoolMetrics {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
}

/**
 * Métricas do pool — exporte para Prometheus/Datadog.
 *
 * - `waitingCount > 0` por 30s+ → alarme P1
 * - `idle/total < 0.1` sustentado → subdimensionado
 * - `idle/total > 0.9` constante → grande demais
 */
export function getPoolMetrics(): PoolMetrics {
    return {
        totalCount: writePool.totalCount,
        idleCount: writePool.idleCount,
        waitingCount: writePool.waitingCount,
    };
}
