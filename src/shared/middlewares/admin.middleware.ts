import { Request, Response, NextFunction } from "express";
import { env } from "@/config";

class AdminMiddleware {
  adminOnly(req: Request, res: Response, next: NextFunction): void {
    // Mantém o comportamento do projeto: se AUTHORIZATION não está habilitado, não bloqueia.
    // Em produção o boot falha se AUTHORIZATION !== 1 (ver loaders/index.ts).
    if (!env.AUTHORIZATION) return next();

    const jwtPayload = res.locals?.jwt;

    // Comparação estrita: o claim é assinado pela própria app como boolean no login.
    // Tokens de serviço (type: "service") não carregam `admin` e são negados aqui.
    if (jwtPayload?.admin !== true) {
      res.status(403).json({
        message: "Acesso negado: apenas administradores podem executar esta ação",
      });
      return;
    }

    return next();
  }
}

export default new AdminMiddleware();
