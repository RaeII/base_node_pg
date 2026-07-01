# 003 — Aplicação em Produção

Como rodar esta base em produção: `.env` correto, processo gerenciado pelo systemd, deploy e permissões. A aplicação já traz várias proteções embutidas — a maior parte do trabalho aqui é **configurá-las certo**, não adicionar coisa nova.

---

## 1. `.env` de produção

O boot é **fail-closed**: em produção (`NODE_ENV=production`) a app **recusa subir** se `AUTHORIZATION != 1` ou `JWT_SECRET < 32` chars (`validateSecurityConfig()` em `src/shared/loaders/index.ts`). Isso é proposital — deploy com env incompleta vira crash visível, não API aberta.

Valores que **mudam** em relação ao dev:

```bash
NODE_ENV=production          # setado pelo systemd (ver §3), não precisa estar no .env
AUTHORIZATION=1              # obrigatório — boot falha sem isso
JWT_SECRET=<openssl rand -base64 48>
JWT_EXPIRES_IN_SECONDS=604800    # 7 dias; não há revogação de token — não aumente

# Origens do SEU frontend, explícitas. Vazio em produção = nenhuma origem cross-site.
CORS_ORIGINS=https://app.exemplo.com

# 1 = um proxy confiável na frente (nginx). Sem isso o rate limit por IP
# enxerga o IP do nginx para todo mundo e vira um limite global do servidor.
TRUST_PROXY=1

# Rate limit da aplicação (2ª camada — a 1ª é o nginx, ver 005)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
RATE_LIMIT_LOGIN_WINDOW_MS=60000
RATE_LIMIT_LOGIN_MAX=5

# Banco: usuário da app SEM DDL; migration user separado; SSL se banco remoto/gerenciado
DB_APP_USER=app_user
DB_MIGRATION_USER=migration_user
DB_SSL=true                  # verify-full com DB_SSL_CA se o banco não é localhost

DISCORD_WEBHOOK=https://discord.com/api/webhooks/...   # alertas de erro interno + watchdog do pool
```

Permissões do arquivo (contém segredos):

```bash
sudo chown nodeapp:nodeapp /var/www/base_node_pg/.env
sudo chmod 600 /var/www/base_node_pg/.env
```

> Swagger UI (`/api-docs`) já é desligado automaticamente em produção — não expõe o contrato da API.

## 2. Instalação no servidor

```bash
# Bun system-wide (acessível ao usuário de serviço)
curl -fsSL https://bun.sh/install | bash
sudo cp ~/.bun/bin/bun /usr/local/bin/bun

cd /var/www
sudo git clone <repo> base_node_pg
sudo chown -R nodeapp:nodeapp base_node_pg
cd base_node_pg

sudo -u nodeapp bun install --frozen-lockfile
sudo -u nodeapp cp .env.example .env    # preencha (ver §1)
sudo -u nodeapp bun run build           # tsc + tsc-alias → dist/
sudo -u nodeapp bun run scripts/migrate.ts
```

## 3. systemd

`/etc/systemd/system/base-node.service`:

```ini
[Unit]
Description=base_node_pg API
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=nodeapp
Group=nodeapp
WorkingDirectory=/var/www/base_node_pg
Environment=NODE_ENV=production
# Roda o build compilado com Bun. O restante do env vem do .env (dotenv).
ExecStart=/usr/local/bin/bun dist/index.js

# Crash → volta sozinho. Backoff evita loop frenético se o boot falhar (fail-closed).
Restart=always
RestartSec=3
StartLimitBurst=5
StartLimitIntervalSec=60

# Graceful shutdown: a app trata SIGTERM (fecha HTTP + drena pool em até 10s)
KillSignal=SIGTERM
TimeoutStopSec=30

# Conexões TCP consomem file descriptors — default 1024 derruba em pico
LimitNOFILE=65536

# Sandbox: processo não escala privilégio nem escreve fora do que precisa
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/base_node_pg/logs

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now base-node
systemctl status base-node
journalctl -u base-node -f          # logs em tempo real
```

Pontos importantes da unit:

- **`Restart=always`** — a app já derruba o processo em `uncaughtException` (exit 1) de propósito; o systemd sobe de novo. Processo zumbi em estado corrompido é pior que restart.
- **`KillSignal=SIGTERM` + `TimeoutStopSec=30`** — casa com o graceful shutdown de `src/index.ts` (fecha o HTTP, drena o pool com timeout de 10s, sai com 0). Deploy/restart não corta requisição no meio.
- **`ProtectSystem=strict`** — filesystem inteiro read-only para o processo, exceto `logs/`. App comprometida não altera o próprio código nem o sistema.
- **`NODE_ENV=production` via `Environment=`** — variável de ambiente já setada tem precedência sobre o `.env` (dotenv não sobrescreve), garantindo modo produção mesmo se o `.env` esquecer.

## 4. Exposição de porta

`app.listen(env.PORT)` escuta em todas as interfaces (`0.0.0.0`). Em produção isso é coberto pelo UFW (`deny incoming` — porta 3000 inacessível de fora, ver [002](002-hardening-ubuntu.md)). O nginx acessa via `127.0.0.1:3000`.

Camada extra opcional (defesa em profundidade): fazer a app escutar só em localhost, mudando o `listen` em `src/index.ts` para `app.listen(env.PORT, "127.0.0.1", ...)`. Aí mesmo com firewall desligado por engano a app não fica exposta.

## 5. Deploy de nova versão

```bash
cd /var/www/base_node_pg
sudo -u nodeapp git pull
sudo -u nodeapp bun install --frozen-lockfile
sudo -u nodeapp bun run build
sudo -u nodeapp bun run scripts/migrate.ts       # migrations são imutáveis; só aplica pendentes
sudo systemctl restart base-node
curl -sf https://api.exemplo.com/api/system/health || echo "DEPLOY QUEBROU"
```

Downtime desse fluxo: ~2–5s (janela do restart). Zero-downtime de verdade exige 2+ instâncias atrás do nginx — ver [006](006-escalabilidade-operacao.md).

> Vale automatizar num `deploy.sh` — mas mantenha o passo de health check no final. Deploy sem verificação é como não ter deploy.

## 6. Logs

Dois destinos, papéis diferentes:

| Destino | O quê | Rotação |
| --- | --- | --- |
| `logs/` (Winston) | Logs estruturados da app (error/combined/exceptions) | `winston-daily-rotate-file` já rotaciona e comprime |
| journald (`journalctl -u base-node`) | stdout/stderr do processo (boot, crash, console) | Configure limite: |

```bash
# /etc/systemd/journald.conf → evita journal comer o disco
SystemMaxUse=500M
```

Erros internos (`throwInternal`) já disparam alerta no Discord com throttle — configure `DISCORD_WEBHOOK`. **Nunca** logue `params` de query ou body de request em produção (a camada de banco já sanitiza isso por design).

---

**Próximo:** [004 — nginx: proxy reverso e TLS](004-nginx-proxy-tls.md)
