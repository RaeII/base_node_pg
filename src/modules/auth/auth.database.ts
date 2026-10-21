import Database from "@/shared/infra/database/Database";
import type { DbAuthSessionRow } from "./schemas/auth.schema";

/** Provedores de login externos (`auth_identity.provider`). */
export type AuthProvider = "google";

// Tabela guarda hash de token — projeção explícita, nunca SELECT *.
const SESSION_COLUMNS = `id, user_id, token_hash, previous_token_hash, revoked_at`;

export default class AuthDatabase extends Database {

  /** `adminIdleSeconds` != null abre a sessão já elevada (login admin). */
  async createSession(
    id: string,
    userId: number,
    tokenHash: string,
    ttlSeconds: number,
    adminIdleSeconds: number | null = null
  ): Promise<void> {
    // INSERT simples não é idempotente — desabilita retry. NULL * INTERVAL = NULL (sessão comum).
    await this.query(
      `INSERT INTO auth_session (id, user_id, token_hash, expires_at, admin_expires_at)
       VALUES ($1, $2, $3, NOW() + $4 * INTERVAL '1 second', NOW() + $5 * INTERVAL '1 second')`,
      [id, userId, tokenHash, ttlSeconds, adminIdleSeconds],
      { noRetry: true }
    );
  }

  /**
   * Valida a elevação admin e desliza o prazo de inatividade numa ida ao banco.
   * Só retorna linha se a sessão está viva, a elevação no prazo e o usuário
   * AINDA é ativo e admin — rebaixar/desativar corta o acesso na hora.
   * O teto absoluto conta de `created_at`: toda elevação nasce numa sessão nova.
   */
  async touchAdminSession(id: string, idleSeconds: number, maxSeconds: number): Promise<string | null> {
    const result = await this.query<{ user_id: string }>(
      `UPDATE auth_session s
          SET admin_expires_at = LEAST(NOW() + $2 * INTERVAL '1 second',
                                       s.created_at + $3 * INTERVAL '1 second')
         FROM "user" u
        WHERE s.id = $1
          AND u.id = s.user_id
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
          AND s.admin_expires_at > NOW()
          AND s.created_at > NOW() - $3 * INTERVAL '1 second'
          AND u.is_active AND u.is_admin
    RETURNING s.user_id`,
      [id, idleSeconds, maxSeconds]
    );
    return result.rows[0]?.user_id ?? null;
  }

  /** Limpeza oportunista no login — sem isso a tabela só cresce. */
  async deleteStaleSessions(userId: number): Promise<void> {
    await this.query(
      `DELETE FROM auth_session WHERE user_id = $1 AND (expires_at < NOW() OR revoked_at IS NOT NULL)`,
      [userId]
    );
  }

  /**
   * Trava a sessão (FOR UPDATE) para serializar refresh concorrente.
   * Só faz sentido dentro de `withTransaction`. Expiração e janela de
   * tolerância são calculadas no relógio do banco.
   */
  async findSessionForUpdate(id: string, graceSeconds: number): Promise<DbAuthSessionRow | null> {
    const result = await this.query<DbAuthSessionRow>(
      `SELECT ${SESSION_COLUMNS},
              expires_at <= NOW() AS expired,
              COALESCE(rotated_at > NOW() - $2 * INTERVAL '1 second', FALSE) AS in_grace
         FROM auth_session
        WHERE id = $1
          FOR UPDATE`,
      [id, graceSeconds]
    );
    return result.rows[0] ?? null;
  }

  async rotateSession(id: string, tokenHash: string, ttlSeconds: number): Promise<void> {
    await this.query(
      `UPDATE auth_session
          SET previous_token_hash = token_hash,
              token_hash = $2,
              rotated_at = NOW(),
              expires_at = NOW() + $3 * INTERVAL '1 second'
        WHERE id = $1`,
      [id, tokenHash, ttlSeconds]
    );
  }

  async revokeSession(id: string): Promise<void> {
    await this.query(`UPDATE auth_session SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  }

  /** Logout: só revoga se o segredo confere (atual ou anterior) — id sozinho não basta. */
  async revokeSessionByToken(id: string, tokenHash: string): Promise<void> {
    await this.query(
      `UPDATE auth_session SET revoked_at = NOW()
        WHERE id = $1 AND $2 IN (token_hash, previous_token_hash) AND revoked_at IS NULL`,
      [id, tokenHash]
    );
  }

  /** Usuário vinculado à conta do provedor (ex.: `sub` do Google), ou null. */
  async findIdentityUserId(provider: AuthProvider, providerAccountId: string): Promise<number | null> {
    const result = await this.query<{ user_id: string }>(
      `SELECT user_id FROM auth_identity WHERE provider = $1 AND provider_account_id = $2`,
      [provider, providerAccountId]
    );
    const userId = result.rows[0]?.user_id;
    return userId === undefined ? null : Number(userId); // BIGINT chega como string do driver
  }

  /** Vincula a conta do provedor ao usuário. ON CONFLICT torna idempotente (duplo clique/duas abas). */
  async createIdentity(userId: number, provider: AuthProvider, providerAccountId: string): Promise<void> {
    await this.query(
      `INSERT INTO auth_identity (user_id, provider, provider_account_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_account_id) DO NOTHING`,
      [userId, provider, providerAccountId]
    );
  }

  /** Encerra todas as sessões do usuário (troca de senha, desativação). */
  async revokeAllSessions(userId: number): Promise<void> {
    await this.query(
      `UPDATE auth_session SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }
}
