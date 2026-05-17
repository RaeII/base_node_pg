import { Application } from "express";
import { env } from "@/config";

import { loadPreRouteMiddlewares, loadPostRouteMiddlewares } from "./express";
import MysqlService from "@/shared/infra/database/MySQLService";

export async function initializePreRouteLoaders(app: Application) {
  console.log("Initializing loaders...");

  if(!env.JWT_SECRET) throw new Error("JWT_SECRET não está definido");

  MysqlService.initialize();
  loadPreRouteMiddlewares(app);
  console.log("Express pre-route middlewares loaded.");
}

export function initializePostRouteLoaders(app: Application) {
  loadPostRouteMiddlewares(app);
  console.log("Express post-route middlewares loaded.");
}

// Mantém export default para retrocompatibilidade
export default async (app: Application) => {
  await initializePreRouteLoaders(app);
  initializePostRouteLoaders(app);
};
