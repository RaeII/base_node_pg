import dotenv from "dotenv";
import * as path from "path";

const getEnvs = () => {
    const dotenvResult = dotenv.config({ path: path.resolve(__dirname, "../../.env") });

    if (dotenvResult.error) {
        const processEnv = process.env;

        if (processEnv && !processEnv.error) return processEnv;
    }

    return dotenvResult;
};

const envFound: any = getEnvs();
if (envFound.error) {
    throw new Error(`Couldn't find .env file. ${envFound.error}`);
}

const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
};

const bool = (v: string | undefined) => v === "true" || v === "1";

export const env = {
    PORT: process.env.PORT,
    APP_NAME: process.env.APP_NAME || "base_node_pg",

    // PostgreSQL — conexão
    DB_HOST: process.env.DB_HOST,
    DB_PORT: num(process.env.DB_PORT, 5432),
    DB_NAME: process.env.DB_NAME,
    DB_APP_USER: process.env.DB_APP_USER,
    DB_APP_PASSWORD: process.env.DB_APP_PASSWORD,

    // SSL
    DB_SSL: bool(process.env.DB_SSL),
    DB_SSL_CA: process.env.DB_SSL_CA,

    // Pool tuning
    DB_POOL_MAX: num(process.env.DB_POOL_MAX, 16),
    DB_POOL_MIN: num(process.env.DB_POOL_MIN, 2),
    DB_STATEMENT_TIMEOUT_MS: num(process.env.DB_STATEMENT_TIMEOUT_MS, 10_000),
    DB_QUERY_TIMEOUT_MS: num(process.env.DB_QUERY_TIMEOUT_MS, 12_000),
    DB_LOCK_TIMEOUT_MS: num(process.env.DB_LOCK_TIMEOUT_MS, 3_000),
    DB_IDLE_TX_TIMEOUT_MS: num(process.env.DB_IDLE_TX_TIMEOUT_MS, 30_000),
    DB_IDLE_TIMEOUT_MS: num(process.env.DB_IDLE_TIMEOUT_MS, 10_000),
    DB_CONNECTION_TIMEOUT_MS: num(process.env.DB_CONNECTION_TIMEOUT_MS, 5_000),
    DB_MAX_LIFETIME_SECONDS: num(process.env.DB_MAX_LIFETIME_SECONDS, 1_800),

    DB_TIMEZONE: process.env.DB_TIMEZONE || "America/Sao_Paulo",

    isProduction: process.env.NODE_ENV === "production",

    AUTHORIZATION: Number(process?.env?.AUTHORIZATION || 0),
    JWT_SECRET: process.env.JWT_SECRET,

    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,

    LOG_LEVEL: process.env.LOG_LEVEL || "info",
};
