import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config";

class JwtMiddleware {
  validJWTNeeded(req: Request, res: Response, next: NextFunction): void {
    // Bypass de desenvolvimento: só faz sentido com AUTHORIZATION=0 fora de produção.
    // Em produção o boot falha se AUTHORIZATION !== 1 (ver loaders/index.ts).
    if (!env.AUTHORIZATION) return next();

    const token = req.cookies?.['token_access'];

    if (!token) {
      res.status(401).json({
        message: 'Token de autenticação não fornecido',
      });
      return;
    }

    try {
      const jwtSecret = env.JWT_SECRET as string;
      // algorithms fixo evita confusão de algoritmo; issuer amarra o token a esta app
      const decoded = jwt.verify(token, jwtSecret, {
        algorithms: ["HS256"],
        issuer: env.APP_NAME,
      });
      res.locals.jwt = decoded;
      return next();
    } catch (err) {
      res.status(403).json({
        message: 'Token expirado ou inválido',
      });
      return;
    }
  }
}

export default new JwtMiddleware();
