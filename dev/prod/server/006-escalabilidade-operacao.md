# 006 — Escalabilidade e Operação

Como crescer sem reescrever: múltiplas instâncias, dimensionamento do pool de banco, zero-downtime, monitoramento e backup.

---

## 1. Ordem de escala (não pule etapas)

1. **Medir primeiro.** `/api/system/metrics` (pool), `rt=`/`urt=` no access log do nginx ([004](004-nginx-proxy-tls.md)), `htop`. Gargalo típico de API CRUD é **banco**, não CPU do Node.
2. **Vertical:** subir o VPS (CPU/RAM) é a escala mais barata em complexidade. Vale até o limite do orçamento/máquina.
3. **Horizontal na mesma máquina:** Node/Bun usa 1 core por processo — servidor com 4 cores roda 1 instância e desperdiça 3. Múltiplas instâncias atrás do nginx (§2).
4. **Réplica de leitura** no PostgreSQL — a base já suporta nativamente (§4).
5. **Múltiplas máquinas** — mesmo desenho do §2, com nginx/LB numa máquina apontando para as outras. Aí normalmente é hora de considerar gerenciado (K8s, ECS…).

## 2. Múltiplas instâncias na mesma máquina

Template unit do systemd — uma instância por porta. `/etc/systemd/system/base-node@.service` (mesma unit de [003](003-aplicacao-producao.md), com duas mudanças):

```ini
[Service]
# ...tudo igual à unit de 003, exceto:
Environment=NODE_ENV=production
Environment=PORT=%i
ExecStart=/usr/local/bin/bun dist/index.js
```

> `PORT` via systemd tem precedência sobre o `.env` (dotenv não sobrescreve env já setada) — o resto da config continua vindo do `.env` compartilhado.

```bash
sudo systemctl disable --now base-node          # sai da instância única
sudo systemctl enable --now base-node@3001 base-node@3002 base-node@3003
```

nginx: upstream com as instâncias ([004](004-nginx-proxy-tls.md)):

```nginx
upstream base_node {
    least_conn;                      # manda para a instância menos ocupada
    server 127.0.0.1:3001 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:3002 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:3003 max_fails=3 fail_timeout=10s;
    keepalive 32;
}
```

`max_fails/fail_timeout`: instância que falha 3x sai do rodízio por 10s — crash de uma instância vira degradação, não outage.

**Consequências de N instâncias (importante):**

- **Rate limit da app multiplica por N** (MemoryStore é por processo). O limite global por IP passa a ser responsabilidade do `limit_req` do nginx ([005](005-protecao-ddos-e-abuso.md)), ou troque o store do `express-rate-limit` por Redis (`rate-limit-redis`) se precisar de precisão na app.
- **Pool de banco multiplica por N** — redimensione (§3).
- JWT em cookie é stateless — **não precisa** de sticky session. Nada nesta base guarda estado em memória entre requisições.

## 3. Dimensionamento do pool PostgreSQL

Regra: **soma de todas as conexões possíveis < `max_connections` do Postgres** (default 100), com folga para superuser/migração/psql manual.

```
(DB_POOL_MAX + DB_READ_POOL_MAX) × num_instâncias ≤ max_connections × 0.8
```

Exemplo com 3 instâncias e `max_connections=100`: budget 80 → ~26 por instância → `DB_POOL_MAX=16` + `DB_READ_POOL_MAX=8` fica dentro. O `.env.example` documenta a fórmula do pool de leitura.

Sintoma de pool errado: watchdog alertando `waitingCount > 0` no Discord (pool pequeno para a carga) **ou** Postgres recusando conexão `too many clients` (soma estourou). Muitas instâncias/máquinas → hora de PgBouncer (ver `doc/banco-de-dados/postgres.md`).

## 4. Réplica de leitura

A base já tem pool duplo — apontar `readQuery()` para réplica é só env:

```bash
DB_READ_HOST=replica.interna.exemplo.com
DB_READ_PORT=5432
DB_READ_POOL_MAX=8
```

Sem `DB_READ_HOST`, o pool de leitura aponta ao primário (comportamento atual). Réplica tira `SELECT`s pesados (listagens, relatórios) do primário. Lembre: replicação é assíncrona — leitura logo após escrita pode vir defasada; fluxos que leem o que acabaram de escrever devem usar `query()` (primário), padrão que a camada já segue dentro de transações.

## 5. Deploy zero-downtime (com ≥ 2 instâncias)

Restart em rolling — nginx (`max_fails`) desvia o tráfego da instância reiniciando:

```bash
cd /var/www/base_node_pg
sudo -u nodeapp git pull && sudo -u nodeapp bun install --frozen-lockfile
sudo -u nodeapp bun run build
sudo -u nodeapp bun run scripts/migrate.ts   # migration deve ser retrocompatível com a versão antiga ainda no ar

for port in 3001 3002 3003; do
  sudo systemctl restart base-node@$port
  sleep 3
  curl -sf localhost:$port/api/system/health > /dev/null || { echo "FALHOU $port — abortando"; break; }
done
```

> Regra de ouro do rolling deploy: **migration primeiro, sempre retrocompatível** (adicionar coluna nullable ok; dropar/renomear coluna usada pela versão antiga = quebra durante a janela). Dropar coluna só num deploy seguinte, quando nenhuma instância antiga existe.

## 6. Monitoramento

Mínimo viável, tudo já disponível na base:

| O quê | Como |
| --- | --- |
| Uptime externo | UptimeRobot/BetterStack/healthchecks.io em `GET /api/system/health` a cada 1min (retorna 503 se banco caiu — o monitor vê) |
| Saturação de pool | Watchdog já embutido → Discord (`POOL_WATCHDOG_*` no `.env`) |
| Erros internos | `throwInternal` já alerta no Discord com throttle |
| Latência/ataque | `rt=`/`urt=` no access log do nginx ([004](004-nginx-proxy-tls.md)) |
| Disco/CPU/RAM | `htop`, `df -h`; alerta simples via cron + webhook Discord, ou node_exporter+Prometheus quando crescer |
| Certificado TLS | `certbot renew` roda sozinho; monitor de uptime com check HTTPS acusa expiração |

Sinais de "hora de escalar": `waitingCount > 0` recorrente no watchdog, `urt` subindo com tráfego, CPU de 1 core fixa em 100% (instância única saturada).

## 7. Backup do PostgreSQL

Backup que nunca foi restaurado não é backup.

```bash
# /usr/local/bin/pg-backup.sh (cron diário, usuário postgres)
#!/usr/bin/env bash
set -euo pipefail
DB=meu_banco
DEST=/var/backups/postgres
mkdir -p "$DEST"
pg_dump -Fc "$DB" > "$DEST/${DB}_$(date +%F).dump"
find "$DEST" -name "${DB}_*.dump" -mtime +14 -delete   # retenção 14 dias
```

```bash
sudo -u postgres crontab -e
# 30 3 * * * /usr/local/bin/pg-backup.sh
```

- **Off-site obrigatório**: servidor que morre leva os backups locais junto. `rclone` para S3/B2/Drive no fim do script.
- **Teste de restore** trimestral: `pg_restore -d teste_restore arquivo.dump` num banco descartável.
- Banco gerenciado (RDS, Cloud SQL, Neon…) já faz isso — mais um argumento para usá-lo em produção séria.

## 8. Rotina de operação

| Frequência | Tarefa |
| --- | --- |
| Contínuo | Alertas Discord (erros, watchdog), monitor de uptime |
| Semanal | `journalctl -u 'base-node*' -p err --since -7d`; olhada no `fail2ban-client status`; disco `df -h` |
| Mensal | `bun outdated` + atualizar dependências com CVE; conferir `unattended-upgrades` funcionando (`/var/log/unattended-upgrades/`) |
| Trimestral | Teste de restore do backup; revisar acessos SSH (`last`, `authorized_keys`) |
