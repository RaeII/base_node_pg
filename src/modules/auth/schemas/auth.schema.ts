import { z } from "zod";
import { createUserSchema, publicUserSchema } from "@/modules/user/schema/user.schema";

const optionalTrimmedString = () =>
  z
    .string()
    .trim()
    .optional()
    .or(z.literal("").transform(() => undefined));

/**
 * Schema de validação da rota de login.
 * Aceita exatamente UM identificador: login (genérico), email OU username.
 */
export const loginSchema = z
  .object({
    login: optionalTrimmedString().pipe(
      z
        .string()
        .min(3, "login deve ter no mínimo 3 caracteres")
        .max(255, "login deve ter no máximo 255 caracteres")
        .optional()
    ),
    email: optionalTrimmedString().pipe(
      z
        .email("email inválido")
        .max(45, "email deve ter no máximo 45 caracteres")
        .optional()
    ),
    username: optionalTrimmedString().pipe(
      z
        .string()
        .min(3, "username deve ter no mínimo 3 caracteres")
        .max(45, "username deve ter no máximo 45 caracteres")
        .optional()
    ),
    password: z
      .string({ error: "password é obrigatório" })
      .min(6, "password deve ter no mínimo 6 caracteres")
      .max(255, "password deve ter no máximo 255 caracteres"),
  })
  .strict()
  .superRefine((val, ctx) => {
    const provided = [val.login, val.email, val.username].filter(
      (v) => typeof v === "string" && v.length > 0
    );

    if (provided.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["login"],
        message: "Informe exatamente um identificador: login, email ou username",
      });
    }
  });

export type LoginSchema = z.infer<typeof loginSchema>;

// ─── Schemas de Body ────────────────────────────────────────────

/** Schema de body para cadastro público de usuário comum */
export const signupSchema = createUserSchema
  .pick({
    username: true,
    email: true,
    password: true,
  })
  .strict();

export type SignupSchema = z.infer<typeof signupSchema>;

/** Schema de body para geração de token JWT de serviço */
export const createJwtBodySchema = z
  .object({
    name: z
      .string({ error: "name é obrigatório" })
      .trim()
      .min(3, "name deve ter no mínimo 3 caracteres")
      .max(100, "name deve ter no máximo 100 caracteres"),
  })
  .strict();

export type CreateJwtBody = z.infer<typeof createJwtBodySchema>;

// ─── Schemas de Resposta (documentação Swagger) ─────────────────

/** Schema de resposta de sucesso ao gerar JWT (200) */
export const createJwtResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
});

/** Schema de resposta de erro genérico (400) */
export const errorResponseSchema = z.object({
  message: z.string(),
});

/** Schema de resposta de sucesso ao fazer login (200) */
export const loginResponseSchema = z.object({
  data: publicUserSchema,
  expiresIn: z.number(),
});

/** Schema de resposta de sucesso ao cadastrar usuário */
export const signupResponseSchema = loginResponseSchema;

/** Schema de resposta do logout (200) */
export const logoutResponseSchema = z.object({
  message: z.string(),
});

/** Schema de resposta de erro de validação no login (400) */
export const loginErrorResponseSchema = z.object({
  message: z.string(),
  issues: z.array(z.object({
    path: z.string(),
    message: z.string(),
  })).optional(),
});
