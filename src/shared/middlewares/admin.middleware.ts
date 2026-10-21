import { Request, Response, NextFunction } from "express";
import { env } from "@/config";
import AuthService from "@/modules/auth/auth.service";
import { handleError } from "@/shared/utils/error";

class AdminMiddleware {
  private authService = new AuthService();

  /**
   * Exige sessão admin elevada — aberta por `POST /auth/admin/login` — validada
   * NO BANCO a cada request, sem confiar em claim do JWT: sessão viva, elevação
   * dentro do prazo e usuário ainda ativo e admin. Cada uso desliza o prazo de
   * inatividade (ADMIN_SESSION_IDLE_SECONDS), limitado a ADMIN_SESSION_MAX_SECONDS.
   *
   * Deve vir DEPOIS do jwtMiddleware (lê `res.locals.jwt.sid`).
   * Em sucesso, `res.locals.adminId` = id do admin (ator da auditoria).
   */
  async adminOnly(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jwt = res.locals?.jwt;
      // Token de serviço e access sem `sid` nunca elevam.
      const adminId =
        jwt?.type === "user" && typeof jwt.sid === "string"
          ? await this.authService.touchAdminSession(jwt.sid)
          : null;
      if (adminId !== null) res.locals.adminId = adminId;

      // Mantém o comportamento do projeto: se AUTHORIZATION não está habilitado, não bloqueia.
      // Em produção o boot falha se AUTHORIZATION !== 1 (ver loaders/index.ts).
      if (!env.AUTHORIZATION) return next();

      if (adminId === null) {
        // 403, não 401: o usuário pode estar autenticado — falta a sessão admin.
        res.status(403).json({ message: "Acesso restrito: entre pela área administrativa" });
        return;
      }

      return next();
    } catch (err) {
      handleError(err, res);
    }
  }
}

/** Ator da auditoria: admin validado pelo `adminOnly` + IP de origem. */
export function auditActor(req: Request, res: Response): { actorId: number | null; ip: string | null } {
  return { actorId: res.locals.adminId ?? null, ip: req.ip ?? null };
}

export default new AdminMiddleware();
