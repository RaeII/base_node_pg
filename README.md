# 🚀 Back Node — Projeto Base para Backend em Node.js

Um boilerplate moderno e opinado para construir APIs RESTful com **Node.js**, **Express 5** e **TypeScript**. Este projeto foi pensado para servir como ponto de partida para novos backends, oferecendo uma arquitetura limpa, modular e escalável — com foco em produtividade e boas práticas desde o primeiro commit.

A ideia é simples: ao invés de configurar tudo do zero a cada novo projeto, você clona este repositório e já tem uma infraestrutura sólida pronta para uso, incluindo sistema de rotas baseado em **decorators**, validação com **Zod v4**, **documentação automática com Swagger**, autenticação JWT, conexão com banco de dados e muito mais.

---

## ✨ Principais Funcionalidades

- ⚡ **Express 5** com TypeScript completo
- 🎯 **Decorators customizados** para rotas, middlewares e documentação
- 📖 **Swagger automático** — documentação gerada a partir dos decorators e schemas Zod
- 🔐 **Autenticação JWT** com middlewares prontos
- 🛡️ **Validação de dados** com Zod v4 (entrada e saída)
- 🗄️ **Suporte a banco de dados** MySQL/MSSQL
- 📁 **Arquitetura modular** — organização por domínio (modules)
- 🔄 **Hot reload** com Nodemon em desenvolvimento

---

## 📦 Tecnologias

| Tecnologia | Versão | Uso |
|---|---|---|
| Node.js | 20+ | Runtime |
| TypeScript | ^5.3 | Linguagem |
| Express | ^5.2 | Framework HTTP |
| Zod | ^4.3 | Validação de schemas |
| Swagger UI Express | ^5.0 | Documentação da API |
| JSON Web Token | ^9.0 | Autenticação |
| Bcrypt | ^6.0 | Hash de senhas |
| MySQL2 | ^2.3 | Driver do banco MySQL |
| reflect-metadata | ^0.2 | Suporte a decorators |

---

## 🏁 Início Rápido

> **Pré-requisito:** Ter o [GitHub CLI](https://cli.github.com/) instalado e autenticado (`gh auth login`).

```bash
# 1. Clonar o template em uma nova pasta
git clone git@github.com:RaeII/base_node.git meu-projeto
cd meu-projeto

# 2. Remover o vínculo com o repositório original
rm -rf .git

# 3. Inicializar um novo repositório git
git init -b main
git add .
git commit -m "feat: init"

# 4. Criar o repositório no GitHub e subir automaticamente
gh repo create meu-projeto --private --source=. --push

# 5. Instalar dependências
bun install

# 6. Configurar variáveis de ambiente
cp .env.example .env

# 7. Rodar em desenvolvimento
bun dev
```

> 💡 **Sobre o `gh repo create`:**
> - `--private` → cria o repositório como privado (troque por `--public` se preferir público)
> - `--source=.` → usa o diretório atual como código fonte
> - `--push` → faz o push do commit inicial automaticamente

Para build de produção:

```bash
yarn build
yarn start
```

Após iniciar, o servidor estará disponível em `http://localhost:3003` (ou a porta definida no `.env`).

---

## 📁 Estrutura de Pastas

```
src/
├── index.ts                            # Ponto de entrada da aplicação
├── config/                             # Configurações e variáveis de ambiente
│   └── index.ts
├── modules/                            # Módulos da aplicação (domínios)
│   ├── auth/                           # Módulo de autenticação
│   │   ├── auth.controller.ts
│   │   └── schemas/
│   │       └── login.schema.ts
│   └── user/                           # Módulo de usuário
│       ├── user.controller.ts
│       ├── user.service.ts
│       ├── user.database.ts
│       └── schema/
│           └── user.schema.ts
├── shared/                             # Código compartilhado entre módulos
│   ├── core/                           # Classes base e abstrações
│   │   ├── Controller.ts               # Classe base para controllers
│   │   ├── decorators.ts               # Decorators de rotas (@Controller, @Get, @Post, etc.)
│   │   ├── registerControllers.ts      # Registro automático de controllers no Express
│   │   ├── decorators/                 # Decorators de documentação
│   │   │   ├── index.ts                # Barrel exports
│   │   │   └── swagger.decorators.ts   # @ApiBody, @ApiResponse, @ApiSummary, @ApiTags, @ApiParam
│   │   └── swagger/                    # Geração automática de documentação
│   │       ├── swagger.generator.ts    # Gerador de especificação OpenAPI 3.0
│   │       └── swagger.setup.ts        # Setup do Swagger UI Express
│   ├── infra/                          # Infraestrutura (banco de dados, adapters)
│   │   └── database/
│   ├── loaders/                        # Inicialização da aplicação
│   │   ├── index.ts
│   │   └── express.ts
│   ├── middlewares/                    # Middlewares globais
│   │   ├── jwt.middleware.ts
│   │   └── admin.middleware.ts
│   └── utils/                          # Utilitários
│       ├── async_local_storage.ts
│       ├── response_collection.ts
│       └── sendDiscord.ts
└── types/                              # Tipagens globais
```

### `src/modules`

Contém as funcionalidades principais da aplicação, agrupadas por **domínio** (ex: `user`, `auth`). Cada módulo é **self-contained**, possuindo seus próprios controllers, services, schemas e camada de acesso a dados.

### `src/shared`

Código compartilhado entre múltiplos módulos ou infraestrutura base da aplicação:

- **`core/`** — Classes base, decorators e abstrações fundamentais.
- **`core/decorators/`** — Decorators para documentação Swagger da API.
- **`core/swagger/`** — Gerador automático da especificação OpenAPI e setup do Swagger UI.
- **`infra/`** — Implementações de infraestrutura (banco de dados, adapters externos).
- **`loaders/`** — Inicializadores da aplicação (Express, conexões, etc.).
- **`middlewares/`** — Middlewares reutilizáveis (autenticação JWT, permissão admin).
- **`utils/`** — Funções utilitárias compartilhadas.

---

## 🎯 Sistema de Decorators

O projeto utiliza **decorators TypeScript** para definir rotas de forma declarativa, eliminando a necessidade de arquivos de rotas separados. Os controllers são registrados automaticamente no Express.

### Decorators de Rota

Definidos em `src/shared/core/decorators.ts`:

| Decorator | Tipo | Descrição |
|---|---|---|
| `@Controller(prefix)` | Classe | Define o prefixo de rota do controller |
| `@Get(path)` | Método | Registra uma rota GET |
| `@Post(path)` | Método | Registra uma rota POST |
| `@Put(path)` | Método | Registra uma rota PUT |
| `@Patch(path)` | Método | Registra uma rota PATCH |
| `@Delete(path)` | Método | Registra uma rota DELETE |
| `@Middleware(...handlers)` | Método | Adiciona middlewares à rota |

### Decorators de Documentação (Swagger)

Definidos em `src/shared/core/decorators/swagger.decorators.ts`:

| Decorator | Tipo | Descrição |
|---|---|---|
| `@ApiTags(...tags)` | Classe ou Método | Agrupa rotas por tag no Swagger |
| `@ApiSummary(resumo, descrição?)` | Método | Define título e descrição da rota |
| `@ApiBody(zodSchema, descrição?)` | Método | Documenta o corpo da requisição usando um schema Zod |
| `@ApiResponse(status, descrição, zodSchema?)` | Método | Documenta uma resposta da rota (pode ser usado múltiplas vezes) |
| `@ApiParam(nome, opções?)` | Método | Documenta parâmetros de path ou query |

### Exemplo Completo de Uso

```typescript
import { Request, Response } from "express";
import { z } from "zod";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Post, Get, Middleware } from "@/shared/core/decorators";
import { ApiBody, ApiResponse, ApiSummary, ApiTags, ApiParam } from "@/shared/core/decorators/index";

// Schemas de validação (entrada)
const createItemSchema = z.object({
  name: z.string().min(3).max(100),
  price: z.number().positive(),
});

// Schemas de resposta (documentação Swagger)
const itemResponseSchema = z.object({
  data: z.object({
    id: z.number(),
    name: z.string(),
    price: z.number(),
  }),
});

@Route("/items")
@ApiTags("Itens")
class ItemController extends Controller {

  @Get("/:id")
  @ApiSummary("Buscar item", "Retorna um item pelo ID")
  @ApiParam("id", { type: "integer", description: "ID do item" })
  @ApiResponse(200, "Item encontrado", itemResponseSchema)
  @ApiResponse(404, "Item não encontrado")
  async findById(req: Request, res: Response) {
    // ...
  }

  @Post("/")
  @Middleware(authMiddleware)
  @ApiSummary("Criar item", "Cria um novo item no sistema")
  @ApiBody(createItemSchema, "Dados do item")
  @ApiResponse(201, "Item criado com sucesso", itemResponseSchema)
  @ApiResponse(400, "Dados inválidos")
  async create(req: Request, res: Response) {
    // ...
  }
}

export default ItemController;
```

---

## 📖 Documentação Swagger (Automática)

A documentação da API é **gerada automaticamente** a partir dos decorators aplicados nos controllers e dos schemas Zod. Não é necessário escrever manualmente a especificação OpenAPI.

### Como Funciona

1. Os decorators `@ApiBody`, `@ApiResponse`, `@ApiSummary` e `@ApiTags` armazenam metadados via `reflect-metadata`.
2. O `swagger.generator.ts` lê esses metadados e converte os schemas Zod para JSON Schema usando o `toJSONSchema` nativo do **Zod v4**.
3. O `swagger.setup.ts` monta o Swagger UI Express com a especificação gerada.

### URLs

| URL | Descrição |
|---|---|
| `/api-docs` | Interface visual do Swagger UI |
| `/api-docs-json` | Especificação OpenAPI 3.0 em JSON |

### Configuração

O Swagger é configurado no `src/index.ts`:

```typescript
setupSwagger(app, "/api", controllers, {
  title: "Back Node API",
  description: "Documentação automática da API.",
  version: "1.0.0",
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: "Servidor de desenvolvimento",
    },
  ],
});
```

### Schemas Organizados

Os schemas Zod ficam organizados dentro de cada módulo, separados em seções:

```typescript
// src/modules/user/schema/user.schema.ts

// ─── Schemas de Validação (entrada) ─────────────────────────────
export const createUserSchema = z.object({ ... }).strict();

// ─── Schemas de Resposta (documentação Swagger) ─────────────────
export const createUserResponseSchema = z.object({ ... });
export const validationErrorResponseSchema = z.object({ ... });
```

Os controllers importam e usam esses schemas de forma limpa:

```typescript
@ApiBody(createUserSchema, "Dados do novo usuário")
@ApiResponse(201, "Usuário criado com sucesso", createUserResponseSchema)
@ApiResponse(400, "Dados inválidos", validationErrorResponseSchema)
```

---

## 🔐 Autenticação

O sistema utiliza **JWT (JSON Web Token)** para autenticação. Dois middlewares estão disponíveis:

- **`jwt.middleware.ts`** — Valida se o token JWT é válido.
- **`admin.middleware.ts`** — Verifica se o usuário autenticado é administrador.

### Uso nos Controllers

```typescript
@Post("/")
@Middleware(
  jwtMiddleware.validJWTNeeded.bind(jwtMiddleware),
  adminMiddleware.adminOnly.bind(adminMiddleware)
)
async create(req: Request, res: Response) { ... }
```

---

## ➕ Como Criar um Novo Módulo

1. **Crie a pasta** `src/modules/meu-modulo/`

2. **Crie o schema** `src/modules/meu-modulo/schema/meu-modulo.schema.ts`:
   ```typescript
   import { z } from "zod";

   // Schemas de Validação
   export const createMeuModuloSchema = z.object({ ... }).strict();

   // Schemas de Resposta (Swagger)
   export const meuModuloResponseSchema = z.object({ ... });
   ```

3. **Crie o service** `src/modules/meu-modulo/meu-modulo.service.ts`

4. **Crie o controller** `src/modules/meu-modulo/meu-modulo.controller.ts`:
   ```typescript
   @Route("/meu-modulo")
   @ApiTags("Meu Módulo")
   class MeuModuloController extends Controller { ... }
   ```

5. **Registre o controller** no `src/index.ts`:
   ```typescript
   import MeuModuloController from "@/modules/meu-modulo/meu-modulo.controller";

   const controllers = [
     AuthController,
     UserController,
     MeuModuloController, // ← adicionar aqui
   ];
   ```

As rotas e a documentação Swagger serão registradas automaticamente. ✅

---

## ⚙️ Scripts Disponíveis

| Script | Comando | Descrição |
|---|---|---|
| Desenvolvimento | `yarn dev` | Inicia com hot reload via Nodemon |
| Build | `yarn build` | Compila TypeScript para `dist/` |
| Produção | `yarn start` | Executa a build compilada |

---

## 📝 Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
PORT=3003

# Banco de dados
DB_HOSTNAME=localhost
DB_PORT=3306
DB_USERNAME=
DB_PASSWORD=
DB_NAME=meu_banco

# Autenticação
AUTHORIZATION=1
JWT_SECRET=minha_chave_secreta

# Integração (opcional)
DISCORD_WEBHOOK=
```

