import "reflect-metadata";
import { ZodSchema } from "zod";

// ─── Metadata Keys ──────────────────────────────────────────────
export const SWAGGER_BODY = Symbol("swagger:body");
export const SWAGGER_RESPONSE = Symbol("swagger:response");
export const SWAGGER_SUMMARY = Symbol("swagger:summary");
export const SWAGGER_TAGS = Symbol("swagger:tags");
export const SWAGGER_PARAMS = Symbol("swagger:params");
export const SWAGGER_QUERY = Symbol("swagger:query");

// ─── Types ──────────────────────────────────────────────────────
export interface SwaggerResponseDef {
  statusCode: number;
  description: string;
  schema?: ZodSchema;
}

export interface SwaggerParamDef {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  type: "string" | "number" | "integer" | "boolean";
}

// ─── @ApiBody(zodSchema) ────────────────────────────────────────
/**
 * Define o schema Zod do corpo da requisição para documentação Swagger.
 *
 * @param schema Schema Zod da validação do body
 * @param description Descrição do body (opcional)
 */
export function ApiBody(
  schema: ZodSchema,
  description?: string
): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(
      SWAGGER_BODY,
      { schema, description: description || "Corpo da requisição" },
      target.constructor,
      propertyKey
    );
  };
}

// ─── @ApiResponse(statusCode, description, schema?) ─────────────
/**
 * Define uma resposta documentada no Swagger.
 * Pode ser usado múltiplas vezes para documentar diferentes status codes.
 *
 * @param statusCode HTTP status code
 * @param description Descrição da resposta
 * @param schema Schema Zod da resposta (opcional)
 */
export function ApiResponse(
  statusCode: number,
  description: string,
  schema?: ZodSchema
): MethodDecorator {
  return (target, propertyKey) => {
    const existing: SwaggerResponseDef[] =
      Reflect.getMetadata(SWAGGER_RESPONSE, target.constructor, propertyKey) ||
      [];

    existing.push({ statusCode, description, schema });
    Reflect.defineMetadata(
      SWAGGER_RESPONSE,
      existing,
      target.constructor,
      propertyKey
    );
  };
}

// ─── @ApiSummary(summary, description?) ─────────────────────────
/**
 * Define o resumo e a descrição da rota no Swagger.
 *
 * @param summary Resumo curto da rota
 * @param description Descrição detalhada (opcional)
 */
export function ApiSummary(
  summary: string,
  description?: string
): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(
      SWAGGER_SUMMARY,
      { summary, description },
      target.constructor,
      propertyKey
    );
  };
}

// ─── @ApiTags(...tags) ──────────────────────────────────────────
/**
 * Define tags para agrupar a rota no Swagger.
 * Pode ser usado no controller (ClassDecorator) ou em um método (MethodDecorator).
 *
 * @param tags Tags para agrupar a rota
 */
export function ApiTags(
  ...tags: string[]
): ClassDecorator & MethodDecorator {
  return (target: any, propertyKey?: string | symbol) => {
    if (propertyKey) {
      // MethodDecorator
      Reflect.defineMetadata(
        SWAGGER_TAGS,
        tags,
        target.constructor,
        propertyKey
      );
    } else {
      // ClassDecorator
      Reflect.defineMetadata(SWAGGER_TAGS, tags, target);
    }
  };
}

// ─── @ApiParam(name, options?) ──────────────────────────────────
/**
 * Define um parâmetro de rota (path ou query) para documentação Swagger.
 *
 * @param name Nome do parâmetro
 * @param options Opções do parâmetro
 */
export function ApiParam(
  name: string,
  options?: {
    in?: "path" | "query";
    required?: boolean;
    description?: string;
    type?: "string" | "number" | "integer" | "boolean";
  }
): MethodDecorator {
  return (target, propertyKey) => {
    const existing: SwaggerParamDef[] =
      Reflect.getMetadata(SWAGGER_PARAMS, target.constructor, propertyKey) ||
      [];

    existing.push({
      name,
      in: options?.in || "path",
      required: options?.required !== false,
      description: options?.description,
      type: options?.type || "string",
    });

    Reflect.defineMetadata(
      SWAGGER_PARAMS,
      existing,
      target.constructor,
      propertyKey
    );
  };
}

// ─── Helpers de leitura de metadados Swagger ────────────────────
export function getSwaggerBody(
  target: Function,
  propertyKey: string | symbol
): { schema: ZodSchema; description: string } | undefined {
  return Reflect.getMetadata(SWAGGER_BODY, target, propertyKey);
}

export function getSwaggerResponses(
  target: Function,
  propertyKey: string | symbol
): SwaggerResponseDef[] {
  return (
    Reflect.getMetadata(SWAGGER_RESPONSE, target, propertyKey) || []
  );
}

export function getSwaggerSummary(
  target: Function,
  propertyKey: string | symbol
): { summary: string; description?: string } | undefined {
  return Reflect.getMetadata(SWAGGER_SUMMARY, target, propertyKey);
}

export function getSwaggerTags(
  target: Function,
  propertyKey?: string | symbol
): string[] {
  if (propertyKey) {
    return Reflect.getMetadata(SWAGGER_TAGS, target, propertyKey) || [];
  }
  return Reflect.getMetadata(SWAGGER_TAGS, target) || [];
}

export function getSwaggerParams(
  target: Function,
  propertyKey: string | symbol
): SwaggerParamDef[] {
  return (
    Reflect.getMetadata(SWAGGER_PARAMS, target, propertyKey) || []
  );
}
