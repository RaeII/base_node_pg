# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentação primeiro (regra principal)

A documentação canônica vive em [`doc/`](doc/index-doc.md) (vault Obsidian, em português, organizado por objetivo). **Sempre siga e mantenha essa documentação.**

- **Antes de implementar:** leia o índice [`doc/index-doc.md`](doc/index-doc.md) e a(s) página(s) relevantes da área que vai tocar (arquitetura, banco-de-dados, módulos, global, guias). As convenções do projeto estão lá, não as reinvente.
- **Ao mudar código:** atualize a documentação correspondente na **mesma tarefa**. Mudou um endpoint/contrato → atualize o módulo em `doc/modulos/` e a tabela de endpoints em `doc/index-doc.md`. Mudou uma função global → `doc/global/`. Mudou env/comandos → `doc/arquitetura/estrutura.md` e `doc/guias/comandos.md`.
- **Ao criar um módulo:** siga o passo a passo de [`doc/guias/novo-modulo.md`](doc/guias/novo-modulo.md) e crie a página do módulo em `doc/modulos/<modulo>/`.
- **Formato:** os arquivos `.md` em `doc/` são Obsidian Flavored Markdown — use wikilinks `[[nota]]`, callouts `> [!tip]` e frontmatter. Mantenha os wikilinks válidos (apontando para `name:` de notas existentes).
- **Fonte da verdade:** se código e doc divergirem, trate como bug e corrija ambos para ficarem consistentes.

Mapa da doc: `arquitetura/` (estrutura, decorators, ciclo-de-vida, tratamento-de-erros) · `banco-de-dados/` (camada-de-acesso, postgres, migrations) · `modulos/` (auth, usuarios, sistema) · `global/` (funcoes-globais, paginacao, observabilidade) · `guias/` (comandos, novo-modulo, schemas-zod).

## Comandos

Runtime/execução é **Bun** (compatível com Node ≥ 20).

```bash
bun install                          # dependências (usa bun.lock)
bun dev                              # dev com hot-reload (nodemon + ts-node)
bun run build                        # tsc + tsc-alias → dist/
bun start                            # produção (NODE_ENV=production)
bun run scripts/migrate.ts           # aplica migrations pendentes
bun run scripts/migrate.ts status    # lista aplicadas vs pendentes + checksum
bunx tsc --noEmit                    # type-check (não há suíte de testes no projeto)
```

Não há linter nem testes configurados — use `bunx tsc --noEmit` para validar mudanças. O alias de import `@/*` aponta para `src/*`.

## Arquitetura (visão geral)

API REST: **TypeScript + Express 5 + PostgreSQL (sem ORM, driver `pg`)**. Roteamento por decorators, validação Zod v4, Swagger gerado automaticamente.

**Fluxo de uma requisição:** `Middlewares → Controller → Service → Database (repo) → src/db/client.ts → Pool PostgreSQL`.

- **Decorators de rota** (`src/shared/core/decorators.ts`): o decorator de rota é exportado como `Controller` e **importado com alias `Route`** para não colidir com a classe base `Controller` (`src/shared/core/Controller.ts`). Os metadados (`reflect-metadata`) alimentam tanto o registro no Express (`registerControllers`) quanto a geração do Swagger (`swagger.generator.ts`, via `toJSONSchema` do Zod v4). Adicione novos controllers ao array em `src/index.ts`.
- **Camadas:** Controller valida com `parseSchema`, envolve mutações em `withTransaction`, responde, e usa `handleError(err, res)` no `catch`. Service tem a regra de negócio e lança `throwUser`/`throwInternal`. Database estende `Database` (`src/shared/infra/database/Database.ts`) e só faz SQL via `this.query(...)`.
- **Banco (`src/db/`):** pool duplo `writePool`/`readPool`; `query()`/`readQuery()` com retry de transientes e log sanitizado (nunca logam `params`); `withTransaction` usa `AsyncLocalStorage` (a camada Database pega o client da tx automaticamente) com cleanup `release(true)` e retry de `40001`/`40P01`; `healthCheck`/`getPoolMetrics` expostos no módulo `system`; watchdog alerta no Discord em saturação.
- **Erros (`src/shared/utils/error.ts`):** `throwUser` (vai ao cliente, sem log) vs `throwInternal` (genérico + Winston + Discord). `AppError` carrega `statusCode`/`isUserError`/`issues`.
- **Boot/shutdown (`src/index.ts`, `src/shared/loaders/`):** valida `JWT_SECRET` → `waitForDatabase()` → middlewares (`json`, `cookie-parser`, `cors`) → controllers → Swagger (fora de produção) → `listen` → `startPoolWatchdog`. Shutdown separa `drain()` (fecha) de `gracefulShutdown()` (exit 0); `uncaughtException` faz `drain` + exit 1.

## Convenções obrigatórias

- **Schemas Zod sempre em `*.schema.ts`**, nunca inline no controller. Use `.strict()` em bodies e `.max()` em toda string. Não importe `z` no controller.
- **Status ≠ 200:** `Controller.sendSuccessResponse` responde **sempre 200** — para `201`/`204` use `res.status(...).json(...)`.
- **Transações:** mutações multi-tabela ficam em `withTransaction(...)` no controller. Nunca dispare efeitos colaterais externos (email, fila, API) dentro da função — ela pode reexecutar por retry; use outbox.
- **Queries não-idempotentes** (`INSERT` simples): passe `{ noRetry: true }` ao `this.query`. Sempre parametrize (`$1`); nunca concatene input em SQL.
- **Autenticação:** middlewares são instâncias — aplique com `.bind` (ex.: `jwtMiddleware.validJWTNeeded.bind(jwtMiddleware)`). Só bloqueiam com `AUTHORIZATION=1`.
- **Migrations** são imutáveis após aplicadas (checksum SHA-256); para alterar schema, crie novo arquivo com prefixo numérico crescente.

## PostgreSQL

Há um skill dedicado **postgres-node-admin** (em `.claude/skills/`) para qualquer tarefa de banco — ele encapsula os padrões de pool, transações, migrations e observabilidade deste projeto. Use-o proativamente em tarefas de DB.

---

## Diretrizes de trabalho (gerais)

**Pense antes de codar:** explicite suposições; se houver múltiplas interpretações, apresente-as em vez de escolher em silêncio; aponte abordagens mais simples; pare e pergunte quando algo estiver ambíguo.

**Simplicidade:** o mínimo de código que resolve. Nada especulativo — sem features, abstrações ou "flexibilidade" não pedidas.

**Mudanças cirúrgicas:** toque só no necessário; case com o estilo existente; não refatore o que não está quebrado; remova apenas os órfãos que suas próprias mudanças criaram (não delete dead code pré-existente sem pedir).

**Execução guiada por objetivo:** transforme tarefas em critérios verificáveis e valide ao final (no mínimo `bunx tsc --noEmit` e consistência código↔doc).
