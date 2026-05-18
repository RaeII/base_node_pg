import { Pool, type PoolConfig } from "pg";
import { env } from "@/config";
import logger from "@/shared/utils/logger";

const sslConfig: PoolConfig["ssl"] = env.DB_SSL
    ? {
          rejectUnauthorized: true,
          ca: env.DB_SSL_CA,
      }
    : false;

const baseConfig: PoolConfig = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_APP_USER,
    password: env.DB_APP_PASSWORD,
    ssl: sslConfig,
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
    // NUNCA deixar em 0 (default) — evita conexões zumbi
    maxLifetimeSeconds: env.DB_MAX_LIFETIME_SECONDS,
    application_name: env.APP_NAME,
    keepAlive: true,
    // Aplica timezone via startup packet — evita SET no evento connect (quebra com PgBouncer transaction mode)
    options: `-c timezone=${env.DB_TIMEZONE}`,
    // Timeouts via PoolConfig (lock_timeout NUNCA no postgresql.conf — afeta sessões administrativas)
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    // query_timeout > statement_timeout — evita race condition entre cancelamento server-side e desistência client-side
    query_timeout: env.DB_QUERY_TIMEOUT_MS,
    lock_timeout: env.DB_LOCK_TIMEOUT_MS,
    idle_in_transaction_session_timeout: env.DB_IDLE_TX_TIMEOUT_MS,
};

export const writePool = new Pool(baseConfig);

// Obrigatório — sem isso erro em client ocioso derruba o processo
writePool.on("error", (err) => {
    logger.error("Pool idle client error", { err: err instanceof Error ? err.message : String(err) });
});

export const drainPool = async (timeoutMs = 10_000): Promise<void> => {
    await Promise.race([
        writePool.end(),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Pool drain timeout")), timeoutMs)
        ),
    ]);
};
