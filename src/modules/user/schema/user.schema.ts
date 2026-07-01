import { z } from "zod";
import { createPaginatedSchema } from "@/shared/utils/pagination";

// ─── Schemas de Validação (entrada) ─────────────────────────────

/**
 * Schema de validação da rota de criação de usuário.
 * Mantido separado do controller para manter o controller "magro".
 */
export const createUserSchema = z
  .object({
    // toLowerCase: unicidade case-insensitive (o banco compara case-sensitive)
    username: z
      .string({ error: "username é obrigatório" })
      .trim()
      .toLowerCase()
      .min(3, "username deve ter no mínimo 3 caracteres")
      .max(45, "username deve ter no máximo 45 caracteres"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(45, "email deve ter no máximo 45 caracteres")
      .email("email inválido")
      .optional(),
    // max 72: bcrypt trunca silenciosamente senhas acima de 72 bytes
    password: z
      .string({ error: "password é obrigatório" })
      .min(8, "password deve ter no mínimo 8 caracteres")
      .max(72, "password deve ter no máximo 72 caracteres"),
    is_active: z.boolean().optional().default(true),
    is_admin: z.boolean().optional().default(false),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const authenticateUserSchema = z.object({
  identifier: z.string(),
  password: z.string(),
});

export type AuthenticateUserInput = z.infer<typeof authenticateUserSchema>;

export const publicUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string().nullable(),
  is_active: z.boolean(),
  is_admin: z.boolean(),
  last_login_at: z.date().nullable(),
  created_at: z.date(),
  updated_at: z.date().nullable(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;


/**
 * Schema de validação de path param `:id`.
 * Uso: `const { id } = parseSchema(idParamsSchema, req.params)`.
 * Sem isso, `Number("abc") = NaN` chega ao driver PG e vira 500 + alerta.
 */
export const idParamsSchema = z.object({
  id: z.coerce.number().int("id deve ser um inteiro").positive("id deve ser positivo"),
});

// ─── Schemas de Banco de Dados ──────────────────────────────────

/**
 * Linha "segura" do usuário — SEM a coluna `password`.
 * As queries do repositório projetam colunas explícitas (nunca `SELECT *`),
 * para o hash de senha não circular pelas camadas sem necessidade.
 */
export const dbUserRowSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string().nullable(),
  is_active: z.boolean(),
  is_admin: z.boolean(),
  last_login_at: z.date().nullable(),
  created_at: z.date(),
  updated_at: z.date().nullable(),
});

export type DbUserRow = z.infer<typeof dbUserRowSchema>;

/** Linha com hash de senha — exclusiva do fluxo de autenticação. */
export type DbUserAuthRow = DbUserRow & { password: string };

export const createUserDbInputSchema = z.object({
  username: z.string(),
  email: z.string().nullable(),
  passwordHash: z.string(),
  isActive: z.boolean(),
  isAdmin: z.boolean(),
});

export type CreateUserDbInput = z.infer<typeof createUserDbInputSchema>;

// ─── Schema de Atualização ──────────────────────────────────────

/**
 * Schema de validação para atualização de usuário.
 * Todos os campos são opcionais — atualiza apenas o que for enviado.
 */
export const updateUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "username deve ter no mínimo 3 caracteres")
      .max(45, "username deve ter no máximo 45 caracteres")
      .optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(45, "email deve ter no máximo 45 caracteres")
      .email("email inválido")
      .optional(),
    password: z
      .string()
      .min(8, "password deve ter no mínimo 8 caracteres")
      .max(72, "password deve ter no máximo 72 caracteres")
      .optional(),
    is_active: z.boolean().optional(),
    is_admin: z.boolean().optional(),
  })
  .strict();

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export interface UpdateUserDbInput {
  username?: string;
  email?: string | null;
  passwordHash?: string;
  isActive?: boolean;
  isAdmin?: boolean;
}

// ─── Schemas de Resposta (documentação Swagger) ─────────────────

/** Schema de resposta com dados públicos do usuário */
export const userResponseSchema = z.object({
  data: publicUserSchema,
});

/** Schema de resposta de sucesso ao criar usuário (201) */
export const createUserResponseSchema = z.object({
  data: z.object({
    id: z.number(),
    username: z.string(),
    email: z.string().nullable(),
    is_active: z.boolean(),
    is_admin: z.boolean(),
  }),
});

/** Schema de resposta paginada com lista de usuários */
export const usersListResponseSchema = createPaginatedSchema(publicUserSchema);

/** Schema de resposta de erro de validação (400) */
export const validationErrorResponseSchema = z.object({
  message: z.string(),
  issues: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      })
    )
    .optional(),
});

/** Schema de resposta de mensagem simples */
export const messageResponseSchema = z.object({
  message: z.string(),
});
