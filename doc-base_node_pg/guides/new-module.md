---
title: Criar Novo Módulo
tags:
  - guides
  - architecture
---

# Criar Novo Módulo

Passo a passo para adicionar um novo domínio à aplicação. Use [[modules/users|Módulo Usuários]] como referência.

---

## Estrutura a Criar

```
src/modules/<modulo>/
├── <modulo>.controller.ts
├── <modulo>.service.ts
├── <modulo>.database.ts
└── schema/
    └── <modulo>.schema.ts
```

---

## 1. Schema

`src/modules/<modulo>/schema/<modulo>.schema.ts`

```typescript
import { z } from "zod"

// Validação de entrada
export const create<Modulo>Schema = z.object({
  name: z.string().min(1).max(255),
})

export type Create<Modulo>Schema = z.infer<typeof create<Modulo>Schema>

// Shape de resposta (para Swagger e type safety)
export const <modulo>ResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string(),
})
```

> [!warning] Leia [[guides/schemas-zod|Schemas Zod]] antes de continuar.

---

## 2. Database

`src/modules/<modulo>/<modulo>.database.ts`

```typescript
import Database from "@/shared/infra/database/Database"

interface Row {
  id: number
  name: string
}

export class <Modulo>Database extends Database {
  async findAll() {
    const result = await this.query<Row>(
      `SELECT * FROM "<tabela>" WHERE is_active = TRUE`
    )
    return result.rows
  }

  async findById(id: number) {
    const result = await this.query<Row>(
      `SELECT * FROM "<tabela>" WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [id]
    )
    return result.rows[0] ?? null
  }

  async create(input: CreateInput) {
    // INSERT simples não é idempotente — desabilita retry
    const result = await this.query<{ id: number }>(
      `INSERT INTO "<tabela>" (name) VALUES ($1) RETURNING id`,
      [input.name],
      { noRetry: true }
    )
    return result.rows[0].id
  }
}
```

> [!tip] Transações
> Para operações que mutam múltiplas tabelas, envolva a chamada do service em `withTransaction` no controller:
>
> ```typescript
> import { withTransaction } from "@/db/transaction"
>
> await withTransaction(async () => {
>   await this.service.doMultipleWrites(input)
> })
> ```
>
> Não envie email/SMS, chame API externa ou publique em fila **dentro** da função — em caso de retry (`40001`/`40P01`), ela pode rodar mais de uma vez. Use o padrão **outbox**.

---

## 3. Service

`src/modules/<modulo>/<modulo>.service.ts`

```typescript
import { <Modulo>Database } from "./<modulo>.database.js"
import { throwUser } from "@/shared/utils/error.js"

export class <Modulo>Service {
  private db = new <Modulo>Database()

  async findAll() {
    return this.db.findAll()
  }

  async findById(id: number) {
    const item = await this.db.findById(id)
    if (!item) throwUser("<Modulo> não encontrado", 404)
    return item
  }

  async create(input: CreateInput) {
    const id = await this.db.create(input)
    return this.findById(id)
  }
}
```

---

## 4. Controller

`src/modules/<modulo>/<modulo>.controller.ts`

```typescript
import { Request, Response } from "express"
import { Controller } from "@/shared/core/Controller.js"
import { Get, Post, Route } from "@/shared/core/decorators.js"
import { ApiBody, ApiParam, ApiResponse, ApiTags } from "@/shared/core/decorators/index.js"
import { handleError, parseSchema } from "@/shared/utils/error.js"
import { create<Modulo>Schema, <modulo>ResponseSchema } from "./schema/<modulo>.schema.js"
import { <Modulo>Service } from "./<modulo>.service.js"

@Route("/<modulo>")
@ApiTags("<Modulo>")
export class <Modulo>Controller extends Controller {
  private service = new <Modulo>Service()

  @Get("/")
  @ApiResponse(200, "Lista de <modulo>")
  async findAll(req: Request, res: Response) {
    try {
      const data = await this.service.findAll()
      this.sendSuccessResponse(res, data)
    } catch (err) {
      handleError(err, res)
    }
  }

  @Get("/:id")
  @ApiParam("id", { type: "integer" })
  @ApiResponse(200, "<Modulo> encontrado", <modulo>ResponseSchema)
  @ApiResponse(404, "Não encontrado")
  async findById(req: Request, res: Response) {
    try {
      const data = await this.service.findById(Number(req.params.id))
      this.sendSuccessResponse(res, data)
    } catch (err) {
      handleError(err, res)
    }
  }

  @Post("/")
  @ApiBody(create<Modulo>Schema, "Dados do <modulo>")
  @ApiResponse(201, "<Modulo> criado", <modulo>ResponseSchema)
  async create(req: Request, res: Response) {
    try {
      const body = parseSchema(create<Modulo>Schema, req.body)
      const result = await this.service.create(body)
      this.sendSuccessResponse(res, result, 201)
    } catch (err) {
      handleError(err, res)
    }
  }
}
```

---

## 5. Registrar em `src/index.ts`

```typescript
registerControllers(app, [
  AuthController,
  UserController,
  <Modulo>Controller, // ← adicionar aqui
])
```

Swagger e rotas registram automaticamente.

---

## Checklist

- [ ] `schema/<modulo>.schema.ts` com schemas de entrada e resposta
- [ ] `<modulo>.database.ts` estende `Database`
- [ ] `<modulo>.service.ts` usa o database e lança `throwUser` quando necessário
- [ ] `<modulo>.controller.ts` usa `@Route`, `@ApiTags`, `parseSchema`, `handleError`
- [ ] Nenhum `z.object(...)` inline no controller
- [ ] Controller registrado em `src/index.ts`

---

## Relacionado

- [[core/decorators|Decorators]] — referência de todos os decorators disponíveis
- [[guides/schemas-zod|Schemas Zod]] — convenção de organização
- [[modules/users|Módulo Usuários]] — exemplo de referência completo
