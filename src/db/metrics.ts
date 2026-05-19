import { writePool, readPool } from "@/db/pool";

export interface SinglePoolMetrics {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
}

export interface PoolMetrics {
    write: SinglePoolMetrics;
    read: SinglePoolMetrics;
}

/**
 * Métricas de ambos os pools — exporte para Prometheus/Datadog.
 *
 * - `waitingCount > 0` por 30s+ → alarme P1
 * - `idle/total < 0.1` sustentado → subdimensionado
 * - `idle/total > 0.9` constante → grande demais
 */
export function getPoolMetrics(): PoolMetrics {
    return {
        write: {
            totalCount: writePool.totalCount,
            idleCount: writePool.idleCount,
            waitingCount: writePool.waitingCount,
        },
        read: {
            totalCount: readPool.totalCount,
            idleCount: readPool.idleCount,
            waitingCount: readPool.waitingCount,
        },
    };
}
