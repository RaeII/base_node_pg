# Organização do Zod nos Controllers

## Regra principal

- **Nunca** defina schemas Zod (`z.object(...)`) diretamente dentro dos decorators do controller.
- **Sempre** crie os schemas no arquivo de schema do módulo e **importe** no controller.

## Estrutura de arquivos

```
src/modules/<modulo>/
├── <modulo>.controller.ts    ← importa os schemas
└── schema/ ou schemas/
    └── <modulo>.schema.ts    ← define os schemas aqui
```

## O que vai no arquivo de schema

- Schemas de **validação de entrada** (body da request) → ex: `loginSchema`, `createUserSchema`
- Schemas de **resposta** (para documentação Swagger) → ex: `loginResponseSchema`, `errorResponseSchema`
- **Types** inferidos dos schemas → ex: `export type LoginSchema = z.infer<typeof loginSchema>`

## O que vai no controller

- Apenas os **imports** dos schemas
- Uso direto nos decorators: `@ApiBody(loginSchema, "...")` e `@ApiResponse(200, "...", loginResponseSchema)`
- O controller fica "magro" — sem nenhum `z.object(...)` no corpo do arquivo

## Exemplo rápido

```ts
// ❌ ERRADO — schema inline no controller
@ApiBody(z.object({ name: z.string() }), "Dados")
@ApiResponse(200, "OK", z.object({ token: z.string() }))

// ✅ CERTO — schema importado do arquivo de schema
@ApiBody(createJwtBodySchema, "Dados")
@ApiResponse(200, "OK", createJwtResponseSchema)
```

## Checklist ao criar uma nova rota

- [ ] Criar os schemas de body e response no `<modulo>.schema.ts`
- [ ] Exportar os schemas e os types inferidos
- [ ] Importar no controller
- [ ] Usar nos decorators `@ApiBody` e `@ApiResponse`
- [ ] Não importar `z` diretamente no controller (sinal de que algo está inline)
