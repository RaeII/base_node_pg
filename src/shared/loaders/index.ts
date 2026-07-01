import { Application } from "express";
import { env } from "@/config";
import logger from "@/shared/utils/logger";

import { loadPreRouteMiddlewares, loadPostRouteMiddlewares } from "./express";
import { waitForDatabase } from "@/db/health";

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Validações de segurança fail-closed: a app se recusa a subir mal configurada
 * em produção, em vez de subir aberta (auth desligada, secret fraco, etc.).
 */
function validateSecurityConfig() {
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET não está definido");

  if (env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    const msg = `JWT_SECRET muito curto (${env.JWT_SECRET.length} chars) — use no mínimo ${MIN_JWT_SECRET_LENGTH} (ex: openssl rand -base64 48)`;
    if (env.isProduction) throw new Error(msg);
    logger.warn(msg);
  }

  if (env.isProduction) {
    // Fail-closed: sem AUTHORIZATION=1 explícito, produção não sobe.
    // Evita deploy com auth desligada por variável ausente/typo no .env.
    if (env.AUTHORIZATION !== 1) {
      throw new Error(
        "Produção exige AUTHORIZATION=1 no .env — a app não sobe com autenticação desligada (fail-closed)"
      );
    }

    if (!env.DB_SSL) {
      logger.warn("Produção sem DB_SSL — recomendado SSL com verify-full no banco");
    }

    if (!env.CORS_ORIGINS) {
      logger.warn("CORS_ORIGINS não definido — nenhuma origem cross-site será permitida");
    }
  }
}

export async function initializePreRouteLoaders(app: Application) {
  console.log("Initializing loaders...");

  validateSecurityConfig();

  // Bootstrap: aguarda banco estar disponível antes de aceitar tráfego
  await waitForDatabase();

  loadPreRouteMiddlewares(app);
  console.log("Express pre-route middlewares loaded.");
}

export function initializePostRouteLoaders(app: Application) {
  loadPostRouteMiddlewares(app);
  console.log("Express post-route middlewares loaded.");
}

export default async (app: Application) => {
  await initializePreRouteLoaders(app);
  initializePostRouteLoaders(app);
};
