import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Post, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags } from "@/shared/core/decorators/index";
import { env } from "@/config";
import UserService from "@/modules/user/user.service";
import {
  loginSchema,
  createJwtBodySchema,
  createJwtResponseSchema,
  errorResponseSchema,
  loginResponseSchema,
  loginErrorResponseSchema,
} from "@/modules/auth/schemas/auth.schema";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware from "@/shared/middlewares/admin.middleware";
import { parseSchema, handleError } from "@/shared/utils/error";

@Route("/auth")
@ApiTags("Autenticação")
class AuthController extends Controller {
  private userService: UserService;

  constructor() {
    super();
    this.userService = new UserService();
  }

  @Post("/create-jwt")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Gerar token JWT", "Gera um token JWT para um nome específico. Requer autenticação e permissão de administrador.")
  @ApiBody(createJwtBodySchema, "Dados para geração do token")
  @ApiResponse(200, "Token gerado com sucesso", createJwtResponseSchema)
  @ApiResponse(400, "Erro ao gerar token", errorResponseSchema)
  async createJWT(req: Request, res: Response) {
    try {
      const { name }: { name: string } = req.body;

      const jwtSecret = process.env.JWT_SECRET || "default_secret_key";
      const expiresIn = 60 * 60 * 24 * 30; // 30 dias

      const payload = {
        name,
      };

      const token = jwt.sign(payload, jwtSecret, { expiresIn });

      return this.sendSuccessResponse(res, {
        accessToken: token,
        expiresIn: expiresIn,
      });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/login")
  @ApiSummary("Login", "Autentica um usuário com login/email/username e senha. Retorna um cookie JWT.")
  @ApiBody(loginSchema, "Credenciais de acesso")
  @ApiResponse(200, "Login realizado com sucesso", loginResponseSchema)
  @ApiResponse(400, "Credenciais inválidas", loginErrorResponseSchema)
  async login(req: Request, res: Response) {
    try {
      const data = parseSchema(loginSchema, req.body);

      const identifier = (data.login || data.email || data.username || "").trim();

      const user = await this.userService.authenticate({
        identifier,
        password: data.password,
      });

      const jwtSecret = env.JWT_SECRET || "default_secret_key";
      const expiresIn = 60 * 60 * 24 * 30; // 30 dias

      const payload = {
        sub: String(user.id),
        userId: user.id,
        username: user.username,
        email: user.email,
        admin: user.is_admin,
      };

      const token = jwt.sign(payload, jwtSecret, { expiresIn });

      res.cookie("token_access", token, {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: env.isProduction ? "none" : "lax",
        maxAge: expiresIn,
        path: "/",
        domain: env.isProduction ? ".example.com" : "localhost",
      });

      return res.status(200).json({
        data: user,
        expiresIn,
      });
    } catch (err) {
      return handleError(err, res);
    }
  }
}

export default AuthController;