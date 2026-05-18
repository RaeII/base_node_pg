---
title: Organização de Schemas Zod
tags:
  - guides
  - zod
  - schemas
---

# Organização de Schemas Zod

Convenção para definir e usar schemas Zod no projeto.

---

## Regra Principal

> [!important] Nunca inline no controller
> Nunca defina `z.object(...)` diretamente dentro dos decorators. Sempre crie schemas no arquivo `<modulo>.schema.ts` e importe.

---

## Estrutura de Arquivos

```
src/modules/<modulo>/
├── <modulo>.controller.ts    ← importa os schemas
└── schema/                   ← define os schemas aqui
    └── <modulo>.schema.ts
```

---

## O que vai no arquivo de schema

- **Schemas de validação de entrada** (body da request) — ex: `loginSchema`, `createUserSchema`
- **Schemas de resposta** (para documentação Swagger) — ex: `loginResponseSchema`, `errorResponseSchema`
- **Types inferidos** dos schemas — ex: `export type LoginSchema = z.infer<typeof loginSchema>`

---

## O que vai no controller

- Apenas os **imports** dos schemas
- Uso direto nos decorators: `@ApiBody(loginSchema, "...")` e `@ApiResponse(200, "...", loginResponseSchema)`
- O controller fica sem nenhum `z.object(...)` no corpo do arquivo

---

## Exemplo

```typescript
// ❌ ERRADO — schema inline no controller
@ApiBody(z.object({ name: z.string() }), "Dados")
@ApiResponse(200, "OK", z.object({ token: z.string() }))

// ✅ CERTO — schema importado do arquivo de schema
@ApiBody(createJwtBodySchema, "Dados")
@ApiResponse(200, "OK", createJwtResponseSchema)
```

---

## Checklist ao criar uma nova rota

- [ ] Criar os schemas de body e response no `<modulo>.schema.ts`
- [ ] Exportar os schemas e os types inferidos
- [ ] Importar no controller
- [ ] Usar nos decorators `@ApiBody` e `@ApiResponse`
- [ ] Não importar `z` diretamente no controller — se importar, algo está inline

---

## Relacionado

- [[core/decorators|Decorators Swagger]] — `@ApiBody`, `@ApiResponse`, `@ApiTags`
- [[guides/new-module|Criar Novo Módulo]] — fluxo completo com schema
- [[modules/users|Módulo Usuários]] — exemplo de referência com schemas reais
