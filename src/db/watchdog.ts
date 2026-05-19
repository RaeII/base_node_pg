import { env } from "@/config";
import { getPoolMetrics, type SinglePoolMetrics } from "@/db/metrics";
import logger from "@/shared/utils/logger";

type PoolName = "write" | "read";

interface AlertState {
    saturationTicks: number;
    lastAlertAt: number;
}

const state: Record<PoolName, AlertState> = {
    write: { saturationTicks: 0, lastAlertAt: 0 },
    read: { saturationTicks: 0, lastAlertAt: 0 },
};

let timer: NodeJS.Timeout | null = null;

const isSaturated = (m: SinglePoolMetrics): boolean =>
    m.waitingCount > 0 || (m.totalCount > 0 && m.idleCount === 0);

async function sendDiscord(content: string): Promise<void> {
    if (!env.DISCORD_WEBHOOK) return;
    try {
        const res = await fetch(env.DISCORD_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        });
        if (!res.ok) {
            logger.warn("Discord webhook returned non-2xx", { status: res.status });
        }
    } catch (err) {
        logger.warn("Discord webhook failed", {
            err: err instanceof Error ? err.message : String(err),
        });
    }
}

function formatAlert(pool: PoolName, m: SinglePoolMetrics): string {
    return [
        `🚨 **Pool \`${pool}\` saturado** (${env.APP_NAME})`,
        `\`waiting=${m.waitingCount}  idle=${m.idleCount}  total=${m.totalCount}\``,
        `Requisições estão na fila — banco prestes a saturar.`,
    ].join("\n");
}

function evaluate(pool: PoolName, m: SinglePoolMetrics): void {
    const s = state[pool];

    if (isSaturated(m)) {
        s.saturationTicks += 1;
        const now = Date.now();
        const reachedThreshold = s.saturationTicks >= env.POOL_WATCHDOG_SATURATION_TICKS;
        const cooledDown = now - s.lastAlertAt >= env.POOL_WATCHDOG_COOLDOWN_MS;

        if (reachedThreshold && cooledDown) {
            logger.error(`Pool ${pool} saturated`, { ...m, ticks: s.saturationTicks });
            void sendDiscord(formatAlert(pool, m));
            s.lastAlertAt = now;
        } else if (reachedThreshold) {
            // Já alertou recentemente — apenas log local enquanto durar
            logger.warn(`Pool ${pool} still saturated (cooldown active)`, m);
        }
    } else if (s.saturationTicks > 0) {
        // Recuperou — reseta o contador
        s.saturationTicks = 0;
    }
}

/**
 * Inicia checagem periódica dos pools.
 * Dispara alerta no Discord quando `waitingCount > 0` ou `idleCount === 0`
 * por `POOL_WATCHDOG_SATURATION_TICKS` checagens seguidas, respeitando cooldown.
 */
export function startPoolWatchdog(): void {
    if (timer) return;
    timer = setInterval(() => {
        const { write, read } = getPoolMetrics();
        evaluate("write", write);
        evaluate("read", read);
    }, env.POOL_WATCHDOG_INTERVAL_MS);
    // Não bloquear o event loop no shutdown
    timer.unref();
    logger.info("Pool watchdog started", {
        intervalMs: env.POOL_WATCHDOG_INTERVAL_MS,
        saturationTicks: env.POOL_WATCHDOG_SATURATION_TICKS,
        cooldownMs: env.POOL_WATCHDOG_COOLDOWN_MS,
        discordEnabled: Boolean(env.DISCORD_WEBHOOK),
    });
}

export function stopPoolWatchdog(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
