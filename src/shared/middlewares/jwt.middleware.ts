import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "@/config";

class JwtMiddleware {
  validJWTNeeded(req: Request, res: Response, next: NextFunction): void {
    if(env.AUTHORIZATION) {
      const token = req.cookies?.['token_access'];
      if (!token) {
        try {

          const jwtSecret = env.JWT_SECRET as string; 
          const decoded = jwt.verify(token, jwtSecret);
          res.locals.jwt = decoded;
          return next();

        } catch (err) {
          res.status(403).send({
            message: 'Token expirado ou inválido'
          });
        }
      } else {
        res.status(401).send({
          message: 'Token de autenticação não fornecido'
        });
      }
    }

    return next();
  }
}

export default new JwtMiddleware(); 