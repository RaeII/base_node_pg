import { Request, Response } from "express";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Get, Post, Put, Delete, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags, ApiParam } from "@/shared/core/decorators/index";
import UserService from "@/modules/user/user.service";
import {
  createUserSchema,
  createUserResponseSchema,
  updateUserSchema,
  userResponseSchema,
  usersListResponseSchema,
  messageResponseSchema,
  validationErrorResponseSchema,
  idParamsSchema,
  type CreateUserInput,
  type PublicUser,
} from "@/modules/user/schema/user.schema";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware from "@/shared/middlewares/admin.middleware";
import { parseSchema, handleError } from "@/shared/utils/error";
import { paginationMiddleware } from "@/shared/utils/pagination";
import { withTransaction } from "@/db/transaction";


@Route("/user")
@ApiTags("Usuários")
class UserController extends Controller {
  private userService: UserService;

  constructor() {
    super();
    this.userService = new UserService();
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
  @ApiSummary("Listar usuários", "Retorna usuários ativos com paginação. Query params: ?page=1&limit=20 (máx: 100). Requer autenticação JWT e permissão de administrador.")
  @ApiResponse(200, "Lista paginada de usuários", usersListResponseSchema)
  async findAll(req: Request, res: Response) {
    try {
      const result = await this.userService.findAll();
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
  @ApiSummary("Buscar usuário por ID", "Retorna os dados de um usuário específico. Requer autenticação JWT e permissão de administrador.")
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
  @ApiSummary("Criar usuário", "Cria um novo usuário no sistema. Requer autenticação JWT e permissão de administrador.")
  @ApiBody(createUserSchema, "Dados do novo usuário")
  @ApiResponse(201, "Usuário criado com sucesso", createUserResponseSchema)
  @ApiResponse(400, "Dados inválidos", validationErrorResponseSchema)
  async create(req: Request, res: Response) {
    try {
      const data = parseSchema(createUserSchema, req.body);

      const created = await this.createUser(data);

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
  @ApiSummary("Atualizar usuário", "Atualiza os dados de um usuário existente. Requer autenticação JWT e permissão de administrador.")
  @ApiParam("id", { description: "ID do usuário", type: "integer" })
  @ApiBody(updateUserSchema, "Dados para atualização")
  @ApiResponse(200, "Usuário atualizado com sucesso", userResponseSchema)
  @ApiResponse(400, "Dados inválidos", validationErrorResponseSchema)
  @ApiResponse(404, "Usuário não encontrado", messageResponseSchema)
  async update(req: Request, res: Response) {
    try {
      const { id } = parseSchema(idParamsSchema, req.params);
      const data = parseSchema(updateUserSchema, req.body);

      const updated = await withTransaction(async () => {
        return await this.userService.updateUser(id, data);
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
  @ApiSummary("Deletar usuário", "Desativa um usuário (soft delete). Requer autenticação JWT e permissão de administrador.")
  @ApiParam("id", { description: "ID do usuário", type: "integer" })
  @ApiResponse(200, "Usuário desativado com sucesso", messageResponseSchema)
  @ApiResponse(404, "Usuário não encontrado", messageResponseSchema)
  async delete(req: Request, res: Response) {
    try {
      const { id } = parseSchema(idParamsSchema, req.params);

      await withTransaction(async () => {
        await this.userService.deleteUser(id);
      });

      return res.status(200).json({
        message: "Usuário desativado com sucesso",
      });
    } catch (err) {
      return handleError(err, res);
    }
  }
}

export default UserController;
