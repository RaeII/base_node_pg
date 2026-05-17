import "reflect-metadata";
import { RequestHandler } from "express";

// ─── Metadata Keys ──────────────────────────────────────────────
const CONTROLLER_PREFIX = Symbol("controller:prefix");
const ROUTES = Symbol("routes");

// ─── Types ──────────────────────────────────────────────────────
export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handlerName: string;
  middlewares: RequestHandler[];
}

// ─── @Controller(prefix) ────────────────────────────────────────
export function Controller(prefix: string): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONTROLLER_PREFIX, prefix, target);
    if (!Reflect.hasMetadata(ROUTES, target)) {
      Reflect.defineMetadata(ROUTES, [], target);
    }
  };
}

// ─── Helper: cria method decorators ─────────────────────────────
function createMethodDecorator(method: HttpMethod) {
  return (path: string = "/"): MethodDecorator => {
    return (target, propertyKey) => {
      const constructor = target.constructor;
      const routes: RouteDefinition[] =
        Reflect.getMetadata(ROUTES, constructor) || [];

      // Verifica se a rota já existe (pode ter sido criada pelo @Middleware)
      const existingRoute = routes.find(
        (r) => r.handlerName === String(propertyKey)
      );

      if (existingRoute) {
        existingRoute.method = method;
        existingRoute.path = path;
      } else {
        routes.push({
          method,
          path,
          handlerName: String(propertyKey),
          middlewares: [],
        });
      }

      Reflect.defineMetadata(ROUTES, routes, constructor);
    };
  };
}

// ─── HTTP Method Decorators ─────────────────────────────────────
export const Get = createMethodDecorator("get");
export const Post = createMethodDecorator("post");
export const Put = createMethodDecorator("put");
export const Delete = createMethodDecorator("delete");
export const Patch = createMethodDecorator("patch");

// ─── @Middleware(...handlers) ───────────────────────────────────
export function Middleware(...middlewares: RequestHandler[]): MethodDecorator {
  return (target, propertyKey) => {
    const constructor = target.constructor;
    const routes: RouteDefinition[] =
      Reflect.getMetadata(ROUTES, constructor) || [];

    const existingRoute = routes.find(
      (r) => r.handlerName === String(propertyKey)
    );

    if (existingRoute) {
      existingRoute.middlewares = middlewares;
    } else {
      routes.push({
        method: "get", // será sobrescrito pelo decorator de método HTTP
        path: "/",
        handlerName: String(propertyKey),
        middlewares,
      });
    }

    Reflect.defineMetadata(ROUTES, routes, constructor);
  };
}

// ─── Helpers de leitura de metadados ────────────────────────────
export function getControllerPrefix(target: Function): string {
  return Reflect.getMetadata(CONTROLLER_PREFIX, target) || "/";
}

export function getRoutes(target: Function): RouteDefinition[] {
  return Reflect.getMetadata(ROUTES, target) || [];
}
