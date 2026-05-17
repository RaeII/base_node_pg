import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

// ─── Constantes ──────────────────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ─── Tipos ───────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ─── AsyncLocalStorage ───────────────────────────────────────────

const paginationStore = new AsyncLocalStorage<PaginationParams>();

// ─── Middleware ───────────────────────────────────────────────────

/**
 * Middleware Express que extrai `page` e `limit` dos query params,
 * aplica validações (mínimo, máximo) e armazena no AsyncLocalStorage
 * para acesso transparente em qualquer camada (service, database).
 *
 * Query params aceitos:
 * - `page`  → número da página (mín: 1, padrão: 1)
 * - `limit` → itens por página (mín: 1, máx: 100, padrão: 20)
 *
 * Uso com decorator: `@Middleware(paginationMiddleware())`
 */
export function paginationMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const page = Math.max(1, Math.floor(Number(req.query.page)) || DEFAULT_PAGE);
    const rawLimit = Math.floor(Number(req.query.limit)) || DEFAULT_LIMIT;
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
    const offset = (page - 1) * limit;

    paginationStore.run({ page, limit, offset }, next);
  };
}

// ─── Getter ──────────────────────────────────────────────────────

/**
 * Retorna os parâmetros de paginação do contexto atual.
 * Pode ser chamado em qualquer camada (service, database) sem
 * receber parâmetros — o AsyncLocalStorage resolve automaticamente.
 *
 * Se chamado fora do contexto do middleware, retorna valores padrão.
 */
export function getPagination(): PaginationParams {
  const params = paginationStore.getStore();
  if (!params) {
    return { page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, offset: 0 };
  }
  return params;
}

// ─── Resposta Paginada ───────────────────────────────────────────

/**
 * Monta o objeto de resposta paginada com metadados de navegação.
 * Chamado no service após obter os dados e o total de registros.
 *
 * @param data  - Array de itens da página atual
 * @param total - Total de registros no banco (sem paginação)
 */
export function paginatedResponse<T>(data: T[], total: number): PaginatedResult<T> {
  const { page, limit } = getPagination();
  const totalPages = Math.ceil(total / limit) || 0;

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

// ─── Schema Zod (Swagger) ────────────────────────────────────────

const paginationMetaSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

/**
 * Cria um schema Zod de resposta paginada para documentação Swagger.
 * Reutilizável com qualquer schema de item.
 *
 * @example
 * const usersPaginatedSchema = createPaginatedSchema(publicUserSchema);
 */
export function createPaginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: paginationMetaSchema,
  });
}
