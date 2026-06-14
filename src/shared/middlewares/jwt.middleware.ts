import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config";

class JwtMiddleware {
  validJWTNeeded(req: Request, res: Response, next: NextFunction): void {
    // Bypass de desenvolvimento: só faz sentido com AUTHORIZATION=0 fora de produção.
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
      const decoded = jwt.verify(token, jwtSecret);
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