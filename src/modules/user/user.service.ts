import * as bcrypt from "bcrypt";
import UserDatabase from "@/modules/user/user.database";
import type { AuthenticateUserInput, CreateUserInput, DbUserRow, PublicUser, UpdateUserInput } from "./schema/user.schema";
import { throwUser, throwInternal } from "@/shared/utils/error";
import { paginatedResponse, type PaginatedResult } from "@/shared/utils/pagination";

// Custo equilibrado para API (ajuste se necessário)
const SALT_ROUNDS = 12;

// Hash "sacrifício": quando o usuário não existe, compara contra este hash
// para a resposta demorar o mesmo que uma senha errada — sem isso, a diferença
// de tempo revela quais usuários existem (timing attack).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("__timing_equalizer__", SALT_ROUNDS);

function toPublicUser(row: DbUserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    is_active: row.is_active,
    is_admin: row.is_admin,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default class UserService {
  private userDb: UserDatabase;

  constructor() {
    this.userDb = new UserDatabase();
  }

  /**
   * Retorna usuários ativos com paginação.
   * Os parâmetros de paginação são resolvidos via AsyncLocalStorage.
   */
  async findAll(): Promise<PaginatedResult<PublicUser>> {
    const { rows, total } = await this.userDb.findAll();
    return paginatedResponse(rows.map(toPublicUser), total);
  }

  /**
   * Busca um usuário pelo ID.
   * Lança erro 404 se não encontrado.
   */
  async findById(id: number): Promise<PublicUser> {
    const row = await this.userDb.findById(id);
    if (!row) {
      throwUser("Usuário não encontrado", 404);
    }
    return toPublicUser(row);
  }

  /**
   * Autentica um usuário por email ou username + senha.
   * Retorna APENAS dados públicos (nunca retorna hash da senha).
   *
   * Anti-enumeração: inexistente, senha errada e inativo respondem TODOS
   * com o mesmo 401 "Credenciais inválidas", em tempo equivalente.
   */
  async authenticate(input: AuthenticateUserInput): Promise<PublicUser> {
    const identifier = input.identifier.trim().toLowerCase();
    const password = input.password;

    const row = await this.userDb.findByUsernameOrEmail(identifier);

    const ok = await bcrypt.compare(password, row?.password || DUMMY_PASSWORD_HASH);

    if (!row || !ok || !row.is_active) {
      throwUser("Credenciais inválidas", 401);
    }

    await this.userDb.updateLastLoginAt(row.id);
    const updated = await this.userDb.findById(row.id);
    return toPublicUser(updated || row);
  }

  async createUser(input: CreateUserInput): Promise<PublicUser> {
    const existingByUsername = await this.userDb.findByUsername(input.username);
    if (existingByUsername) {
      throwUser("Username já está em uso", 409);
    }

    if (input.email) {
      const existingByEmail = await this.userDb.findByEmail(input.email);
      if (existingByEmail) {
        throwUser("E-mail já está em uso", 409);
      }
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    const created = await this.userDb.createUser({
      username: input.username,
      email: input.email ?? null,
      passwordHash,
      isActive: input.is_active ? true : false,
      isAdmin: input.is_admin ? true : false,
    });

    const row = await this.userDb.findById(created.id);
    if (!row) {
      throwInternal("Falha ao criar usuário");
    }

    return toPublicUser(row);
  }

  /**
   * Atualiza um usuário existente.
   * Valida unicidade de username e email.
   * Se password for enviado, faz o hash.
   */
  async updateUser(id: number, input: UpdateUserInput): Promise<PublicUser> {
    const existing = await this.userDb.findById(id);
    if (!existing) {
      throwUser("Usuário não encontrado", 404);
    }

    // Verifica unicidade do username (se estiver sendo alterado)
    if (input.username && input.username !== existing.username) {
      const byUsername = await this.userDb.findByUsername(input.username);
      if (byUsername) {
        throwUser("Username já está em uso", 409);
      }
    }

    // Verifica unicidade do email (se estiver sendo alterado)
    if (input.email && input.email !== existing.email) {
      const byEmail = await this.userDb.findByEmail(input.email);
      if (byEmail) {
        throwUser("E-mail já está em uso", 409);
      }
    }

    // Hash da senha se foi enviada
    let passwordHash: string | undefined;
    if (input.password) {
      passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    }

    await this.userDb.updateUser(id, {
      username: input.username,
      email: input.email,
      passwordHash,
      isActive: input.is_active,
      isAdmin: input.is_admin,
    });

    const updated = await this.userDb.findById(id);
    if (!updated) {
      throwInternal("Falha ao atualizar usuário");
    }

    return toPublicUser(updated);
  }

  /**
   * Desativa um usuário (soft delete).
   */
  async deleteUser(id: number): Promise<void> {
    const existing = await this.userDb.findById(id);
    if (!existing) {
      throwUser("Usuário não encontrado", 404);
    }

    if (!existing.is_active) {
      throwUser("Usuário já está desativado", 400);
    }

    await this.userDb.deactivateUser(id);
  }
}
