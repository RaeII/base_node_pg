# 005 — Proteção contra DDoS, Flood e Abuso

Defesa em camadas contra: flood de requisições para derrubar a app, brute-force, Slowloris, scanners e requisições que não partem do seu frontend. Ordem das seções = ordem em que o tráfego atravessa as camadas.

> **Honestidade primeiro:** um VPS sozinho **não para DDoS volumétrico** (ataque que satura o link de rede — dezenas de Gbps). Se o pipe encheu, não importa o que o nginx faz. A única defesa real nessa classe é uma borda distribuída (Cloudflare ou similar, §1). Todo o resto deste arquivo protege contra a classe muito mais comum: **flood de aplicação** (L7) — milhares de requisições baratas para esgotar CPU, conexões ou banco.

---

## 1. Borda: Cloudflare (recomendado)

Plano gratuito já resolve o grosso:

1. DNS do domínio na Cloudflare com proxy ativado (nuvem laranja).
2. Ataques volumétricos são absorvidos pela rede deles antes de chegar no servidor.
3. **Under Attack Mode**: botão de pânico que impõe challenge JS a todo visitante.
4. WAF gratuito corta padrões conhecidos (SQLi, bots ruins).

Duas obrigações ao usar:

**a) Esconder o IP de origem.** Se o atacante descobre o IP do servidor, ataca direto e a Cloudflare vira enfeite. Bloqueie 443/80 para todo mundo exceto os ranges da Cloudflare:

```bash
# Ranges oficiais: https://www.cloudflare.com/ips/
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  sudo ufw allow proto tcp from $ip to any port 443,80
done
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
```

**b) Restaurar o IP real do cliente** (senão rate limit do nginx e da app punem os IPs da Cloudflare). Em `/etc/nginx/conf.d/cloudflare-realip.conf`:

```nginx
# um set_real_ip_from por range de https://www.cloudflare.com/ips/
set_real_ip_from 173.245.48.0/20;
# ... demais ranges ...
real_ip_header CF-Connecting-IP;
```

> Sem Cloudflare? O restante do arquivo continua valendo e segura flood L7 de tamanho pequeno/médio. Só assuma o risco volumétrico conscientemente.

## 2. nginx: rate limit e limite de conexões (1ª linha L7)

Rejeitar no nginx custa microssegundos; deixar chegar na app custa event loop, e no login custa `bcrypt` (~250ms de CPU **por tentativa** — o endpoint mais caro da API é justamente o mais atacado).

`/etc/nginx/conf.d/ratelimit.conf`:

```nginx
# Zonas (10m ≈ 160 mil IPs rastreados)
limit_req_zone  $binary_remote_addr zone=api:10m    rate=20r/s;
limit_req_zone  $binary_remote_addr zone=login:10m  rate=1r/s;
limit_conn_zone $binary_remote_addr zone=perip:10m;

limit_req_status  429;
limit_conn_status 429;
```

No server block da API (ver [004](004-nginx-proxy-tls.md)):

```nginx
    location /api/auth/login {
        limit_req zone=login burst=5 nodelay;
        limit_conn perip 5;
        proxy_pass http://base_node;
        # ... mesmos proxy_set_header do location /api/ ...
    }

    location /api/ {
        # burst absorve rajada legítima (página que faz 10 fetches); nodelay não segura fila
        limit_req zone=api burst=40 nodelay;
        limit_conn perip 20;
        proxy_pass http://base_node;
        # ...
    }
```

Calibragem: `20r/s` por IP é folgado para API de frontend; meça o tráfego real e aperte. **Log de 429 no access log é o termômetro** — muitos 429 de IPs distintos = ataque distribuído; de um IP só = bot/cliente com bug.

## 3. fail2ban: banir quem insiste

Rate limit atrasa; fail2ban **remove** o IP do jogo no firewall. Jails para os logs do nginx em `/etc/fail2ban/jail.local` (base em [002](002-hardening-ubuntu.md)):

```ini
# Quem estoura o limit_req repetidamente
[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log
findtime = 10m
maxretry = 30
bantime  = 1h

# Scanners procurando /wp-admin, /.env, /phpmyadmin etc.
[nginx-botsearch]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/api-access.log
findtime = 10m
maxretry = 10
bantime  = 6h
```

```bash
sudo systemctl restart fail2ban
sudo fail2ban-client status nginx-limit-req
```

> Com Cloudflare na frente, banir IP no UFW não adianta (o IP que chega é da CF). Use a action `cloudflare` do fail2ban (bane via API da CF) ou confie no rate limit + WAF da borda.

## 4. Slowloris e clientes lentos

Slowloris abre centenas de conexões e envia bytes a conta-gotas para esgotar os slots do servidor. Defesas (já incluídas em [004](004-nginx-proxy-tls.md)):

- `client_header_timeout 10s` / `client_body_timeout 10s` — quem não termina a requisição em 10s cai.
- `limit_conn perip 20` — um IP não monopoliza conexões.
- nginx em si é resistente (arquitetura event-driven) — **por isso a app nunca fica exposta direto**: o Node atrás do proxy só recebe requisições completas.

## 5. SYN flood (L4)

Coberto pelo sysctl de [002](002-hardening-ubuntu.md): `tcp_syncookies=1`, `tcp_max_syn_backlog=4096`, `somaxconn=4096`. Ataques L4 maiores que isso já são volumétricos → §1.

## 6. O que a aplicação já faz (última camada)

Já embutido na base — só precisa estar **configurado** ([003](003-aplicacao-producao.md)):

| Proteção | Onde | Contra o quê |
| --- | --- | --- |
| `globalRateLimiter` (300 req/min/IP) | `rateLimit.middleware.ts` | Flood que passou do nginx |
| `loginRateLimiter` (5 falhas/min/IP) | `POST /auth/login` | Brute-force de senha (só falhas contam) |
| `express.json({ limit: "1mb" })` | loaders | DoS de memória via payload gigante |
| `statement_timeout 10s` / `lock_timeout 3s` | pool pg | Query lenta/travada segurando conexão |
| Pool com `max` fixo + watchdog Discord | `src/db/` | Saturação do banco vira alerta, não mistério |
| Fail-closed no boot | `validateSecurityConfig()` | Deploy com auth desligada |
| Zod `.strict()` + `.max()` em toda string | schemas | Payload malformado/gigante por campo |
| SQL 100% parametrizado (`$1`) | camada Database | SQL injection |
| `helmet` + cookie httpOnly + CORS por env | loaders | XSS, clickjacking, leitura de token |

Rate limit da app é **por processo** (MemoryStore). Com múltiplas instâncias o limite efetivo multiplica — nessa configuração o limite global fica por conta do nginx, ou troque para store compartilhado (Redis). Ver [006](006-escalabilidade-operacao.md).

## 7. Requisições que não partem do seu frontend

Pergunta comum: *"como bloquear requisições feitas de fora do meu site (curl, Postman, script de terceiro)?"* Resposta honesta em três partes:

**O que o CORS faz:** `CORS_ORIGINS` restrito ao seu domínio impede que **outro site** no navegador da vítima leia respostas da sua API ou envie requisições autenticadas com o cookie dela (junto com `sameSite=lax`, que a base já usa). Isso mata CSRF e roubo de dados cross-site. **Configure sempre.**

**O que o CORS não faz:** não impede `curl`, Postman, bots ou backend de terceiro — CORS é aplicado **pelo navegador**, e quem não é navegador ignora. Cabeçalhos `Origin`/`Referer` são forjáveis com uma linha; bloquear por eles só filtra script preguiçoso, nunca trate como segurança.

**O que realmente protege API pública:**

1. **Autenticação em tudo que importa** — nesta base, `AUTHORIZATION=1` + JWT em rotas protegidas. Sem token válido, requisição externa recebe 401 e custou quase nada.
2. **Rate limit em camadas** (§2 e §6) — anônimo sem token não consegue nem enumerar.
3. **WAF/bot management da borda** (§1) — challenge JS derruba a maioria dos scripts.
4. **Não expor o que não precisa ser público** — `default_server 444` ([004](004-nginx-proxy-tls.md)) + Swagger off em produção + rotas só sob `/api/`.
5. Serviço-a-serviço: JWT de serviço (a base já tem `POST /auth/create-jwt`) ou, entre servidores seus, mTLS/allowlist de IP no nginx.

Aceite o modelo: **endpoint público é chamável por qualquer software**. Segurança vem de autenticação + limites + custo por requisição baixo, não de tentar adivinhar quem é o cliente.

## 8. Durante um ataque — diagnóstico rápido

```bash
# Top IPs no access log (últimas 50k linhas)
tail -50000 /var/log/nginx/api-access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head

# Top rotas atacadas
tail -50000 /var/log/nginx/api-access.log | awk '{print $7}' | sort | uniq -c | sort -rn | head

# Conexões por estado (SYN_RECV alto = SYN flood; ESTABLISHED gigante = flood L7)
ss -s ; ss -tan | awk '{print $1}' | sort | uniq -c

# Saúde da app e do pool
curl -s localhost:3000/api/system/health
curl -s localhost:3000/api/system/metrics
```

Ações de emergência, em ordem:

1. Cloudflare **Under Attack Mode** (se tem CF).
2. Apertar rate limit do nginx (ex.: `rate=5r/s`) e `reload` — não derruba conexões boas.
3. Banir rede agressora inteira: `sudo ufw insert 1 deny from x.x.x.0/24`.
4. Se o banco saturou: watchdog já alertou no Discord; `metrics` mostra `waitingCount` — reduza `limit_conn`/`rate` até normalizar.

---

**Próximo:** [006 — Escalabilidade e operação](006-escalabilidade-operacao.md)
