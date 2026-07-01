import rateLimit from "express-rate-limit";
import { env } from "@/config";

/**
 * Rate limit global por IP — protege a API inteira contra abuso/DoS barato.
 * Aplicado em `loadPreRouteMiddlewares` (antes das rotas).
 *
 * IMPORTANTE: atrás de proxy reverso, configure TRUST_PROXY no .env,
 * senão todos os clientes compartilham o IP do proxy.
 */
export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas requisições — tente novamente em instantes" },
});

/**
 * Rate limit do login — mitiga brute-force de credenciais.
 * `skipSuccessfulRequests: true` → só tentativas FALHAS contam para o limite;
 * logins válidos não bloqueiam o usuário.
 *
 * Uso: `@Middleware(loginRateLimiter)` na rota de login.
 */
export const loginRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: env.RATE_LIMIT_LOGIN_MAX,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas tentativas de login — aguarde antes de tentar novamente" },
});
