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

type SameSite = "lax" | "strict" | "none";
const sameSite = (v: string | undefined): SameSite => {
    const s = (v || "").toLowerCase();
    return s === "strict" || s === "none" ? s : "lax";
};

export const env = {
    PORT: process.env.PORT,
    APP_NAME: process.env.APP_NAME || "base_node_pg",

    // PostgreSQL — conexão
    DB_HOST: process.env.DB_HOST,
    DB_PORT: num(process.env.DB_PORT, 5432),
    DB_NAME: process.env.DB_NAME,
    DB_APP_USER: process.env.DB_APP_USER,
    DB_APP_PASSWORD: process.env.DB_APP_PASSWORD,

    // Migration user (DDL) — opcional; cai no DB_APP_USER se omitido (dev/staging)
    DB_MIGRATION_USER: process.env.DB_MIGRATION_USER,
    DB_MIGRATION_PASSWORD: process.env.DB_MIGRATION_PASSWORD,

    // SSL
    DB_SSL: bool(process.env.DB_SSL),
    DB_SSL_CA: process.env.DB_SSL_CA,

    // Pool write
    DB_POOL_MAX: num(process.env.DB_POOL_MAX, 16),
    DB_POOL_MIN: num(process.env.DB_POOL_MIN, 2),
    DB_STATEMENT_TIMEOUT_MS: num(process.env.DB_STATEMENT_TIMEOUT_MS, 10_000),
    DB_QUERY_TIMEOUT_MS: num(process.env.DB_QUERY_TIMEOUT_MS, 12_000),
    DB_LOCK_TIMEOUT_MS: num(process.env.DB_LOCK_TIMEOUT_MS, 3_000),
    // 15s: reduzido de 30s — idle tx sob alta carga segura locks e causa efeito cascata
    DB_IDLE_TX_TIMEOUT_MS: num(process.env.DB_IDLE_TX_TIMEOUT_MS, 15_000),
    DB_IDLE_TIMEOUT_MS: num(process.env.DB_IDLE_TIMEOUT_MS, 10_000),
    // 2s: fail-fast — sob 20k usuários, 5s na fila resulta em thundering herd
    DB_CONNECTION_TIMEOUT_MS: num(process.env.DB_CONNECTION_TIMEOUT_MS, 2_000),
    DB_MAX_LIFETIME_SECONDS: num(process.env.DB_MAX_LIFETIME_SECONDS, 1_800),

    // Pool read (réplica) — omitir DB_READ_HOST para apontar ao primário (dev/staging)
    DB_READ_HOST: process.env.DB_READ_HOST,
    DB_READ_PORT: num(process.env.DB_READ_PORT, 0),       // 0 → usa DB_PORT
    DB_READ_POOL_MAX: num(process.env.DB_READ_POOL_MAX, 0), // 0 → usa DB_POOL_MAX
    DB_READ_POOL_MIN: num(process.env.DB_READ_POOL_MIN, 1),

    DB_TIMEZONE: process.env.DB_TIMEZONE || "America/Sao_Paulo",

    isProduction: process.env.NODE_ENV === "production",

    AUTHORIZATION: Number(process?.env?.AUTHORIZATION || 0),
    JWT_SECRET: process.env.JWT_SECRET,
    // TTL do JWT de usuário — sem mecanismo de revogação, mantenha curto
    JWT_EXPIRES_IN_SECONDS: num(process.env.JWT_EXPIRES_IN_SECONDS, 604_800), // 7 dias
    // TTL do JWT de serviço (POST /auth/create-jwt)
    SERVICE_JWT_EXPIRES_IN_SECONDS: num(process.env.SERVICE_JWT_EXPIRES_IN_SECONDS, 2_592_000), // 30 dias

    // ─── Segurança HTTP ───
    // Origens permitidas no CORS, separadas por vírgula. Vazio em produção = nenhuma origem cross-site.
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    // Domain do cookie de auth. Vazio = host-only (recomendado).
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
    // lax (default) | strict | none — "none" exige HTTPS e defesa CSRF própria
    COOKIE_SAMESITE: sameSite(process.env.COOKIE_SAMESITE),
    // Nº de proxies confiáveis à frente da app (1 atrás de nginx/traefik). Necessário p/ req.ip correto no rate limit.
    TRUST_PROXY: num(process.env.TRUST_PROXY, 0),
    // Rate limit global (por IP)
    RATE_LIMIT_WINDOW_MS: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    RATE_LIMIT_MAX: num(process.env.RATE_LIMIT_MAX, 300),
    // Rate limit do login (por IP, conta apenas tentativas falhas)
    RATE_LIMIT_LOGIN_WINDOW_MS: num(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 60_000),
    RATE_LIMIT_LOGIN_MAX: num(process.env.RATE_LIMIT_LOGIN_MAX, 5),

    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,

    // Watchdog do pool — checagens periódicas + alerta Discord
    POOL_WATCHDOG_INTERVAL_MS: num(process.env.POOL_WATCHDOG_INTERVAL_MS, 10_000),
    // Quantas checagens seguidas precisam estar saturadas antes de alertar (evita ruído de picos curtos)
    POOL_WATCHDOG_SATURATION_TICKS: num(process.env.POOL_WATCHDOG_SATURATION_TICKS, 3),
    // Cooldown entre alertas Discord para o mesmo problema (não floodar o canal)
    POOL_WATCHDOG_COOLDOWN_MS: num(process.env.POOL_WATCHDOG_COOLDOWN_MS, 300_000),

    LOG_LEVEL: process.env.LOG_LEVEL || "info",
};
