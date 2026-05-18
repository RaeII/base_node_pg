---
name: new-module
description: Gera um novo módulo Express seguindo o padrão controller/service/database/schema do projeto. Cria os quatro arquivos (controller, service, database, schema) com os imports e decorators corretos.
disable-model-invocation: true
---

# Skill: new-module

Gera um novo módulo Express completo para o projeto base_node_pg.

## Como usar

```
/new-module <NomeDoModulo>
```

Exemplos:
- `/new-module Product`
- `/new-module Order`
- `/new-module Category`

## O que é criado

Dado `<NomeDoModulo>` = `Product`, cria os seguintes arquivos:

```
src/modules/product/
  product.controller.ts
  product.service.ts
  product.database.ts
  schema/
    product.schema.ts
```

---

## Instruções para o Claude

Quando o usuário invocar `/new-module <Nome>`, crie os quatro arquivos abaixo.

Convenções obrigatórias:
- Nome do módulo em PascalCase (ex: `Product`)
- Nome da tabela em snake_case lowercase (ex: `product`)
- Nome dos arquivos em kebab-case (ex: `product.controller.ts`)
- Importações com alias `@/` (nunca caminhos relativos entre módulos)
- Todos os campos sensíveis à paginação devem usar `getPagination()` + `COUNT(*) OVER ()`
- INSERT sem idempotência usa `{ noRetry: true }`
- Decorators Swagger obrigatórios em todas as rotas

---

### 1. `src/modules/<nome>/schema/<nome>.schema.ts`

```typescript
import { z } from "zod";
import { createPaginatedSchema } from "@/shared/utils/pagination";

// ─── Schemas de Entrada ──────────────────────────────────────────

export const create<Nome>Schema = z
  .object({
    name: z
      .string({ error: "name é obrigatório" })
      .trim()
      .min(1, "name deve ter no mínimo 1 caractere")
      .max(255, "name deve ter no máximo 255 caracteres"),
  })
  .strict();

export type Create<Nome>Input = z.infer<typeof create<Nome>Schema>;

export const update<Nome>Schema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export type Update<Nome>Input = z.infer<typeof update<Nome>Schema>;

// ─── Schemas de Banco ────────────────────────────────────────────

export const db<Nome>RowSchema = z.object({
  id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
  created_at: z.date(),
  updated_at: z.date().nullable(),
});

export type Db<Nome>Row = z.infer<typeof db<Nome>RowSchema>;

export const create<Nome>DbInputSchema = z.object({
  name: z.string(),
  isActive: z.boolean(),
});

export type Create<Nome>DbInput = z.infer<typeof create<Nome>DbInputSchema>;

export interface Update<Nome>DbInput {
  name?: string;
  isActive?: boolean;
}

// ─── Schemas de Resposta (Swagger) ──────────────────────────────

export const public<Nome>Schema = z.object({
  id: z.number(),
  name: z.string(),
  is_active: z.boolean(),
  created_at: z.date(),
  updated_at: z.date().nullable(),
});

export type Public<Nome> = z.infer<typeof public<Nome>Schema>;

export const <nome>ResponseSchema = z.object({ data: public<Nome>Schema });
export const create<Nome>ResponseSchema = z.object({ data: public<Nome>Schema });
export const <nome>sListResponseSchema = createPaginatedSchema(public<Nome>Schema);
export const messageResponseSchema = z.object({ message: z.string() });
export const validationErrorResponseSchema = z.object({
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
```

---

### 2. `src/modules/<nome>/<nome>.database.ts`

```typescript
import Database from "@/shared/infra/database/Database";
import { getPagination } from "@/shared/utils/pagination";
import type { Create<Nome>DbInput, Db<Nome>Row, Update<Nome>DbInput } from "./schema/<nome>.schema";

export default class <Nome>Database extends Database {

  async findAll(): Promise<{ rows: Db<Nome>Row[]; total: number }> {
    const { limit, offset } = getPagination();

    const result = await this.query<Db<Nome>Row & { _total: string }>(
      `SELECT t.*, COUNT(*) OVER () AS _total
         FROM "<nome>" t
        WHERE t.is_active = TRUE
        ORDER BY t.id ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const rawRows = result.rows;
    const total = Number(rawRows[0]?._total) || 0;
    const rows = rawRows.map(({ _total, ...row }) => row as Db<Nome>Row);
    return { rows, total };
  }

  async findById(id: number): Promise<Db<Nome>Row | null> {
    const result = await this.query<Db<Nome>Row>(
      `SELECT * FROM "<nome>" WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async create<Nome>(input: Create<Nome>DbInput): Promise<{ id: number }> {
    const result = await this.query<{ id: number }>(
      `INSERT INTO "<nome>" (name, is_active)
       VALUES ($1, $2)
       RETURNING id`,
      [input.name, input.isActive],
      { noRetry: true }
    );
    return { id: Number(result.rows[0].id) };
  }

  async update<Nome>(id: number, input: Update<Nome>DbInput): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (input.name !== undefined) { fields.push(`name = $${i++}`); values.push(input.name); }
    if (input.isActive !== undefined) { fields.push(`is_active = $${i++}`); values.push(input.isActive); }

    if (fields.length === 0) return;

    values.push(id);
    await this.query(`UPDATE "<nome>" SET ${fields.join(", ")} WHERE id = $${i}`, values);
  }

  async deactivate<Nome>(id: number): Promise<void> {
    await this.query(`UPDATE "<nome>" SET is_active = FALSE WHERE id = $1`, [id]);
  }
}
```

---

### 3. `src/modules/<nome>/<nome>.service.ts`

```typescript
import <Nome>Database from "@/modules/<nome>/<nome>.database";
import type { Create<Nome>Input, Db<Nome>Row, Public<Nome>, Update<Nome>Input } from "./schema/<nome>.schema";
import { throwUser, throwInternal } from "@/shared/utils/error";
import { paginatedResponse, type PaginatedResult } from "@/shared/utils/pagination";

function toPublic<Nome>(row: Db<Nome>Row): Public<Nome> {
  return {
    id: row.id,
    name: row.name,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default class <Nome>Service {
  private db: <Nome>Database;

  constructor() {
    this.db = new <Nome>Database();
  }

  async findAll(): Promise<PaginatedResult<Public<Nome>>> {
    const { rows, total } = await this.db.findAll();
    return paginatedResponse(rows.map(toPublic<Nome>), total);
  }

  async findById(id: number): Promise<Public<Nome>> {
    const row = await this.db.findById(id);
    if (!row) throwUser("<Nome> não encontrado", 404);
    return toPublic<Nome>(row);
  }

  async create(input: Create<Nome>Input): Promise<Public<Nome>> {
    const created = await this.db.create<Nome>({ name: input.name, isActive: true });
    const row = await this.db.findById(created.id);
    if (!row) throwInternal("Falha ao criar <nome>");
    return toPublic<Nome>(row);
  }

  async update(id: number, input: Update<Nome>Input): Promise<Public<Nome>> {
    const existing = await this.db.findById(id);
    if (!existing) throwUser("<Nome> não encontrado", 404);

    await this.db.update<Nome>(id, { name: input.name });

    const updated = await this.db.findById(id);
    if (!updated) throwInternal("Falha ao atualizar <nome>");
    return toPublic<Nome>(updated);
  }

  async delete(id: number): Promise<void> {
    const existing = await this.db.findById(id);
    if (!existing) throwUser("<Nome> não encontrado", 404);
    if (!existing.is_active) throwUser("<Nome> já está desativado", 400);
    await this.db.deactivate<Nome>(id);
  }
}
```

---

### 4. `src/modules/<nome>/<nome>.controller.ts`

```typescript
import { Request, Response } from "express";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Get, Post, Put, Delete, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags, ApiParam } from "@/shared/core/decorators/index";
import <Nome>Service from "@/modules/<nome>/<nome>.service";
import {
  create<Nome>Schema,
  update<Nome>Schema,
  <nome>ResponseSchema,
  create<Nome>ResponseSchema,
  <nome>sListResponseSchema,
  messageResponseSchema,
  validationErrorResponseSchema,
} from "@/modules/<nome>/schema/<nome>.schema";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware from "@/shared/middlewares/admin.middleware";
import { parseSchema, handleError } from "@/shared/utils/error";
import { paginationMiddleware } from "@/shared/utils/pagination";
import { withTransaction } from "@/db/transaction";

@Route("/<nome>")
@ApiTags("<Nome>s")
class <Nome>Controller extends Controller {
  private service: <Nome>Service;

  constructor() {
    super();
    this.service = new <Nome>Service();
  }

  @Get("/")
  @Middleware(
    paginationMiddleware(),
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Listar <nome>s", "Retorna <nome>s ativos com paginação. Query params: ?page=1&limit=20 (máx: 100).")
  @ApiResponse(200, "Lista paginada de <nome>s", <nome>sListResponseSchema)
  async findAll(req: Request, res: Response) {
    try {
      return res.status(200).json(await this.service.findAll());
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Get("/:id")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Buscar <nome> por ID", "Retorna os dados de um <nome> específico.")
  @ApiParam("id", { description: "ID do <nome>", type: "integer" })
  @ApiResponse(200, "Dados do <nome>", <nome>ResponseSchema)
  @ApiResponse(404, "<Nome> não encontrado", messageResponseSchema)
  async findById(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      return res.status(200).json({ data: await this.service.findById(id) });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Criar <nome>", "Cria um novo <nome> no sistema.")
  @ApiBody(create<Nome>Schema, "Dados do novo <nome>")
  @ApiResponse(201, "<Nome> criado com sucesso", create<Nome>ResponseSchema)
  @ApiResponse(400, "Dados inválidos", validationErrorResponseSchema)
  async create(req: Request, res: Response) {
    try {
      const data = parseSchema(create<Nome>Schema, req.body);
      const created = await withTransaction(async () => this.service.create(data));
      return res.status(201).json({ data: created });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Put("/:id")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Atualizar <nome>", "Atualiza os dados de um <nome> existente.")
  @ApiParam("id", { description: "ID do <nome>", type: "integer" })
  @ApiBody(update<Nome>Schema, "Dados para atualização")
  @ApiResponse(200, "<Nome> atualizado com sucesso", <nome>ResponseSchema)
  @ApiResponse(400, "Dados inválidos", validationErrorResponseSchema)
  @ApiResponse(404, "<Nome> não encontrado", messageResponseSchema)
  async update(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      const data = parseSchema(update<Nome>Schema, req.body);
      const updated = await withTransaction(async () => this.service.update(id, data));
      return res.status(200).json({ data: updated });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Delete("/:id")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware)
  )
  @ApiSummary("Deletar <nome>", "Desativa um <nome> (soft delete).")
  @ApiParam("id", { description: "ID do <nome>", type: "integer" })
  @ApiResponse(200, "<Nome> desativado com sucesso", messageResponseSchema)
  @ApiResponse(404, "<Nome> não encontrado", messageResponseSchema)
  async delete(req: Request, res: Response) {
    try {
      const id = Number(req.params.id);
      await withTransaction(async () => this.service.delete(id));
      return res.status(200).json({ message: "<Nome> desativado com sucesso" });
    } catch (err) {
      return handleError(err, res);
    }
  }
}

export default <Nome>Controller;
```

---

## Após criar os arquivos

Lembre o usuário de:
1. Registrar o controller em `src/shared/loaders/express.ts` (ou onde os controllers são carregados)
2. Criar a migration SQL correspondente em `migrations/`
3. Registrar o novo controller no loader de rotas do projeto
