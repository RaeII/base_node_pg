import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config";

class JwtMiddleware {
  validJWTNeeded(req: Request, res: Response, next: NextFunction): void {
    const token = req.cookies?.['token_access'];
    const payload = token ? this.verify(token) : null;
    if (payload) res.locals.jwt = payload;

    // Bypass de desenvolvimento: só faz sentido com AUTHORIZATION=0 fora de produção.
    // Em produção o boot falha se AUTHORIZATION !== 1 (ver loaders/index.ts).
    // Não bloqueia, mas o payload acima segue disponível (ex.: /auth/me).
    if (!env.AUTHORIZATION) return next();

    if (!payload) {
      // 401 (não autenticado), não 403: é o sinal que o front usa para renovar a
      // sessão (refresh) ou voltar ao login. 403 fica para "autenticado sem permissão".
      res.status(401).json({
        message: token ? 'Token expirado ou inválido' : 'Token de autenticação não fornecido',
      });
      return;
    }

    return next();
  }

  private verify(token: string): jwt.JwtPayload | null {
    try {
      // algorithms fixo evita confusão de algoritmo; issuer amarra o token a esta app
      return jwt.verify(token, env.JWT_SECRET as string, {
        algorithms: ["HS256"],
        issuer: env.APP_NAME,
      }) as jwt.JwtPayload;
    } catch {
      return null;
    }
  }
}

export default new JwtMiddleware();
