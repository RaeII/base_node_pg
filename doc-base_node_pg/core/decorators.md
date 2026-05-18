---
title: Sistema de Decorators
tags:
  - architecture
  - decorators
  - swagger
---

# Sistema de Decorators

O projeto usa decorators TypeScript com `reflect-metadata` para eliminar arquivos de rota separados e gerar documentação Swagger automaticamente.

---

## Decorators de Rota

Definidos em `src/shared/core/decorators.ts`.

| Decorator | Alvo | Descrição |
| --- | --- | --- |
| `@Controller(prefix)` | Classe | Define prefixo de todas as rotas |
| `@Get(path)` | Método | Registra rota GET |
| `@Post(path)` | Método | Registra rota POST |
| `@Put(path)` | Método | Registra rota PUT |
| `@Patch(path)` | Método | Registra rota PATCH |
| `@Delete(path)` | Método | Registra rota DELETE |
| `@Middleware(...handlers)` | Método | Aplica middlewares à rota (na ordem) |

### Exemplo

```typescript
@Controller("/user")
class UserController extends Controller {

  @Get("/")
  @Middleware(paginationMiddleware(), jwtMiddleware, adminMiddleware)
  async findAll(req: Request, res: Response) { ... }

  @Post("/")
  async create(req: Request, res: Response) { ... }
}
```

---

## Decorators Swagger

Definidos em `src/shared/core/decorators/swagger.decorators.ts`.

| Decorator | Descrição |
| --- | --- |
| `@ApiTags(...tags)` | Agrupa rotas na UI do Swagger |
| `@ApiSummary(title, desc?)` | Título e descrição da operação |
| `@ApiBody(zodSchema, desc)` | Documenta o body da request |
| `@ApiResponse(status, desc, schema?)` | Documenta uma resposta possível |
| `@ApiParam(name, options)` | Documenta parâmetro de path ou query |

> [!important] Schema sempre em arquivo separado
> Nunca passe `z.object(...)` inline no decorator. Veja [[guides/schemas-zod|Schemas Zod]].

### Exemplo completo

```typescript
@Controller("/user")
@ApiTags("Usuários")
export class UserController extends Controller {

  @Get("/:id")
  @ApiSummary("Buscar usuário", "Retorna um usuário pelo ID")
  @ApiParam("id", { type: "integer" })
  @ApiResponse(200, "Usuário encontrado", publicUserSchema)
  @ApiResponse(404, "Não encontrado")
  async findById(req: Request, res: Response) { ... }

  @Post("/")
  @ApiBody(createUserSchema, "Dados do novo usuário")
  @ApiResponse(201, "Usuário criado", userResponseSchema)
  async create(req: Request, res: Response) { ... }
}
```

---

## Como Funciona

```mermaid
graph TD
    DEC["Decorators\n(tempo de compilação)"] -->|Reflect.defineMetadata| META[Metadata Store]
    META --> REG[registerControllers.ts]
    REG --> ROUTER[Express Router]
    META --> GEN[swagger.generator.ts]
    GEN -->|zod-to-json-schema| SPEC[OpenAPI 3.0 Spec]
    SPEC --> UI[/api-docs — Swagger UI]
    SPEC --> JSON[/api-docs-json — raw spec]
```

1. Decorators armazenam metadados via `Reflect.defineMetadata` em tempo de compilação
2. `registerControllers()` lê os metadados e registra cada rota no Express Router com seus middlewares
3. `swagger.generator.ts` lê os mesmos metadados e converte schemas Zod → JSON Schema via `zod-to-json-schema`
4. Spec gerada é servida em `/api-docs` (UI) e `/api-docs-json` (raw)

---

## Registro de Controllers

`src/index.ts` passa a lista de controllers para `registerControllers`:

```typescript
registerControllers(app, [
  AuthController,
  UserController,
  // Adicione novos controllers aqui
])
```

Cada controller registrado tem suas rotas automaticamente vinculadas ao prefixo global `/api`.

---

## Relacionado

- [[guides/schemas-zod|Schemas Zod]] — convenção de organização de schemas
- [[guides/new-module|Criar Novo Módulo]] — fluxo completo incluindo decorators
- [[core/error-handling|Tratamento de Erros]] — `parseSchema` e `handleError` nos controllers
