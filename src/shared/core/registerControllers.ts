import { Application, Router } from "express";
import { getControllerPrefix, getRoutes } from "./decorators";

type ControllerClass = new (...args: any[]) => any;

/**
 * Registra todos os controllers decorados no app Express.
 *
 * @param app      Instância do Express
 * @param prefix   Prefixo global (ex: "/api")
 * @param controllers  Lista de classes controller decoradas com @Controller
 */
export function registerControllers(
  app: Application,
  prefix: string,
  controllers: ControllerClass[]
): void {
  for (const ControllerClass of controllers) {
    const instance = new ControllerClass();
    const controllerPrefix = getControllerPrefix(ControllerClass);
    const routes = getRoutes(ControllerClass);
    const router = Router();

    for (const route of routes) {
      const handler = (instance as any)[route.handlerName].bind(instance);
      const fullMiddlewares = [...route.middlewares, handler];

      router[route.method](route.path, ...fullMiddlewares);

      console.log(
        `  → ${route.method.toUpperCase()} ${prefix}${controllerPrefix}${route.path}`
      );
    }

    app.use(`${prefix}${controllerPrefix}`, router);
  }
}
