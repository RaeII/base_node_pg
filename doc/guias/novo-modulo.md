---
title: Criar Novo Módulo
tags:
  - guides
  - architecture
---

# Criar Novo Módulo

Passo a passo para adicionar um novo domínio. Use o [[usuarios|Módulo Usuários]] como referência viva.

---

## Estrutura a criar

```
src/modules/<modulo>/
├── <modulo>.controller.ts
├── <modulo>.service.ts
├── <modulo>.database.ts
└── schema/
    └── <modulo>.schema.ts
```

---

## 1. Schema — `schema/<modulo>.schema.ts`

```typescript
import { z } from "zod";

// Entrada (sempre .strict() e .max() em strings)
export const createItemSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
  })
  .strict();
export type CreateItemInput = z.infer<typeof createItemSchema>;

// Resposta (Swagger + type safety)
export const itemResponseSchema = z.object({
  data: z.object({
    id: z.number(),
    name: z.string(),
    created_at: z.date(),
  }),
});
```

> [!warning] Leia [[schemas-zod|Schemas Zod]] antes
> Nada de `z.object(...)` inline no controller.

---

## 2. Database — `<modulo>.database.ts`

```typescript
import Database from "@/shared/infra/database/Database";
import type { CreateItemInput } from "./schema/item.schema";

interface ItemRow { id: number; name: string }

export default class ItemDatabase extends Database {
  async findById(id: number) {
    const r = await this.query<ItemRow>(
      `SELECT * FROM "item" WHERE id = $1 LIMIT 1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async create(input: CreateItemInput) {
    // INSERT simples não é idempotente — desabilita retry
    const r = await this.query<{ id: number }>(
      `INSERT INTO "item" (name) VALUES ($1) RETURNING id`,
      [input.name],
      { noRetry: true },
    );
    return Number(r.rows[0].id);
  }
}
```

> [!tip] Transações ficam no controller
> Para mutações multi-tabela, envolva a chamada do service em `withTransaction(...)` (passo 4). Nunca dispare efeitos colaterais externos dentro da transação — ver [[camada-de-acesso#Transações — withTransaction]].

---

## 3. Service — `<modulo>.service.ts`

```typescript
import ItemDatabase from "./item.database";
import { throwUser } from "@/shared/utils/error";

export default class ItemService {
  private db = new ItemDatabase();

  async findById(id: number) {
    const item = await this.db.findById(id);
    if (!item) throwUser("Item não encontrado", 404);
    return item;
  }

  async create(input: CreateItemInput) {
    const id = await this.db.create(input);
    return this.findById(id);
  }
}
```

---

## 4. Controller — `<modulo>.controller.ts`

```typescript
import { Request, Response } from "express";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Get, Post, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiParam, ApiResponse, ApiSummary, ApiTags } from "@/shared/core/decorators/index";
import { handleError, parseSchema } from "@/shared/utils/error";
import { withTransaction } from "@/db/transaction";
import jwtMiddleware from "@/shared/middlewares/jwt.middleware";
import adminMiddleware from "@/shared/middlewares/admin.middleware";
import { createItemSchema, itemResponseSchema } from "./schema/item.schema";
import ItemService from "./item.service";

@Route("/item")
@ApiTags("Itens")
class ItemController extends Controller {
  private service = new ItemService();

  @Get("/:id")
  @ApiSummary("Buscar item", "Retorna um item pelo ID")
  @ApiParam("id", { type: "integer", description: "ID do item" })
  @ApiResponse(200, "Item encontrado", itemResponseSchema)
  @ApiResponse(404, "Não encontrado")
  async findById(req: Request, res: Response) {
    try {
      const data = await this.service.findById(Number(req.params.id));
      return res.status(200).json({ data });
    } catch (err) {
      return handleError(err, res);
    }
  }

  @Post("/")
  @Middleware(
    jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
    adminMiddleware.adminOnly.bind(adminMiddleware),
  )
  @ApiBody(createItemSchema, "Dados do item")
  @ApiResponse(201, "Item criado", itemResponseSchema)
  async create(req: Request, res: Response) {
    try {
      const body = parseSchema(createItemSchema, req.body);
      const data = await withTransaction(() => this.service.create(body));
      return res.status(201).json({ data });
    } catch (err) {
      return handleError(err, res);
    }
  }
}

export default ItemController;
```

> [!important] Status diferente de 200
> `this.sendSuccessResponse(res, data)` responde **sempre 200**. Para `201`/`204`, use `res.status(...).json(...)` como acima. Ver [[tratamento-de-erros#Classe base Controller]].

---

## 5. Registrar em `src/index.ts`

```typescript
import ItemController from "@/modules/item/item.controller";

const controllers = [
  AuthController,
  UserController,
  SystemController,
  ItemController,   // ← adicionar aqui
];
```

Rotas e Swagger são registrados automaticamente. Não esqueça da [[migrations|migration]] que cria a tabela `"item"`.

---

## Checklist

- [ ] `schema/<modulo>.schema.ts` com entrada (`.strict()`, `.max()`) e resposta
- [ ] `<modulo>.database.ts` estende `Database`, `{ noRetry }` em `INSERT` simples
- [ ] `<modulo>.service.ts` usa o database e lança `throwUser` quando preciso
- [ ] `<modulo>.controller.ts` usa `@Route`, `@ApiTags`, `parseSchema`, `handleError`
- [ ] Mutações envolvidas em `withTransaction`
- [ ] Nenhum `z.object(...)` inline no controller
- [ ] Controller registrado em `src/index.ts`
- [ ] Migration criada para a tabela

---

## Relacionado

- [[decorators|Decorators]] — referência completa
- [[schemas-zod|Schemas Zod]] — convenção de organização
- [[camada-de-acesso|Camada de Acesso a Dados]] — `Database`, `withTransaction`
- [[usuarios|Módulo Usuários]] — exemplo de referência
