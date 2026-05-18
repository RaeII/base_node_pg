import Database from "@/shared/infra/database/Database";
import { getPagination } from "@/shared/utils/pagination";
import type { CreateUserDbInput, DbUserRow, UpdateUserDbInput } from "./schema/user.schema";

export default class UserDatabase extends Database {

  /**
   * Retorna usuários ativos com paginação em uma única query.
   * `COUNT(*) OVER ()` adiciona o total à projeção sem segundo round-trip.
   * Os parâmetros limit/offset são obtidos automaticamente via AsyncLocalStorage.
   */
  async findAll(): Promise<{ rows: DbUserRow[]; total: number }> {
    const { limit, offset } = getPagination();

    const result = await this.query<DbUserRow & { _total: string }>(
      `SELECT u.*, COUNT(*) OVER () AS _total
         FROM "user" u
        WHERE u.is_active = TRUE
        ORDER BY u.id ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const rawRows = result.rows;
    const total = Number(rawRows[0]?._total) || 0;
    const rows = rawRows.map(({ _total, ...row }) => row as DbUserRow);

    return { rows, total };
  }

  async findByUsername(username: string): Promise<DbUserRow | null> {
    const result = await this.query<DbUserRow>(
      `SELECT * FROM "user" WHERE username = $1 LIMIT 1`,
      [username]
    );
    return result.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<DbUserRow | null> {
    const result = await this.query<DbUserRow>(
      `SELECT * FROM "user" WHERE email = $1 LIMIT 1`,
      [email]
    );
    return result.rows[0] ?? null;
  }

  async findByUsernameOrEmail(identifier: string): Promise<DbUserRow | null> {
    const result = await this.query<DbUserRow>(
      `SELECT * FROM "user" WHERE username = $1 OR email = $1 LIMIT 1`,
      [identifier]
    );
    return result.rows[0] ?? null;
  }

  async findById(id: number): Promise<DbUserRow | null> {
    const result = await this.query<DbUserRow>(
      `SELECT * FROM "user" WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async createUser(input: CreateUserDbInput): Promise<{ id: number }> {
    // INSERT simples não é idempotente — desabilita retry
    const result = await this.query<{ id: number }>(
      `INSERT INTO "user"
         (username, email, password, is_active, is_admin, last_login_at)
       VALUES ($1, $2, $3, $4, $5, NULL)
       RETURNING id`,
      [input.username, input.email, input.passwordHash, input.isActive, input.isAdmin],
      { noRetry: true }
    );

    return { id: Number(result.rows[0].id) };
  }

  async updateUser(id: number, input: UpdateUserDbInput): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (input.username !== undefined) {
      fields.push(`username = $${i++}`);
      values.push(input.username);
    }
    if (input.email !== undefined) {
      fields.push(`email = $${i++}`);
      values.push(input.email);
    }
    if (input.passwordHash !== undefined) {
      fields.push(`password = $${i++}`);
      values.push(input.passwordHash);
    }
    if (input.isActive !== undefined) {
      fields.push(`is_active = $${i++}`);
      values.push(input.isActive);
    }
    if (input.isAdmin !== undefined) {
      fields.push(`is_admin = $${i++}`);
      values.push(input.isAdmin);
    }

    if (fields.length === 0) return;

    values.push(id);
    const sql = `UPDATE "user" SET ${fields.join(", ")} WHERE id = $${i}`;
    await this.query(sql, values);
  }

  async deactivateUser(id: number): Promise<void> {
    // UPDATE ... WHERE id é idempotente — retry seguro (default permite)
    await this.query(`UPDATE "user" SET is_active = FALSE WHERE id = $1`, [id]);
  }

  async updateLastLoginAt(id: number): Promise<void> {
    await this.query(`UPDATE "user" SET last_login_at = NOW() WHERE id = $1`, [id]);
  }
}
