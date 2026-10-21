import { Request, Response, CookieOptions } from "express";
import jwt from "jsonwebtoken";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Get, Post, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags } from "@/shared/core/decorators/index";
import { env } from "@/config";
import UserService from "@/modules/user/user.service";
import UserController from "@/modules/user/user.controller";
import AuthService from "@/modules/auth/auth.service";
import AdminService from "@/modules/admin/admin.service";
import type { PublicUser } from "@/modules/user/schema/user.schema";
import {
  loginSchema,
  signupSchema,
  createJwtBodySchema,
  createJwtResponseSchema,
  errorResponseSchema,
  loginResponseSchema,
  signupResponseSchema,
  loginErrorResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  refreshResponseSchema,
  refreshTokenSchema,
  type LoginSchema,
  type RefreshToken,
} from "@/modules/auth/schemas/auth.schema";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware, { auditActor } from "@/shared/middlewares/admin.middleware";
import { loginRateLimiter, signupRateLimiter } from "@/shared/middlewares/rateLimit.middleware";
import { parseSchema, handleError, throwUser, AppError } from "@/shared/utils/error";
import { withTransaction } from "@/db/transaction";
import logger from "@/shared/utils/logger";

const ACCESS_COOKIE = "token_access";
const REFRESH_COOKIE = "token_refresh";
// Refresh token só trafega para /api/auth (refresh e logout), nunca nas demais
// rotas — menos exposição em log de proxy/APM. Prefixo "/api" vem do index.ts.
const REFRESH_COOKIE_PATH = "/api/auth";

/**
 * Atributos dos cookies de autenticação.
 * - `sameSite` default "lax" — bloqueia envio cross-site (defesa CSRF).
 *   "none" só com HTTPS + defesa CSRF própria (ver doc/arquitetura/seguranca).
 * - `domain` omitido por padrão → cookie host-only (mais restrito).
 */
function authCookieOptions(maxAgeSeconds?: number, path = "/"): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.COOKIE_SAMESITE,
    path,
    ...(maxAgeSeconds !== undefined && { maxAge: maxAgeSeconds * 1000 }),
    ...(env.COOKIE_DOMAIN && { domain: env.COOKIE_DOMAIN }),
  };
}

/** Identificador do login normalizado — username/email são salvos em minúsculas. */
function loginIdentifier(data: LoginSchema): string {
  return (data.login || data.email || data.username || "").trim().toLowerCase();
}

/** Cookie de refresh validado; null se ausente ou malformado. */
function readRefreshToken(req: Request): RefreshToken | null {
  const parsed = refreshTokenSchema.safeParse(req.cookies?.[REFRESH_COOKIE]);
  return parsed.success ? parsed.data : null;
}

@Route("/auth")
@ApiTags("Autenticação")
class AuthController extends Controller {
  private userService: UserService;
  private userController: UserController;
  private authService: AuthService;
  private adminService: AdminService;

  constructor() {
    super();
    this.userService = new UserService();
    this.userController = new UserController();
    this.authService = new AuthService();
    this.adminService = new AdminService();
  }

  /**
   * Access token (JWT curto) sempre; refresh token só quando há um novo
   * (login, signup ou rotação). Retorna o TTL do access em segundos.
   * `sid` liga o access à sessão — o adminMiddleware valida a elevação por ele.
   * Sem claim de admin: permissão admin é checada no banco, nunca no token.
   */
  private issueAuthCookies(res: Response, user: PublicUser, sessionId: string, refreshToken?: string): number {
    const jwtSecret = env.JWT_SECRET as string; // garantido no boot (loaders)
    const expiresIn = env.JWT_EXPIRES_IN_SECONDS;

    const payload = {
      sub: String(user.id),
      sid: sessionId,
      userId: user.id,
      username: user.username,
      email: user.email,
      type: "user",
    };

    const token = jwt.sign(payload, jwtSecret, { expiresIn, issuer: env.APP_NAME });
    res.cookie(ACCESS_COOKIE, token, authCookieOptions(expiresIn));

    if (refreshToken) {
      res.cookie(
        REFRESH_COOKIE,
        refreshToken,
        authCookieOptions(env.REFRESH_TOKEN_EXPIRES_IN_SECONDS, REFRESH_COOKIE_PATH)
      );
    }

    return expiresIn;
  }

  private clearAuthCookies(res: Response): void {
    // clearCookie precisa dos MESMOS atributos usados no set (exceto maxAge)
    res.clearCookie(ACCESS_COOKIE, authCookieOptions());
    res.clearCookie(REFRESH_COOKIE, authCookieOptions(undefined, REFRESH_COOKIE_PATH));
  }

  @Post("/create-jwt")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Gerar token JWT de serviço", "Gera um token JWT nomeado (service-to-service). Requer autenticação e permissão de administrador.")
  @ApiBody(createJwtBodySchema, "Dados para geração do token")
  @ApiResponse(200, "Token gerado com sucesso", createJwtResponseSchema)
  @ApiResponse(400, "Erro ao gerar token", errorResponseSchema)
  async createJWT(req: Request, res: Response) {
    try {
      const { name } = parseSchema(createJwtBodySchema, req.body);

      const jwtSecret = env.JWT_SECRET as string; // garantido no boot (loaders)
      const expiresIn = env.SERVICE_JWT_EXPIRES_IN_SECONDS;

      // type: "service" distingue de token de usuário — não carrega `sid`,
      // então nunca passa no adminMiddleware.
      const payload = {
        name,
        type: "service",
      };

      const token = jwt.sign(payload, jwtSecret, { expiresIn, issuer: env.APP_NAME });

      // Auditoria: registra quem emitiu o token de serviço
      logger.info("Service JWT issued", {
        name,
        issuedBy: res.locals?.jwt?.userId ?? null,
        expiresIn,
      });
      await this.adminService.audit({ ...auditActor(req, res), action: "service_token.create", detail: { name } });

      return this.sendSuccessResponse(res, {
        accessToken: token,
        expiresIn: expiresIn,
      });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/login")
  @Middleware(loginRateLimiter)
  @ApiSummary("Login", "Autentica um usuário com login/email/username e senha. Abre uma sessão e retorna os cookies de access (JWT) e refresh token.")
  @ApiBody(loginSchema, "Credenciais de acesso")
  @ApiResponse(200, "Login realizado com sucesso", loginResponseSchema)
  @ApiResponse(400, "Credenciais inválidas", loginErrorResponseSchema)
  async login(req: Request, res: Response) {
    try {
      const data = parseSchema(loginSchema, req.body);

      const user = await this.userService.authenticate({
        identifier: loginIdentifier(data),
        password: data.password,
      });

      const session = await this.authService.createSession(user.id);
      const expiresIn = this.issueAuthCookies(res, user, session.id, session.refreshToken);

      // Auditoria de acesso (nunca logar senha/token)
      logger.info("Login success", { userId: user.id, ip: req.ip });

      return res.status(200).json({
        data: user,
        expiresIn,
      });
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 401) {
        logger.warn("Login failed", { ip: req.ip });
      }
      return handleError(err, res);
    }
  }

  @Post("/admin/login")
  @Middleware(loginRateLimiter)
  @ApiSummary("Login administrativo", "Reautentica um administrador e abre uma sessão NOVA com elevação admin (expira após ADMIN_SESSION_IDLE_SECONDS sem uso e no máximo ADMIN_SESSION_MAX_SECONDS após o login). A sessão anterior deste navegador é revogada. Não-admin recebe o mesmo 401 de credencial inválida. Rate limit compartilhado com /auth/login.")
  @ApiBody(loginSchema, "Credenciais do administrador")
  @ApiResponse(200, "Login admin realizado com sucesso", loginResponseSchema)
  @ApiResponse(400, "Dados inválidos", loginErrorResponseSchema)
  @ApiResponse(401, "Credenciais inválidas", errorResponseSchema)
  async adminLogin(req: Request, res: Response) {
    try {
      const data = parseSchema(loginSchema, req.body);

      // bcrypt fora da transação — não segura conexão durante o hash.
      const user = await this.userService.authenticate({
        identifier: loginIdentifier(data),
        password: data.password,
        requireAdmin: true,
      });

      const previous = readRefreshToken(req);
      const session = await withTransaction(async () => {
        // Troca de privilégio = sessão nova (anti session fixation); a anterior morre.
        if (previous) await this.authService.revokeSession(previous);
        const created = await this.authService.createSession(user.id, true);
        await this.adminService.audit({ actorId: user.id, ip: req.ip ?? null, action: "admin.login" });
        return created;
      });

      const expiresIn = this.issueAuthCookies(res, user, session.id, session.refreshToken);

      logger.info("Admin login success", { userId: user.id, ip: req.ip });

      return res.status(200).json({
        data: user,
        expiresIn,
      });
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 401) {
        logger.warn("Admin login failed", { ip: req.ip });
      }
      return handleError(err, res);
    }
  }

  @Post("/signup")
  @Middleware(signupRateLimiter)
  @ApiSummary("Signup", "Cria uma conta de usuário comum com email obrigatório, abre uma sessão e retorna os cookies de access (JWT) e refresh token.")
  @ApiBody(signupSchema, "Dados para cadastro")
  @ApiResponse(201, "Cadastro realizado com sucesso", signupResponseSchema)
  @ApiResponse(400, "Dados inválidos", loginErrorResponseSchema)
  @ApiResponse(409, "Username ou e-mail já está em uso", errorResponseSchema)
  async signup(req: Request, res: Response) {
    try {
      const data = parseSchema(signupSchema, req.body);

      const user = await this.userController.createUser({
        username: data.username,
        email: data.email,
        password: data.password,
        is_active: true,
        is_admin: false,
      });

      const session = await this.authService.createSession(user.id);
      const expiresIn = this.issueAuthCookies(res, user, session.id, session.refreshToken);

      // Auditoria de cadastro (nunca logar senha/token)
      logger.info("Signup success", { userId: user.id, ip: req.ip });

      return res.status(201).json({
        data: user,
        expiresIn,
      });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/refresh")
  @ApiSummary("Renovar sessão", "Troca o refresh token (cookie token_refresh) por um novo access token e um novo refresh token (rotação). Reapresentar um refresh token já rotacionado revoga a sessão inteira.")
  @ApiResponse(200, "Sessão renovada", refreshResponseSchema)
  @ApiResponse(401, "Sessão ausente, expirada ou revogada", errorResponseSchema)
  async refresh(req: Request, res: Response) {
    try {
      const token = readRefreshToken(req);
      if (!token) {
        throwUser("Sessão expirada", 401);
      }

      const result = await withTransaction(() => this.authService.refresh(token));

      if (result.status === "reuse") {
        // Token já rotacionado reapresentado: vazou. Sessão foi revogada no COMMIT.
        logger.warn("Refresh token reuse detected — session revoked", { userId: result.userId, ip: req.ip });
        throwUser("Sessão expirada", 401);
      }

      const expiresIn = this.issueAuthCookies(
        res,
        result.user,
        token.id,
        result.status === "rotated" ? result.refreshToken : undefined
      );

      return res.status(200).json({ data: result.user, expiresIn });
    } catch (err) {
      // Sessão morta: remove os cookies para o navegador parar de reenviá-los.
      if (err instanceof AppError && err.statusCode === 401) this.clearAuthCookies(res);
      return handleError(err, res);
    }
  }

  @Get("/me")
  @Middleware(jwtMiddleware.validJWTNeeded.bind(jwtMiddleware))
  @ApiSummary("Usuário da sessão", "Retorna o usuário do access token (cookie token_access), lido do banco. O front chama no boot para validar a sessão.")
  @ApiResponse(200, "Usuário autenticado", meResponseSchema)
  @ApiResponse(401, "Sem sessão ou access token expirado", errorResponseSchema)
  async me(_req: Request, res: Response) {
    try {
      // Só token de usuário — token de serviço não tem userId.
      const payload = res.locals.jwt;
      if (payload?.type !== "user") {
        throwUser("Sessão expirada", 401);
      }

      const user = await this.userService.findById(Number(payload.userId));
      if (!user.is_active) {
        throwUser("Sessão expirada", 401);
      }

      return res.status(200).json({ data: user });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/logout")
  @ApiSummary("Logout", "Revoga a sessão (refresh token) no servidor e remove os cookies de autenticação.")
  @ApiResponse(200, "Logout realizado com sucesso", logoutResponseSchema)
  async logout(req: Request, res: Response) {
    try {
      const token = readRefreshToken(req);
      if (token) await this.authService.revokeSession(token);
    } catch (err) {
      // Falha ao revogar não impede o logout local; a sessão expira sozinha.
      logger.warn("Logout: falha ao revogar sessão", { message: (err as Error)?.message });
    }

    this.clearAuthCookies(res);
    return res.status(200).json({ message: "Logout realizado com sucesso" });
  }
}

export default AuthController;
