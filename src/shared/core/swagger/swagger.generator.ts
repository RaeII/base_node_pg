import { toJSONSchema } from "zod";
import {
  getControllerPrefix,
  getRoutes,
  RouteDefinition,
} from "../decorators";
import {
  getSwaggerBody,
  getSwaggerResponses,
  getSwaggerSummary,
  getSwaggerTags,
  getSwaggerParams,
  SwaggerResponseDef,
  SwaggerParamDef,
} from "../decorators/swagger.decorators";

type ControllerClass = new (...args: any[]) => any;

export interface SwaggerConfig {
  title: string;
  description?: string;
  version: string;
  basePath?: string;
  servers?: Array<{ url: string; description?: string }>;
}

/**
 * Converte um ZodSchema para JSON Schema compatível com OpenAPI 3.0.
 * Usa toJSONSchema nativo do Zod v4.
 */
function zodToOpenApiSchema(schema: any): Record<string, any> {
  try {
    const jsonSchema = toJSONSchema(schema, {
      target: "openapi-3.0",
      unrepresentable: "any",
      override: ({ zodSchema, jsonSchema }) => {
        // z.date() não é representável diretamente em JSON Schema; no OpenAPI ele deve ser string/date-time.
        const zodType = (zodSchema as any)?._zod?.def?.type;
        if (zodType === "date") {
          (jsonSchema as Record<string, any>).type = "string";
          (jsonSchema as Record<string, any>).format = "date-time";
        }
      },
    }) as Record<string, any>;

    // Remove propriedades que não são compatíveis com OpenAPI 3.0 inline
    delete jsonSchema["$schema"];

    return jsonSchema;
  } catch {
    // Fallback para schemas complexos que não suportam toJSONSchema
    return { type: "object" };
  }
}

/**
 * Extrai parâmetros de path da string de rota (ex: "/:id" -> [{name: "id", in: "path", ...}])
 */
function extractPathParams(path: string): SwaggerParamDef[] {
  const params: SwaggerParamDef[] = [];
  const regex = /:(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path)) !== null) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      type: "string",
    });
  }

  return params;
}

/**
 * Converte path do Express (/:id) para formato OpenAPI (/{id})
 */
function expressPathToOpenApi(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}");
}

/**
 * Gera o OpenAPI spec a partir de uma rota
 */
function buildPathOperation(
  controllerClass: ControllerClass,
  route: RouteDefinition,
  controllerTags: string[]
): Record<string, any> {
  const operation: Record<string, any> = {};

  // Summary e Description
  const summaryMeta = getSwaggerSummary(controllerClass, route.handlerName);
  if (summaryMeta) {
    operation.summary = summaryMeta.summary;
    if (summaryMeta.description) {
      operation.description = summaryMeta.description;
    }
  } else {
    operation.summary = route.handlerName;
  }

  // Tags: prioriza tags do método, senão usa as do controller
  const methodTags = getSwaggerTags(controllerClass, route.handlerName);
  operation.tags = methodTags.length > 0 ? methodTags : controllerTags;

  // OperationId
  operation.operationId = route.handlerName;

  // Parameters (path params + decorator @ApiParam)
  const pathParams = extractPathParams(route.path);
  const decoratorParams = getSwaggerParams(controllerClass, route.handlerName);

  // Merge: decorator params sobrescrevem path params auto-detectados
  const allParams = [...pathParams];
  for (const dp of decoratorParams) {
    const existingIdx = allParams.findIndex(
      (p) => p.name === dp.name && p.in === dp.in
    );
    if (existingIdx >= 0) {
      allParams[existingIdx] = dp;
    } else {
      allParams.push(dp);
    }
  }

  if (allParams.length > 0) {
    operation.parameters = allParams.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      description: p.description || "",
      schema: { type: p.type },
    }));
  }

  // Request Body
  const bodyMeta = getSwaggerBody(controllerClass, route.handlerName);
  if (bodyMeta) {
    const schema = zodToOpenApiSchema(bodyMeta.schema);
    operation.requestBody = {
      description: bodyMeta.description,
      required: true,
      content: {
        "application/json": {
          schema,
        },
      },
    };
  }

  // Responses
  const responseMetas = getSwaggerResponses(
    controllerClass,
    route.handlerName
  );

  if (responseMetas.length > 0) {
    operation.responses = {};
    for (const resp of responseMetas) {
      const respObj: Record<string, any> = {
        description: resp.description,
      };
      if (resp.schema) {
        respObj.content = {
          "application/json": {
            schema: zodToOpenApiSchema(resp.schema),
          },
        };
      }
      operation.responses[String(resp.statusCode)] = respObj;
    }
  } else {
    // Resposta padrão se nenhuma foi definida
    operation.responses = {
      "200": { description: "Sucesso" },
      "400": { description: "Requisição inválida" },
    };
  }

  return operation;
}

/**
 * Gera a especificação OpenAPI 3.0 completa a partir dos controllers decorados.
 *
 * @param prefix   Prefixo global das rotas (ex: "/api")
 * @param controllers   Array de classes controller
 * @param config   Configuração do Swagger
 */
export function generateSwaggerSpec(
  prefix: string,
  controllers: ControllerClass[],
  config: SwaggerConfig
): Record<string, any> {
  const paths: Record<string, Record<string, any>> = {};
  const allTags: Set<string> = new Set();

  for (const ControllerCls of controllers) {
    const controllerPrefix = getControllerPrefix(ControllerCls);
    const routes = getRoutes(ControllerCls);

    // Tags do controller (se definidas via @ApiTags no class)
    let controllerTags = getSwaggerTags(ControllerCls);
    if (controllerTags.length === 0) {
      // Gera tag automática baseada no prefixo do controller
      const autoTag = controllerPrefix.replace(/^\//, "").replace(/\//g, "-");
      controllerTags = [autoTag.charAt(0).toUpperCase() + autoTag.slice(1)];
    }

    controllerTags.forEach((t) => allTags.add(t));

    for (const route of routes) {
      const fullPath = `${prefix}${controllerPrefix}${expressPathToOpenApi(route.path)}`;
      const operation = buildPathOperation(
        ControllerCls,
        route,
        controllerTags
      );

      if (!paths[fullPath]) {
        paths[fullPath] = {};
      }

      paths[fullPath][route.method] = operation;
    }
  }

  const spec: Record<string, any> = {
    openapi: "3.0.3",
    info: {
      title: config.title,
      description: config.description || "",
      version: config.version,
    },
    servers: config.servers || [
      {
        url: config.basePath || "/",
        description: "Servidor local",
      },
    ],
    tags: Array.from(allTags).map((tag) => ({ name: tag })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  };

  return spec;
}
