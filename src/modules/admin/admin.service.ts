import { env } from "@/config";
import AdminDatabase from "@/modules/admin/admin.database";
import type { AuditEntry, AuditInput } from "@/modules/admin/schema/admin.schema";
import { healthCheck } from "@/db/health";
import { resolveCorsOrigins } from "@/shared/loaders/express";
import { paginatedResponse, type PaginatedResult } from "@/shared/utils/pagination";

export default class AdminService {
  private adminDb: AdminDatabase;

  constructor() {
    this.adminDb = new AdminDatabase();
  }

  /**
   * Grava na trilha de auditoria. Chame dentro do `withTransaction` da ação
   * auditada: ação e registro commitam (ou somem) juntos.
   */
  async audit(entry: AuditInput): Promise<void> {
    await this.adminDb.insertAudit(entry);
  }

  async listAudit(): Promise<PaginatedResult<AuditEntry>> {
    const { rows, total } = await this.adminDb.findAudit();
    return paginatedResponse(rows, total);
  }

  async getStats() {
    return this.adminDb.getStats();
  }

  /** Saúde, runtime, banco e configuração de segurança — sem nenhum segredo. */
  async getSystemInfo() {
    const health = await healthCheck();
    // Banco fora do ar: o resto do painel continua respondendo.
    const database = health.status === "down" ? null : await this.adminDb.getDatabaseInfo();
    const memory = process.memoryUsage();

    return {
      health,
      runtime: {
        environment: env.isProduction ? "production" : "development",
        node: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
        },
      },
      database,
      security: {
        authorization: env.AUTHORIZATION === 1,
        accessTokenTtlSeconds: env.JWT_EXPIRES_IN_SECONDS,
        refreshTokenTtlSeconds: env.REFRESH_TOKEN_EXPIRES_IN_SECONDS,
        serviceTokenTtlSeconds: env.SERVICE_JWT_EXPIRES_IN_SECONDS,
        adminSessionIdleSeconds: env.ADMIN_SESSION_IDLE_SECONDS,
        adminSessionMaxSeconds: env.ADMIN_SESSION_MAX_SECONDS,
        rateLimit: {
          windowMs: env.RATE_LIMIT_WINDOW_MS,
          max: env.RATE_LIMIT_MAX,
          loginWindowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
          loginMax: env.RATE_LIMIT_LOGIN_MAX,
        },
        corsOrigins: resolveCorsOrigins() || [],
        cookieSameSite: env.COOKIE_SAMESITE,
        cookieSecure: env.isProduction,
        trustProxy: env.TRUST_PROXY,
      },
    };
  }
}
