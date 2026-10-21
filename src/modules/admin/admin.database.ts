import Database from "@/shared/infra/database/Database";
import { getPagination } from "@/shared/utils/pagination";
import type { AdminStats, AuditEntry, AuditInput, DatabaseInfo } from "./schema/admin.schema";

export default class AdminDatabase extends Database {

  async insertAudit(entry: AuditInput): Promise<void> {
    // INSERT simples não é idempotente — desabilita retry
    await this.query(
      `INSERT INTO audit_log (actor_id, action, target_user_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.actorId, entry.action, entry.targetUserId ?? null, entry.detail ?? null, entry.ip],
      { noRetry: true }
    );
  }

  /** Mais recentes primeiro, paginado (limit/offset via AsyncLocalStorage). */
  async findAudit(): Promise<{ rows: AuditEntry[]; total: number }> {
    const { limit, offset } = getPagination();

    const result = await this.query<AuditEntry & { _total: string }>(
      `SELECT a.id, a.action,
              a.actor_id, actor.username AS actor_username,
              a.target_user_id, target.username AS target_username,
              a.detail, a.ip, a.created_at,
              COUNT(*) OVER () AS _total
         FROM audit_log a
         LEFT JOIN "user" actor  ON actor.id  = a.actor_id
         LEFT JOIN "user" target ON target.id = a.target_user_id
        ORDER BY a.id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = Number(result.rows[0]?._total) || 0;
    const rows = result.rows.map(({ _total, ...row }) => row as AuditEntry);

    return { rows, total };
  }

  /** Números do painel em uma ida ao banco. */
  async getStats(): Promise<AdminStats> {
    const result = await this.query<AdminStats>(
      `SELECT COUNT(*)::int                                                         AS "totalUsers",
              COUNT(*) FILTER (WHERE is_active)::int                                AS "activeUsers",
              COUNT(*) FILTER (WHERE NOT is_active)::int                            AS "inactiveUsers",
              COUNT(*) FILTER (WHERE is_active AND is_admin)::int                   AS "admins",
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int   AS "newUsersLast7Days",
              COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours')::int AS "loginsLast24h",
              (SELECT COUNT(*)::int FROM auth_session
                WHERE revoked_at IS NULL AND expires_at > NOW())                    AS "activeSessions",
              (SELECT COUNT(*)::int FROM auth_session
                WHERE revoked_at IS NULL AND expires_at > NOW()
                  AND admin_expires_at > NOW())                                     AS "adminSessions"
         FROM "user"`
    );
    return result.rows[0];
  }

  async getDatabaseInfo(): Promise<DatabaseInfo> {
    const result = await this.query<{ version: string; size_bytes: string; connections: number }>(
      `SELECT current_setting('server_version')     AS version,
              pg_database_size(current_database()) AS size_bytes,
              (SELECT COUNT(*)::int FROM pg_stat_activity
                WHERE datname = current_database()) AS connections`
    );
    const row = result.rows[0];
    return {
      version: row.version,
      sizeBytes: Number(row.size_bytes), // BIGINT chega como string do driver
      connections: row.connections,
    };
  }
}
