---
title: Módulo Sistema
tags:
  - modules
  - system
  - observability
---

# Módulo Sistema

Endpoints de **operação**: health check e métricas dos pools. Sem dependência de Prometheus/Datadog — JSON consumível por qualquer ferramenta.

**Pasta:** [`src/modules/system/`](../../../src/modules/system/). Sem auth (probes precisam acessar livremente).

---

## GET `/api/system/health`

Health check em camadas (delega para `healthCheck()` — ver [[camada-de-acesso#Health & boot]]).

- **HTTP 200** quando `status: "ok"`.
- **HTTP 503** quando `degraded` ou `down`.

O status code permite que K8s/load balancers decidam sem inspecionar o body:

- `ok` → vincule à **liveness probe** (não reinicie pods sob pressão).
- `degraded` → vincule à **readiness probe** (pare de mandar tráfego antes da saturação).

**Response (`degraded`, HTTP 503):**

```json
{
  "status": "degraded",
  "detail": {
    "ms": 1234,
    "write": { "totalCount": 16, "idleCount": 0, "waitingCount": 3 },
    "read":  { "totalCount": 16, "idleCount": 5, "waitingCount": 0 }
  }
}
```

Critério de `degraded`: `waitingCount > 0`, `idleCount === 0` (em qualquer pool) ou latência do `SELECT 1` > 1s.

---

## GET `/api/system/metrics`

Retorna `getPoolMetrics()` — estatísticas dos pools de escrita e leitura.

```json
{
  "write": { "totalCount": 16, "idleCount": 12, "waitingCount": 0 },
  "read":  { "totalCount": 16, "idleCount": 14, "waitingCount": 0 }
}
```

> [!danger] `waitingCount > 0` é o alarme de incêndio
> Requisições estão na fila — o banco vai saturar em seguida. O [[observabilidade#Watchdog do pool|watchdog]] dispara alerta no Discord automaticamente nessa condição.

**Alertas sugeridos:**

| Sinal | Significado | Ação |
| --- | --- | --- |
| `waiting > 0` por 30s+ | Pool saturado | P1: escalar / investigar query lenta |
| `idle/total < 0.1` sustentado | Subdimensionado | Aumentar `max` |
| `idle/total > 0.9` constante | Grande demais | Reduzir `max` |

---

## Relacionado

- [[observabilidade|Observabilidade]] — logger, watchdog e Discord
- [[camada-de-acesso|Camada de Acesso a Dados]] — `healthCheck`, `getPoolMetrics`
- [[postgres#11. Health check e startup resiliente|Guia PostgreSQL §11–12]]
