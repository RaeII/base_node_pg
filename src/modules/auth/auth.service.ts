import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "@/config";
import AuthDatabase from "@/modules/auth/auth.database";
import UserService from "@/modules/user/user.service";
import type { PublicUser } from "@/modules/user/schema/user.schema";
import type { RefreshToken } from "@/modules/auth/schemas/auth.schema";
import { throwUser } from "@/shared/utils/error";

// Duas abas renovando ao mesmo tempo: a segunda chega com o segredo que a
// primeira acabou de rotacionar. Dentro desta janela é benigno, não roubo.
const REUSE_GRACE_SECONDS = 30;

// Segredo tem 256 bits de entropia: SHA-256 sem salt basta (bcrypt é para senha).
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");

export type RefreshResult =
  | { status: "rotated"; user: PublicUser; refreshToken: string }
  | { status: "grace"; user: PublicUser }
  | { status: "reuse"; userId: number };

export default class AuthService {
  private authDb: AuthDatabase;
  private userService: UserService;

  constructor() {
    this.authDb = new AuthDatabase();
    this.userService = new UserService();
  }

  /**
   * Abre uma sessão e devolve o id (claim `sid` do access) e o refresh token
   * (`<id>.<segredo>`). `admin = true` abre a sessão já elevada (login admin).
   */
  async createSession(userId: number, admin = false): Promise<{ id: string; refreshToken: string }> {
    await this.authDb.deleteStaleSessions(userId);

    const id = randomUUID();
    const secret = newSecret();
    await this.authDb.createSession(
      id,
      userId,
      sha256(secret),
      env.REFRESH_TOKEN_EXPIRES_IN_SECONDS,
      admin ? env.ADMIN_SESSION_IDLE_SECONDS : null
    );

    return { id, refreshToken: `${id}.${secret}` };
  }

  /** Valida e desliza a elevação admin da sessão. Retorna o id do admin ou null. */
  async touchAdminSession(sessionId: string): Promise<number | null> {
    const userId = await this.authDb.touchAdminSession(
      sessionId,
      env.ADMIN_SESSION_IDLE_SECONDS,
      env.ADMIN_SESSION_MAX_SECONDS
    );
    return userId === null ? null : Number(userId); // BIGINT chega como string do driver
  }

  /**
   * Rotaciona o refresh token. Chamar dentro de `withTransaction` (FOR UPDATE).
   * - segredo atual → novo segredo (rotação) + prazo renovado
   * - segredo anterior dentro da janela → só novo access token
   * - outro segredo → reuso (token vazado): revoga a sessão. Retorna em vez de
   *   lançar para o COMMIT persistir a revogação.
   */
  async refresh(token: RefreshToken): Promise<RefreshResult> {
    const session = await this.authDb.findSessionForUpdate(token.id, REUSE_GRACE_SECONDS);
    if (!session || session.revoked_at || session.expired) {
      throwUser("Sessão expirada", 401);
    }

    const userId = Number(session.user_id); // BIGINT chega como string do driver

    // Compara hashes, não o segredo — timingSafeEqual não agrega aqui.
    const hash = sha256(token.secret);
    if (hash !== session.token_hash) {
      if (hash === session.previous_token_hash && session.in_grace) {
        return { status: "grace", user: await this.activeUser(userId) };
      }
      await this.authDb.revokeSession(session.id);
      return { status: "reuse", userId };
    }

    const user = await this.activeUser(userId);
    const secret = newSecret();
    await this.authDb.rotateSession(session.id, sha256(secret), env.REFRESH_TOKEN_EXPIRES_IN_SECONDS);

    return { status: "rotated", user, refreshToken: `${session.id}.${secret}` };
  }

  async revokeSession(token: RefreshToken): Promise<void> {
    await this.authDb.revokeSessionByToken(token.id, sha256(token.secret));
  }

  /** Usuário da sessão — inativo não renova (401, igual a sessão expirada). */
  async activeUser(userId: number): Promise<PublicUser> {
    const user = await this.userService.findById(userId);
    if (!user.is_active) {
      throwUser("Sessão expirada", 401);
    }
    return user;
  }
}
