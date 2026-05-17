import { Request, Response, NextFunction } from "express";
import { env } from "@/config";

function isTruthyAdminFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "admin" || v === "yes";
  }
  return false;
}

class AdminMiddleware {
  adminOnly(req: Request, res: Response, next: NextFunction): void {
    // Mantém o comportamento do projeto: se AUTHORIZATION não está habilitado, não bloqueia.
    if (!env.AUTHORIZATION) return next();

    const jwtPayload = res.locals?.jwt;
    const isAdmin = isTruthyAdminFlag(jwtPayload?.admin);

    if (!isAdmin) {
      res.status(403).json({
        message: "Acesso negado: apenas administradores podem executar esta ação",
      });
      return;
    }

    return next();
  }
}

export default new AdminMiddleware();

