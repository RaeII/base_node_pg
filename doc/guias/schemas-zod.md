---
title: Schemas Zod
tags:
  - guides
  - zod
  - schemas
---

# Schemas Zod

Convenção para definir e usar schemas Zod (v4) no projeto.

---

## Regra principal

> [!important] Nunca inline no controller
> Nunca defina `z.object(...)` dentro dos decorators ou do corpo do controller. Sempre crie no arquivo `<modulo>.schema.ts` e importe. Se você precisou `import { z }` no controller, algo está inline.

---

## Estrutura de arquivos

```
src/modules/<modulo>/
├── <modulo>.controller.ts    ← importa os schemas
└── schema/                   ← define os schemas aqui
    └── <modulo>.schema.ts
```

---

## O que vai no arquivo de schema

- **Validação de entrada** (body): ex. `loginSchema`, `createUserSchema` — sempre `.strict()` e `.max()` em strings.
- **Schemas de resposta** (Swagger): ex. `userResponseSchema`, `validationErrorResponseSchema`.
- **Schemas de banco**: ex. `dbUserRowSchema` (linha crua).
- **Types inferidos**: `export type CreateUserInput = z.infer<typeof createUserSchema>`.

Organize por seções com comentários, como em `user.schema.ts`:

```typescript
// ─── Validação (entrada) ───
export const createUserSchema = z.object({ ... }).strict();
export type CreateUserInput = z.infer<typeof createUserSchema>;

// ─── Banco ───
export const dbUserRowSchema = z.object({ ... });

// ─── Resposta (Swagger) ───
export const createUserResponseSchema = z.object({ data: z.object({ ... }) });
```

---

## O que vai no controller

- Apenas **imports** dos schemas.
- Uso direto nos decorators e em `parseSchema`:

```typescript
// ❌ ERRADO — inline
@ApiBody(z.object({ name: z.string() }), "Dados")

// ✅ CERTO — importado
@ApiBody(createItemSchema, "Dados")
@ApiResponse(201, "Criado", itemResponseSchema)
async create(req, res) {
  const body = parseSchema(createItemSchema, req.body);
}
```

---

## Boas práticas de validação

- **`.strict()`** em bodies — rejeita campos não esperados (vetor de ataque / typos silenciosos).
- **`.max()`** em toda string — strings sem limite são vetor de ataque (memória, índices, payloads gigantes).
- **`.trim()`** em identificadores antes de validar tamanho.
- **`superRefine`** para regras cruzadas (ex.: "exatamente um identificador" no `loginSchema`).
- **Datas**: `z.date()` é convertido para `string`/`date-time` no Swagger automaticamente (ver [[decorators#Como Funciona]]).
- **Resposta paginada**: use `createPaginatedSchema(itemSchema)` (ver [[paginacao]]).

---

## Como vira documentação

`@ApiBody`/`@ApiResponse` recebem o schema Zod; o gerador converte para JSON Schema (OpenAPI 3.0) com `toJSONSchema` nativo do Zod v4. Detalhes em [[decorators]].

---

## Checklist ao criar uma rota

- [ ] Schemas de body e response em `<modulo>.schema.ts`
- [ ] Exportar schemas + types inferidos
- [ ] `.strict()` no body, `.max()` nas strings
- [ ] Importar no controller e usar nos decorators
- [ ] Não importar `z` no controller

---

## Relacionado

- [[decorators|Decorators Swagger]] — `@ApiBody`, `@ApiResponse`
- [[novo-modulo|Criar Novo Módulo]] — fluxo completo
- [[usuarios|Módulo Usuários]] — schemas reais de referência
