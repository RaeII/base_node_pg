import Database from "@/shared/infra/database/Database";
import { getPagination } from "@/shared/utils/pagination";
import type { CreateUserDbInput, DbUserRow, UpdateUserDbInput } from "./schema/user.schema";

export default class UserDatabase extends Database {

  /**
   * Retorna usuários ativos com paginação em uma única query.
   * A subquery escalar (não-correlacionada) é executada uma única vez pelo MySQL,
   * evitando um round-trip extra ao banco.
   * Os parâmetros limit/offset são obtidos automaticamente via AsyncLocalStorage.
   */
  async findAll(): Promise<{ rows: DbUserRow[]; total: number }> {
    const { limit, offset } = getPagination();

    const [result] = await this.query(
      `SELECT u.*, (SELECT COUNT(*) FROM user WHERE is_active = 1) AS _total
       FROM user u
       WHERE u.is_active = 1
       ORDER BY u.id ASC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const typedRows = (result as Array<DbUserRow & { _total: number }>) || [];
    const total = Number(typedRows[0]?._total) || 0;
    const rows = typedRows.map(({ _total, ...row }) => row as unknown as DbUserRow);

    return { rows, total };
  }

  async findByUsername(username: string): Promise<DbUserRow | null> {
    const [rows] = await this.query("SELECT * FROM user WHERE username = ? LIMIT 1", [username]);
    const row = (rows as DbUserRow[])?.[0];
    return row || null;
  }

  async findByEmail(email: string): Promise<DbUserRow | null> {
    const [rows] = await this.query("SELECT * FROM user WHERE email = ? LIMIT 1", [email]);
    const row = (rows as DbUserRow[])?.[0];
    return row || null;
  }

  async findByUsernameOrEmail(identifier: string): Promise<DbUserRow | null> {
    const [rows] = await this.query(
      "SELECT * FROM user WHERE username = ? OR email = ? LIMIT 1",
      [identifier, identifier]
    );
    const row = (rows as DbUserRow[])?.[0];
    return row || null;
  }

  async findById(id: number): Promise<DbUserRow | null> {
    const [rows] = await this.query("SELECT * FROM user WHERE id = ? LIMIT 1", [id]);
    const row = (rows as DbUserRow[])?.[0];
    return row || null;
  }

  async createUser(input: CreateUserDbInput): Promise<{ id: number }> {
    const sql = `
      INSERT INTO user
        (username, email, password, is_active, is_admin, last_login_at)
      VALUES
        (?, ?, ?, ?, ?, NULL)
    `.trim();

    const [result] = await this.query(sql, [
      input.username,
      input.email,
      input.passwordHash,
      input.isActive,
      input.isAdmin,
    ]);

    // mysql2: ResultSetHeader
    const insertId = (result as any)?.insertId;
    return { id: Number(insertId) };
  }

  async updateUser(id: number, input: UpdateUserDbInput): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.username !== undefined) {
      fields.push("username = ?");
      values.push(input.username);
    }
    if (input.email !== undefined) {
      fields.push("email = ?");
      values.push(input.email);
    }
    if (input.passwordHash !== undefined) {
      fields.push("password = ?");
      values.push(input.passwordHash);
    }
    if (input.isActive !== undefined) {
      fields.push("is_active = ?");
      values.push(input.isActive ? 1 : 0);
    }
    if (input.isAdmin !== undefined) {
      fields.push("is_admin = ?");
      values.push(input.isAdmin ? 1 : 0);
    }

    if (fields.length === 0) return;

    values.push(id);
    const sql = `UPDATE user SET ${fields.join(", ")} WHERE id = ? LIMIT 1`;
    await this.query(sql, values);
  }

  async deactivateUser(id: number): Promise<void> {
    await this.query("UPDATE user SET is_active = 0 WHERE id = ? LIMIT 1", [id]);
  }

  async updateLastLoginAt(id: number): Promise<void> {
    await this.query("UPDATE user SET last_login_at = NOW() WHERE id = ? LIMIT 1", [id]);
  }
}

