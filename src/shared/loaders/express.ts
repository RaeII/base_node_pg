import {
  json,
  Application,
  Request,
  Response,
  NextFunction,
  ErrorRequestHandler,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "@/config";
import { globalRateLimiter } from "@/shared/middlewares/rateLimit.middleware";
import logger from "@/shared/utils/logger";

/**
 * Resolve as origens permitidas no CORS a partir de CORS_ORIGINS (separadas por vírgula).
 * - Produção sem CORS_ORIGINS → `false` (nenhuma origem cross-site — fail-closed).
 * - Dev sem CORS_ORIGINS → localhost:3000 por conveniência.
 */
function resolveCorsOrigins(): string[] | false {
  const fromEnv = (env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;
  return env.isProduction ? false : ["http://localhost:3000"];
}

/**
 * Registra os middlewares que devem ser executados ANTES das rotas.
 * (security headers, json parser, cookie parser, cors, rate limit, etc.)
 */
export function loadPreRouteMiddlewares(app: Application) {
  // Atrás de proxy reverso (nginx/traefik), TRUST_PROXY>0 faz req.ip refletir o
  // cliente real (X-Forwarded-For) — necessário para o rate limit por IP.
  if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  // Security headers (HSTS, nosniff, frame-options, etc.)
  app.use(helmet());

  // 1mb cobre qualquer payload JSON legítimo desta API; limites altos são vetor de DoS
  app.use(json({ limit: "1mb" }));

  // Necessário para ler o cookie httpOnly `token_access` no jwtMiddleware.
  app.use(cookieParser());

  const options: cors.CorsOptions = {
    credentials: true,
    methods: "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE",
    origin: resolveCorsOrigins(),
    preflightContinue: false,
    optionsSuccessStatus: 200,
  };

  app.use(cors(options));

  app.use(globalRateLimiter);
}

/**
 * Registra os handlers de erro que devem ser executados DEPOIS das rotas.
 * (404, error handlers, etc.)
 */
export function loadPostRouteMiddlewares(app: Application) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const err: any = new Error("Not Found");
    err["status"] = 404;
    next(err);
  });

  // Handler final de erro. Precisa ter EXATAMENTE 4 parâmetros — o Express
  // identifica error handlers pela aridade da função.
  const finalErrorHandler: ErrorRequestHandler = (err: any, req, res, _next) => {
    const status = err?.status || err?.statusCode || 500;

    if (status >= 500) {
      logger.error("Unhandled error", {
        path: req.path,
        method: req.method,
        message: err?.message,
        ...(!env.isProduction && { stack: err?.stack }),
      });
    }

    // 5xx em produção nunca expõe a mensagem interna do erro
    const message =
      status >= 500 && env.isProduction
        ? "Ocorreu um erro interno"
        : err?.message || "Ocorreu um erro interno";

    res.status(status).json({ message });
  };

  app.use(finalErrorHandler);
}

// Mantém export default para retrocompatibilidade (registra tudo de uma vez)
export default (app: Application) => {
  loadPreRouteMiddlewares(app);
  loadPostRouteMiddlewares(app);
};
