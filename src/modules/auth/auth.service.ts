import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { env } from "@/config";
import AuthDatabase from "@/modules/auth/auth.database";
import UserDatabase from "@/modules/user/user.database";
import UserService from "@/modules/user/user.service";
import type { PublicUser } from "@/modules/user/schema/user.schema";
import type { GoogleRegisterInput, RefreshToken } from "@/modules/auth/schemas/auth.schema";
import { throwInternal, throwUser } from "@/shared/utils/error";

// Duas abas renovando ao mesmo tempo: a segunda chega com o segredo que a
// primeira acabou de rotacionar. Dentro desta janela é benigno, não roubo.
const REUSE_GRACE_SECONDS = 30;

// Segredo tem 256 bits de entropia: SHA-256 sem salt basta (bcrypt é para senha).
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");

// Prova do e-mail do Google para concluir o 1º acesso (tempo de escolher o username).
const REGISTRATION_TOKEN_TTL_SECONDS = 15 * 60;

// Chave derivada de contexto: a prova de cadastro nunca valida como token de sessão.
const registrationSecret = () =>
  createHmac("sha256", env.JWT_SECRET as string).update("google-registration").digest();

// Lazy: só instancia no primeiro login Google. Cacheia os certs do Google internamente.
let googleClient: OAuth2Client | null = null;

/** Campos do perfil Google consumidos do ID token já verificado. */
interface GoogleProfile {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export type GoogleAuthResult =
  | { status: "authenticated"; user: PublicUser }
  | {
      status: "registration_required";
      registrationToken: string;
      expiresAt: string;
      /** E-mail verificado do Google — não editável no cadastro. */
      email: string;
      /** Sugestão editável pelo usuário antes de confirmar. */
      username: string;
    };

export type RefreshResult =
  | { status: "rotated"; user: PublicUser; refreshToken: string }
  | { status: "grace"; user: PublicUser }
  | { status: "reuse"; userId: number };

export default class AuthService {
  private authDb: AuthDatabase;
  private userDb: UserDatabase;
  private userService: UserService;

  constructor() {
    this.authDb = new AuthDatabase();
    this.userDb = new UserDatabase();
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

  // ─── Login com Google (identificação dinâmica: entra OU cadastra) ─────────

  /**
   * Entra ou cadastra a partir do ID token do Google (GIS):
   *   1. Identidade Google já vinculada   → entra.
   *   2. E-mail (verificado) já tem conta → VINCULA o Google e entra (não duplica).
   *   3. Sem conta                        → NÃO cria: devolve prova assinada + username
   *      sugerido para o usuário confirmar em `registerWithGoogle`.
   * Vincular por e-mail só é seguro porque exige `email_verified=true` do Google.
   */
  async authenticateWithGoogle(credential: string): Promise<GoogleAuthResult> {
    const profile = await this.verifyGoogleIdToken(credential);

    const linkedUserId = await this.authDb.findIdentityUserId("google", profile.sub);
    if (linkedUserId !== null) return this.finishGoogleLogin(linkedUserId);

    // Sem e-mail verificado não vincula nem cria por e-mail (account takeover).
    if (!profile.email || !profile.emailVerified) {
      throwUser("E-mail do Google não verificado — não é possível entrar.", 400);
    }

    const existing = await this.userDb.findByEmail(profile.email);
    if (existing) {
      const userId = Number(existing.id); // BIGINT chega como string do driver
      if (!existing.is_active) throwUser("Conta desativada", 403);
      await this.authDb.createIdentity(userId, "google", profile.sub);
      return this.finishGoogleLogin(userId);
    }

    return {
      status: "registration_required",
      registrationToken: jwt.sign({ type: "registration", gsub: profile.sub }, registrationSecret(), {
        algorithm: "HS256",
        issuer: env.APP_NAME,
        subject: profile.email,
        expiresIn: REGISTRATION_TOKEN_TTL_SECONDS,
      }),
      expiresAt: new Date(Date.now() + REGISTRATION_TOKEN_TTL_SECONDS * 1000).toISOString(),
      email: profile.email,
      username: await this.suggestUsername(profile),
    };
  }

  /**
   * Conclui o 1º acesso pelo Google: usuário sem senha + identidade. E-mail e
   * `sub` vêm da prova assinada, nunca do body. Chamar dentro de `withTransaction`;
   * as UNIQUE do banco fecham corridas (23505 → 409 no handleError).
   */
  async registerWithGoogle(input: GoogleRegisterInput): Promise<PublicUser> {
    const proof = verifyRegistrationToken(input.registrationToken);

    if (await this.userDb.findByEmail(proof.email)) throwUser("E-mail já está em uso", 409);
    if (await this.userDb.findByUsername(input.username)) throwUser("Username já está em uso", 409);

    const { id } = await this.userDb.createUser({
      username: input.username,
      email: proof.email,
      passwordHash: null,
      isActive: true,
      isAdmin: false,
    });
    await this.authDb.createIdentity(id, "google", proof.googleSub);
    await this.userDb.updateLastLoginAt(id);

    return this.userService.findById(id);
  }

  private async finishGoogleLogin(userId: number): Promise<GoogleAuthResult> {
    const user = await this.userService.findById(userId);
    if (!user.is_active) throwUser("Conta desativada", 403);

    await this.userDb.updateLastLoginAt(userId);
    return { status: "authenticated", user: { ...user, last_login_at: new Date() } };
  }

  /**
   * Verifica o ID token com a lib oficial: assinatura (JWKS do Google, cache
   * interno), `aud` == GOOGLE_CLIENT_ID, `iss` ∈ accounts.google.com e expiração.
   * Nenhum campo do payload é confiável sem passar por aqui.
   */
  private async verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) throwInternal("Login com Google não configurado (GOOGLE_CLIENT_ID ausente)");

    googleClient ??= new OAuth2Client(clientId);

    let payload: TokenPayload | undefined;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throwUser("Token do Google inválido ou expirado", 401);
    }

    if (!payload?.sub) throwUser("Token do Google inválido", 401);

    return {
      sub: payload.sub,
      // user.email é armazenado em minúsculas.
      email: payload.email?.trim().toLowerCase() ?? null,
      emailVerified: payload.email_verified === true,
      name: payload.name?.trim() || null,
    };
  }

  /**
   * Username disponível derivado do nome do Google (parte local do e-mail como
   * fallback). É só sugestão: o usuário edita e o cadastro revalida.
   */
  private async suggestUsername(profile: GoogleProfile): Promise<string> {
    const source = profile.name || profile.email?.split("@")[0] || "";
    let base = source
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 40);
    if (base.length < 3) base = `user${base}`;

    const candidates = [base, ...Array.from({ length: 5 }, () => `${base}${randomInt(10, 10_000)}`)];
    for (const candidate of candidates) {
      if (!(await this.userDb.findByUsername(candidate))) return candidate;
    }
    return `user_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
}

/** Valida a prova de cadastro emitida por `authenticateWithGoogle`. */
function verifyRegistrationToken(token: string): { email: string; googleSub: string } {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, registrationSecret(), {
      algorithms: ["HS256"],
      issuer: env.APP_NAME,
    }) as JwtPayload;
  } catch {
    throwUser("Verificação expirada. Entre com o Google novamente.", 400);
  }

  if (payload.type !== "registration" || typeof payload.sub !== "string" || typeof payload.gsub !== "string") {
    throwUser("Verificação inválida. Entre com o Google novamente.", 400);
  }

  return { email: payload.sub, googleSub: payload.gsub };
}
