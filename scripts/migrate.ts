/**
 * Runner de migrações simples — aplica arquivos `.sql` em ordem.
 *
 * - Conecta com `migration_user` (NÃO use app_user).
 * - Aplica `lock_timeout = '2s'` agressivo antes de cada migração:
 *   DDL precisa de AccessExclusiveLock; se outra transação segura o lock,
 *   a migração falha rápido em vez de bloquear todo o tráfego da aplicação.
 * - Rastreia migrações aplicadas em `schema_migrations`.
 *
 * Uso:
 *   DB_HOST=... DB_PORT=... DB_NAME=... \
 *   MIGRATION_USER=migration_user MIGRATION_PASSWORD=... \
 *   ts-node scripts/migrate.ts
 */

import { Client } from "pg";
import * as fs from "node:fs";
import * as path from "node:path";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureTable(client: Client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id          TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function alreadyApplied(client: Client, id: string): Promise<boolean> {
    const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM schema_migrations WHERE id = $1`,
        [id]
    );
    return rows.length > 0;
}

async function runMigration(client: Client, id: string, sql: string) {
    // lock_timeout agressivo + statement_timeout generoso (DDL pode ser longo)
    await client.query(`SET lock_timeout = '2s'`);
    await client.query(`SET statement_timeout = '60s'`);

    await client.query("BEGIN");
    try {
        await client.query(sql);
        await client.query(
            `INSERT INTO schema_migrations (id) VALUES ($1)`,
            [id]
        );
        await client.query("COMMIT");
        console.log(`✔ applied ${id}`);
    } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
    }
}

async function main() {
    const client = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME,
        user: process.env.MIGRATION_USER || "migration_user",
        password: process.env.MIGRATION_PASSWORD,
        application_name: "migrate-runner",
    });

    await client.connect();

    try {
        await ensureTable(client);

        const files = fs
            .readdirSync(MIGRATIONS_DIR)
            .filter((f) => f.endsWith(".sql"))
            .sort();

        for (const file of files) {
            const id = file;
            if (await alreadyApplied(client, id)) {
                console.log(`↷ skipped ${id} (already applied)`);
                continue;
            }
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

            // Retry simples para lock_timeout — backoff exponencial
            const MAX = 3;
            for (let attempt = 1; ; attempt++) {
                try {
                    await runMigration(client, id, sql);
                    break;
                } catch (err: any) {
                    if (err?.code === "55P03" && attempt < MAX) {
                        const wait = 1_000 * 2 ** attempt;
                        console.warn(`lock_timeout em ${id} — retry em ${wait}ms`);
                        await sleep(wait);
                        continue;
                    }
                    throw err;
                }
            }
        }
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
