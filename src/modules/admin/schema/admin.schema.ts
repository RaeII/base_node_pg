import { z } from "zod";
import { createPaginatedSchema } from "@/shared/utils/pagination";
import { publicUserSchema } from "@/modules/user/schema/user.schema";
import { healthResponseSchema } from "@/modules/system/schemas/system.schema";

// ─── Auditoria ──────────────────────────────────────────────────

/** Ações registradas na trilha de auditoria (`audit_log.action`). */
export type AuditAction =
  | "admin.login"
  | "user.create"
  | "user.update"
  | "user.deactivate"
  | "user.revoke_sessions"
  | "service_token.create";

export interface AuditInput {
  action: AuditAction;
  actorId: number | null;
  ip: string | null;
  targetUserId?: number | null;
  /** Contexto da ação — NUNCA senha, hash ou token. */
  detail?: Record<string, unknown>;
}

export const auditEntrySchema = z.object({
  id: z.number(),
  action: z.string(),
  actor_id: z.number().nullable(),
  actor_username: z.string().nullable(),
  target_user_id: z.number().nullable(),
  target_username: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  created_at: z.date(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

// ─── Painel ─────────────────────────────────────────────────────

const statsSchema = z.object({
  totalUsers: z.number(),
  activeUsers: z.number(),
  inactiveUsers: z.number(),
  admins: z.number(),
  newUsersLast7Days: z.number(),
  loginsLast24h: z.number(),
  activeSessions: z.number(),
  adminSessions: z.number(),
});

export type AdminStats = z.infer<typeof statsSchema>;

const databaseInfoSchema = z.object({
  version: z.string(),
  sizeBytes: z.number(),
  connections: z.number(),
});

export type DatabaseInfo = z.infer<typeof databaseInfoSchema>;

// ─── Schemas de Resposta (documentação Swagger) ─────────────────

export const adminMeResponseSchema = z.object({ data: publicUserSchema });

export const statsResponseSchema = z.object({ data: statsSchema });

export const systemResponseSchema = z.object({
  data: z.object({
    health: healthResponseSchema,
    runtime: z.object({
      environment: z.enum(["production", "development"]),
      node: z.string(),
      uptimeSeconds: z.number(),
      memory: z.object({
        rssBytes: z.number(),
        heapUsedBytes: z.number(),
        heapTotalBytes: z.number(),
      }),
    }),
    database: databaseInfoSchema.nullable(),
    // Só valores não sensíveis — nunca secrets, credenciais ou webhooks.
    security: z.object({
      authorization: z.boolean(),
      accessTokenTtlSeconds: z.number(),
      refreshTokenTtlSeconds: z.number(),
      serviceTokenTtlSeconds: z.number(),
      adminSessionIdleSeconds: z.number(),
      adminSessionMaxSeconds: z.number(),
      rateLimit: z.object({
        windowMs: z.number(),
        max: z.number(),
        loginWindowMs: z.number(),
        loginMax: z.number(),
      }),
      corsOrigins: z.array(z.string()),
      cookieSameSite: z.enum(["lax", "strict", "none"]),
      cookieSecure: z.boolean(),
      trustProxy: z.number(),
    }),
  }),
});

export const auditListResponseSchema = createPaginatedSchema(auditEntrySchema);
