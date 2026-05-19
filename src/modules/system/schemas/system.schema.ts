import { z } from "zod";

const poolStatsSchema = z.object({
    totalCount: z.number().int(),
    idleCount: z.number().int(),
    waitingCount: z.number().int(),
});

export const healthResponseSchema = z.object({
    status: z.enum(["ok", "degraded", "down"]),
    detail: z.object({
        ms: z.number().optional(),
        write: poolStatsSchema.optional(),
        read: poolStatsSchema.optional(),
        error: z.string().optional(),
    }),
});

export const metricsResponseSchema = z.object({
    write: poolStatsSchema,
    read: poolStatsSchema,
});
