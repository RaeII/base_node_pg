/**
 * Migration runner — sem ORM, sem dependência externa.
 *
 * Características:
 * - SET lock_timeout='2s' + statement_timeout='60s' antes de cada migração (falha rápido em vez de bloquear o banco).
 * - Retry com backoff exponencial quando lock contention (55P03 lock_not_available).
 * - Transação por migração com cleanup correto: release(true) em erro fatal de conexão.
 * - Checksum SHA-256 detecta migrações já aplicadas que foram editadas (corrupção do histórico).
 * - Roda com `migration_user` (cai no DB_APP_USER se omitido — útil em dev).
 *
 * Uso:
 *   bun run scripts/migrate.ts          # aplica pendentes
 *   bun run scripts/migrate.ts status   # lista o que foi aplicado
 */

import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import dotenv from "dotenv";

// Script standalone — carrega .env diretamente, sem depender de @/config
dotenv.config({ path: resolve(__dirname, "../.env") });

const ENV = {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: Number(process.env.DB_PORT) || 5432,
    DB_NAME: process.env.DB_NAME,
    DB_APP_USER: process.env.DB_APP_USER,
    DB_APP_PASSWORD: process.env.DB_APP_PASSWORD,
    DB_MIGRATION_USER: process.env.DB_MIGRATION_USER,
    DB_MIGRATION_PASSWORD: process.env.DB_MIGRATION_PASSWORD,
    DB_SSL: process.env.DB_SSL === "true" || process.env.DB_SSL === "1",
    DB_SSL_CA: process.env.DB_SSL_CA,
    APP_NAME: process.env.APP_NAME || "base_node_pg",
};

const MIGRATIONS_DIR = resolve(__dirname, "../migrations");
const MAX_RETRIES = 3;
const LOCK_RETRY_BASE_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sha256 = (content: string): string =>
    createHash("sha256").update(content).digest("hex");

interface MigrationFile {
    name: string;
    path: string;
    sql: string;
    checksum: string;
}

function listMigrationFiles(): MigrationFile[] {
    let files: string[];
    try {
        files = readdirSync(MIGRATIONS_DIR);
    } catch (err: any) {
        if (err.code === "ENOENT") {
            console.error(`Diretório de migrações não existe: ${MIGRATIONS_DIR}`);
            process.exit(1);
        }
        throw err;
    }

    return files
        .filter((f) => f.endsWith(".sql"))
        .sort() // ordem lexicográfica — use prefixo numérico (ex: 0001_init.sql)
        .map((name) => {
            const path = resolve(MIGRATIONS_DIR, name);
            const sql = readFileSync(path, "utf8");
            return { name, path, sql, checksum: sha256(sql) };
        });
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id          BIGSERIAL PRIMARY KEY,
            name        TEXT UNIQUE NOT NULL,
            checksum    TEXT NOT NULL,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function getApplied(client: PoolClient): Promise<Map<string, string>> {
    const { rows } = await client.query<{ name: string; checksum: string }>(
        "SELECT name, checksum FROM schema_migrations ORDER BY id",
    );
    return new Map(rows.map((r) => [r.name, r.checksum]));
}

const isLockTimeoutError = (err: any): boolean => err?.code === "55P03"; // lock_not_available

const isFatalConnError = (err: any): boolean => {
    const code = err?.code ?? "";
    if (/^(08|57P0)/.test(code)) return true;
    if (err?.errno === "ECONNRESET" || err?.errno === "EPIPE") return true;
    return false;
};

async function applyMigration(pool: Pool, mig: MigrationFile): Promise<void> {
    let attempt = 0;
    while (true) {
        const client = await pool.connect();
        let destroy = false;
        try {
            // lock_timeout agressivo: se outra sessão segura o lock, falha em 2s em vez de
            // enfileirar todas as queries da tabela. statement_timeout maior pois DDL pode demorar.
            await client.query("SET lock_timeout = '2s'");
            await client.query("SET statement_timeout = '60s'");

            await client.query("BEGIN");
            await client.query(mig.sql);
            await client.query(
                "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
                [mig.name, mig.checksum],
            );
            await client.query("COMMIT");
            console.log(`  ✓ ${mig.name}`);
            return;
        } catch (err: any) {
            if (isFatalConnError(err)) {
                destroy = true;
            } else {
                try {
                    await client.query("ROLLBACK");
                } catch {
                    destroy = true;
                }
            }

            if (isLockTimeoutError(err) && ++attempt < MAX_RETRIES) {
                const backoff = LOCK_RETRY_BASE_MS * 2 ** attempt + Math.random() * 200;
                console.warn(
                    `  ⚠ ${mig.name}: lock timeout — retry ${attempt}/${MAX_RETRIES - 1} em ${Math.round(backoff)}ms`,
                );
                await sleep(backoff);
                continue;
            }

            console.error(`  ✗ ${mig.name}: ${err?.message ?? err}`);
            throw err;
        } finally {
            client.release(destroy);
        }
    }
}

async function runStatus(pool: Pool): Promise<void> {
    const client = await pool.connect();
    try {
        await ensureMigrationsTable(client);
        const applied = await getApplied(client);
        const files = listMigrationFiles();

        console.log(`\nMigrations (${files.length} arquivos, ${applied.size} aplicadas):\n`);
        for (const f of files) {
            const isApplied = applied.has(f.name);
            const status = isApplied ? "✓ applied" : "· pending";
            const mismatch = isApplied && applied.get(f.name) !== f.checksum;
            const warn = mismatch ? "  ⚠ checksum mismatch (arquivo editado após apply)" : "";
            console.log(`  ${status}  ${f.name}${warn}`);
        }
    } finally {
        client.release();
    }
}

async function runMigrate(pool: Pool): Promise<void> {
    const initClient = await pool.connect();
    let applied: Map<string, string>;
    try {
        await ensureMigrationsTable(initClient);
        applied = await getApplied(initClient);
    } finally {
        initClient.release();
    }

    const files = listMigrationFiles();

    // Detecta migrações já aplicadas que foram editadas — sinal de corrupção do histórico.
    for (const f of files) {
        if (applied.has(f.name) && applied.get(f.name) !== f.checksum) {
            console.error(
                `\nERRO: ${f.name} já aplicada mas o conteúdo mudou (checksum diferente).\n` +
                `Migrações são imutáveis. Crie uma nova migração para alterar o schema.\n`,
            );
            process.exit(1);
        }
    }

    const pending = files.filter((f) => !applied.has(f.name));
    if (pending.length === 0) {
        console.log("Nada para aplicar — todas as migrações já estão no banco.");
        return;
    }

    console.log(`\nAplicando ${pending.length} migração(ões):\n`);
    for (const mig of pending) {
        await applyMigration(pool, mig);
    }
    console.log(`\nOK — ${pending.length} migração(ões) aplicada(s).`);
}

async function main(): Promise<void> {
    const cmd = process.argv[2] ?? "up";

    const pool = new Pool({
        host: ENV.DB_HOST,
        port: ENV.DB_PORT,
        database: ENV.DB_NAME,
        // Cai no usuário da app se DB_MIGRATION_USER não estiver definido (útil em dev).
        // Em produção sempre defina migration_user separado com permissões de DDL.
        user: ENV.DB_MIGRATION_USER || ENV.DB_APP_USER,
        password: ENV.DB_MIGRATION_PASSWORD || ENV.DB_APP_PASSWORD,
        ssl: ENV.DB_SSL ? { rejectUnauthorized: true, ca: ENV.DB_SSL_CA } : false,
        max: 2,
        application_name: `${ENV.APP_NAME}_migrate`,
        keepAlive: true,
    });

    try {
        if (cmd === "status" || cmd === "--status") {
            await runStatus(pool);
        } else if (cmd === "up" || cmd === "migrate") {
            await runMigrate(pool);
        } else {
            console.error(`Comando desconhecido: ${cmd}`);
            console.error(`Uso: bun run scripts/migrate.ts [up|status]`);
            process.exit(1);
        }
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
