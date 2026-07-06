---
title: Observabilidade
tags:
  - global
  - logging
  - discord
  - observability
---

# Observabilidade

Logs estruturados, alertas de erro e monitor de saturação do pool.

---

## Logger — Winston

**Arquivo:** [`src/shared/utils/logger.ts`](../../src/shared/utils/logger.ts).

```typescript
import logger from "@/shared/utils/logger";

logger.info("Servidor iniciado", { port });
logger.warn("Slow query", { sql, ms });
logger.error("Falha", { err: e.message });
```

| Característica | Detalhe |
| --- | --- |
| Nível | `info` em produção, `debug` em dev (`LOG_LEVEL` sobrescreve) |
| Console | **apenas fora de produção** (colorido) |
| Arquivos | `logs/error-*.log` (30d) e `logs/combined-*.log` (14d), rotação diária, `gzip` |
| Exceções | `exceptions-*.log` e `rejections-*.log` capturam não-tratadas |
| Formato | JSON com `timestamp` + `stack` nos arquivos |

> [!warning] Nunca logue dados sensíveis
> Os wrappers de query logam apenas `paramCount`, nunca os `params`. Mantenha esse cuidado em logs novos (senhas, tokens, CPF).

---

## Alertas — `sendDiscord`

**Arquivo:** [`src/shared/utils/sendDiscord.ts`](../../src/shared/utils/sendDiscord.ts). Singleton; usa `DISCORD_WEBHOOK`.

```typescript
import sendDiscord from "@/shared/utils/sendDiscord";

await sendDiscord.sendErrorAlert("Falha ao criar usuário", error); // embed detalhado (message, stack…)
await sendDiscord.sendAlert("APP_ERROR", "Título", "Mensagem");     // alerta genérico
```

Chamado automaticamente por `handleError`/`throwInternal` (ver [[tratamento-de-erros]]) em modo **fire-and-forget** — nunca bloqueia nem mascara a resposta. Os embeds são carimbados com [[funcoes-globais#Data/hora BR — getDateTimeBr.ts|data/hora de Brasília]].

> [!important] Throttle anti-flood
> A **mesma mensagem** de erro só gera alerta 1x por minuto (`shouldNotifyDiscord` em `error.ts`) — o log em arquivo registra todas as ocorrências. Sem isso, erros repetidos (atacante ou bug em loop) floodam o canal. O watchdog do pool tem cooldown próprio (`POOL_WATCHDOG_COOLDOWN_MS`).

### Auditoria de autenticação

O módulo auth registra no Winston: `Login success` (`userId`, `ip`), `Login failed` (`ip`), `Signup success` (`userId`, `ip`) e `Service JWT issued` (`name`, `issuedBy`). Nunca logue senha, hash ou token — ver [[seguranca]].

---

## Watchdog do pool

**Arquivo:** [`src/db/watchdog.ts`](../../src/db/watchdog.ts). Iniciado no boot (`startPoolWatchdog()`) e parado no `drain()` — ver [[ciclo-de-vida]].

- Faz polling de `getPoolMetrics()` a cada `POOL_WATCHDOG_INTERVAL_MS` (default 10s).
- Considera o pool saturado quando `waitingCount > 0` ou `idleCount === 0`.
- Dispara alerta no Discord após `POOL_WATCHDOG_SATURATION_TICKS` checagens saturadas seguidas (default 3 = ~30s), respeitando o cooldown `POOL_WATCHDOG_COOLDOWN_MS` (default 5min) para não floodar o canal.
- Avalia `write` e `read` separadamente; reseta o contador quando o pool se recupera.

> [!example] Mensagem de alerta
> ```
> 🚨 Pool `write` saturado (base_node_pg)
> waiting=3  idle=0  total=16
> Requisições estão na fila — banco prestes a saturar.
> ```

---

## Endpoints relacionados

- `GET /api/system/health` e `GET /api/system/metrics` — ver [[sistema|Módulo Sistema]].

---

## Relacionado

- [[tratamento-de-erros|Tratamento de Erros]] — quando o Discord é acionado
- [[camada-de-acesso|Camada de Acesso a Dados]] — `getPoolMetrics`, slow query log
- [[sistema|Módulo Sistema]] — health e métricas via HTTP
