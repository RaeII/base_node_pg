import { Request, Response, CookieOptions } from "express";
import jwt from "jsonwebtoken";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Post, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags } from "@/shared/core/decorators/index";
import { env } from "@/config";
import UserService from "@/modules/user/user.service";
import UserController from "@/modules/user/user.controller";
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
} from "@/modules/auth/schemas/auth.schema";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware from "@/shared/middlewares/admin.middleware";
import { loginRateLimiter, signupRateLimiter } from "@/shared/middlewares/rateLimit.middleware";
import { parseSchema, handleError, AppError } from "@/shared/utils/error";
import logger from "@/shared/utils/logger";

/**
 * Atributos do cookie de autenticação.
 * - `sameSite` default "lax" — bloqueia envio cross-site (defesa CSRF).
 *   "none" só com HTTPS + defesa CSRF própria (ver doc/arquitetura/seguranca).
 * - `domain` omitido por padrão → cookie host-only (mais restrito).
 */
function authCookieOptions(maxAgeSeconds?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.COOKIE_SAMESITE,
    path: "/",
    ...(maxAgeSeconds !== undefined && { maxAge: maxAgeSeconds * 1000 }),
    ...(env.COOKIE_DOMAIN && { domain: env.COOKIE_DOMAIN }),
  };
}

@Route("/auth")
@ApiTags("Autenticação")
class AuthController extends Controller {
  private userService: UserService;
  private userController: UserController;

  constructor() {
    super();
    this.userService = new UserService();
    this.userController = new UserController();
  }

  private issueUserAuthCookie(res: Response, user: PublicUser): number {
    const jwtSecret = env.JWT_SECRET as string; // garantido no boot (loaders)
    const expiresIn = env.JWT_EXPIRES_IN_SECONDS;

    const payload = {
      sub: String(user.id),
      userId: user.id,
      username: user.username,
      email: user.email,
      admin: user.is_admin,
      type: "user",
    };

    const token = jwt.sign(payload, jwtSecret, { expiresIn, issuer: env.APP_NAME });
    res.cookie("token_access", token, authCookieOptions(expiresIn));

    return expiresIn;
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

      // type: "service" distingue de token de usuário — não carrega `admin`,
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
  @ApiSummary("Login", "Autentica um usuário com login/email/username e senha. Retorna um cookie JWT.")
  @ApiBody(loginSchema, "Credenciais de acesso")
  @ApiResponse(200, "Login realizado com sucesso", loginResponseSchema)
  @ApiResponse(400, "Credenciais inválidas", loginErrorResponseSchema)
  async login(req: Request, res: Response) {
    try {
      const data = parseSchema(loginSchema, req.body);

      // toLowerCase: username/email são normalizados em minúsculas na criação
      const identifier = (data.login || data.email || data.username || "")
        .trim()
        .toLowerCase();

      const user = await this.userService.authenticate({
        identifier,
        password: data.password,
      });

      const expiresIn = this.issueUserAuthCookie(res, user);

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

  @Post("/signup")
  @Middleware(signupRateLimiter)
  @ApiSummary("Signup", "Cria uma conta de usuário comum com email obrigatório e retorna um cookie JWT.")
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

      const expiresIn = this.issueUserAuthCookie(res, user);

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

  @Post("/logout")
  @ApiSummary("Logout", "Remove o cookie de autenticação do navegador.")
  @ApiResponse(200, "Logout realizado com sucesso", logoutResponseSchema)
  async logout(_req: Request, res: Response) {
    // clearCookie precisa dos MESMOS atributos usados no set (exceto maxAge)
    res.clearCookie("token_access", authCookieOptions());
    return res.status(200).json({ message: "Logout realizado com sucesso" });
  }
}

export default AuthController;
