import { Request, Response } from "express";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Get, Post, Put, Delete, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags, ApiParam } from "@/shared/core/decorators/index";
import UserService from "@/modules/user/user.service";
import AdminService from "@/modules/admin/admin.service";
import {
  createUserSchema,
  createUserResponseSchema,
  updateUserSchema,
  userResponseSchema,
  usersListResponseSchema,
  messageResponseSchema,
  validationErrorResponseSchema,
  idParamsSchema,
  listUsersQuerySchema,
  type CreateUserInput,
  type PublicUser,
} from "@/modules/user/schema/user.schema";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware, { auditActor } from "@/shared/middlewares/admin.middleware";
import { parseSchema, handleError } from "@/shared/utils/error";
import { paginationMiddleware } from "@/shared/utils/pagination";
import { withTransaction } from "@/db/transaction";


@Route("/user")
@ApiTags("Usuários")
class UserController extends Controller {
  private userService: UserService;
  private adminService: AdminService;

  constructor() {
    super();
    this.userService = new UserService();
    this.adminService = new AdminService();
  }

  async createUser(data: CreateUserInput): Promise<PublicUser> {
    return await withTransaction(async () => {
      return await this.userService.createUser({
        username: data.username,
        email: data.email,
        password: data.password,
        is_active: data.is_active,
        is_admin: data.is_admin,
      });
    });
  }

  @Get("/")
  @Middleware(
    paginationMiddleware(),
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Listar usuários", "Retorna usuários com paginação e filtros. Query params: ?page=1&limit=20 (máx: 100)&search=texto&status=active|inactive|all (default active). Requer sessão admin.")
  @ApiParam("search", { in: "query", required: false, description: "Busca parcial em username/email (máx 100)" })
  @ApiParam("status", { in: "query", required: false, description: "active (default) | inactive | all" })
  @ApiResponse(200, "Lista paginada de usuários", usersListResponseSchema)
  @ApiResponse(400, "Filtros inválidos", validationErrorResponseSchema)
  async findAll(req: Request, res: Response) {
    try {
      const filters = parseSchema(listUsersQuerySchema, req.query);
      const result = await this.userService.findAll(filters);
      return res.status(200).json(result);
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Get("/:id")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Buscar usuário por ID", "Retorna os dados de um usuário específico. Requer sessão admin.")
  @ApiParam("id", { description: "ID do usuário", type: "integer" })
  @ApiResponse(200, "Dados do usuário", userResponseSchema)
  @ApiResponse(404, "Usuário não encontrado", messageResponseSchema)
  async findById(req: Request, res: Response) {
    try {
      const { id } = parseSchema(idParamsSchema, req.params);
      const user = await this.userService.findById(id);

      return res.status(200).json({
        data: user,
      });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Criar usuário", "Cria um novo usuário no sistema. Requer sessão admin. Auditado (user.create).")
  @ApiBody(createUserSchema, "Dados do novo usuário")
  @ApiResponse(201, "Usuário criado com sucesso", createUserResponseSchema)
  @ApiResponse(400, "Dados inválidos", validationErrorResponseSchema)
  async create(req: Request, res: Response) {
    try {
      const data = parseSchema(createUserSchema, req.body);

      const created = await withTransaction(async () => {
        const user = await this.userService.createUser(data);
        await this.adminService.audit({
          ...auditActor(req, res),
          action: "user.create",
          targetUserId: Number(user.id),
          detail: { is_admin: user.is_admin, is_active: user.is_active },
        });
        return user;
      });

      return res.status(201).json({
        data: created,
      });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Put("/:id")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Atualizar usuário", "Atualiza os dados de um usuário existente. Requer sessão admin. O admin não pode remover o próprio acesso nem se desativar. Auditado (user.update).")
  @ApiParam("id", { description: "ID do usuário", type: "integer" })
  @ApiBody(updateUserSchema, "Dados para atualização")
  @ApiResponse(200, "Usuário atualizado com sucesso", userResponseSchema)
  @ApiResponse(400, "Dados inválidos", validationErrorResponseSchema)
  @ApiResponse(404, "Usuário não encontrado", messageResponseSchema)
  async update(req: Request, res: Response) {
    try {
      const { id } = parseSchema(idParamsSchema, req.params);
      const data = parseSchema(updateUserSchema, req.body);

      const actor = auditActor(req, res);

      const updated = await withTransaction(async () => {
        const user = await this.userService.updateUser(id, data, actor.actorId);
        // Só os NOMES dos campos alterados — nunca valores (senha).
        await this.adminService.audit({
          ...actor,
          action: "user.update",
          targetUserId: id,
          detail: { fields: Object.keys(data) },
        });
        return user;
      });

      return res.status(200).json({
        data: updated,
      });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Delete("/:id")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Deletar usuário", "Desativa um usuário (soft delete) e encerra as sessões dele. Requer sessão admin. O admin não pode se desativar. Auditado (user.deactivate).")
  @ApiParam("id", { description: "ID do usuário", type: "integer" })
  @ApiResponse(200, "Usuário desativado com sucesso", messageResponseSchema)
  @ApiResponse(404, "Usuário não encontrado", messageResponseSchema)
  async delete(req: Request, res: Response) {
    try {
      const { id } = parseSchema(idParamsSchema, req.params);

      const actor = auditActor(req, res);

      await withTransaction(async () => {
        await this.userService.deleteUser(id, actor.actorId);
        await this.adminService.audit({ ...actor, action: "user.deactivate", targetUserId: id });
      });

      return res.status(200).json({
        message: "Usuário desativado com sucesso",
      });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/:id/revoke-sessions")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Encerrar sessões do usuário", "Revoga todas as sessões (refresh tokens e elevação admin) do usuário — força novo login. O access token em uso expira em até JWT_EXPIRES_IN_SECONDS. Requer sessão admin. Auditado (user.revoke_sessions).")
  @ApiParam("id", { description: "ID do usuário", type: "integer" })
  @ApiResponse(200, "Sessões encerradas", messageResponseSchema)
  @ApiResponse(404, "Usuário não encontrado", messageResponseSchema)
  async revokeSessions(req: Request, res: Response) {
    try {
      const { id } = parseSchema(idParamsSchema, req.params);

      await withTransaction(async () => {
        await this.userService.revokeSessions(id);
        await this.adminService.audit({ ...auditActor(req, res), action: "user.revoke_sessions", targetUserId: id });
      });

      return res.status(200).json({
        message: "Sessões encerradas com sucesso",
      });
    } catch (err) {
      return handleError(err, res);
    }
  }
}

export default UserController;
