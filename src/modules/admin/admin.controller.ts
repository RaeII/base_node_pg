import { Request, Response } from "express";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Get, Middleware } from "@/shared/core/decorators";
import { ApiResponse, ApiSummary, ApiTags } from "@/shared/core/decorators/index";
import AdminService from "@/modules/admin/admin.service";
import UserService from "@/modules/user/user.service";
import {
  adminMeResponseSchema,
  auditListResponseSchema,
  statsResponseSchema,
  systemResponseSchema,
} from "@/modules/admin/schema/admin.schema";
import { messageResponseSchema } from "@/modules/user/schema/user.schema";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware from "@/shared/middlewares/admin.middleware";
import { handleError, throwUser } from "@/shared/utils/error";
import { paginationMiddleware } from "@/shared/utils/pagination";

/**
 * Área administrativa. Toda rota exige sessão admin elevada
 * (login em POST /auth/admin/login) — ver adminMiddleware.
 */
@Route("/admin")
@ApiTags("Administração")
class AdminController extends Controller {
  private adminService: AdminService;
  private userService: UserService;

  constructor() {
    super();
    this.adminService = new AdminService();
    this.userService = new UserService();
  }

  @Get("/me")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Admin da sessão", "Retorna o admin da sessão elevada. O front chama ao entrar na área admin: 403 = sem sessão admin (vai para o login admin).")
  @ApiResponse(200, "Sessão admin válida", adminMeResponseSchema)
  @ApiResponse(403, "Sem sessão admin", messageResponseSchema)
  async me(_req: Request, res: Response) {
    try {
      // Com AUTHORIZATION=0 o middleware não bloqueia — aqui a resposta segue a verdade.
      const adminId: number | undefined = res.locals.adminId;
      if (!adminId) {
        throwUser("Acesso restrito: entre pela área administrativa", 403);
      }

      const user = await this.userService.findById(adminId);
      return res.status(200).json({ data: user });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Get("/stats")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Números do painel", "Contagem de usuários (ativos, inativos, admins, novos em 7 dias, logins em 24h) e de sessões ativas.")
  @ApiResponse(200, "Estatísticas", statsResponseSchema)
  @ApiResponse(403, "Sem sessão admin", messageResponseSchema)
  async stats(_req: Request, res: Response) {
    try {
      const data = await this.adminService.getStats();
      return res.status(200).json({ data });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Get("/system")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Informações do sistema", "Saúde do banco e dos pools, runtime (Node, uptime, memória), dados do PostgreSQL e configuração de segurança efetiva. Nunca retorna segredos.")
  @ApiResponse(200, "Informações do sistema", systemResponseSchema)
  @ApiResponse(403, "Sem sessão admin", messageResponseSchema)
  async system(_req: Request, res: Response) {
    try {
      const data = await this.adminService.getSystemInfo();
      return res.status(200).json({ data });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Get("/audit")
  @Middleware(
    paginationMiddleware(),
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Trilha de auditoria", "Ações administrativas, mais recentes primeiro. Query params: ?page=1&limit=20 (máx: 100).")
  @ApiResponse(200, "Lista paginada de eventos", auditListResponseSchema)
  @ApiResponse(403, "Sem sessão admin", messageResponseSchema)
  async audit(_req: Request, res: Response) {
    try {
      const result = await this.adminService.listAudit();
      return res.status(200).json(result);
    } catch (err) {
      return handleError(err, res);
    }
  }
}

export default AdminController;
