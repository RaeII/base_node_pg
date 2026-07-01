# 004 — nginx: Proxy Reverso e TLS

A aplicação **nunca** fica exposta direto na internet. O nginx na frente resolve: TLS, corte de requisições lixo antes de gastarem CPU do Node, rate limit barato (ver [005](005-protecao-ddos-e-abuso.md)), keep-alive eficiente e ponto único para servir múltiplas apps/instâncias.

---

## 1. Instalação

```bash
sudo apt install nginx
```

`/etc/nginx/nginx.conf` — ajustes no bloco `http` (mantém o resto do default):

```nginx
# fora do bloco http, no topo:
worker_rlimit_nofile 65536;

http {
    # Não anuncia versão do nginx (fingerprinting)
    server_tokens off;

    # Timeouts curtos derrubam clientes lentos de propósito (Slowloris — ver 005)
    client_header_timeout 10s;
    client_body_timeout   10s;
    send_timeout          10s;
    keepalive_timeout     65s;

    # Casa com o limite de 1mb do express.json() — corta upload grande ANTES de chegar na app
    client_max_body_size 1m;
}
```

## 2. Bloqueio de acesso direto por IP / Host desconhecido

Scanners varrem IPs da internet inteira testando `http://<ip>/` — sem passar pelo seu domínio. Este bloco `default_server` derruba qualquer requisição cujo `Host` não seja o seu domínio, **sem resposta** (código 444 = fecha a conexão):

`/etc/nginx/sites-available/000-default-drop`:

```nginx
# Pega tudo que não bate com um server_name conhecido
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    # Recusa o handshake TLS sem nem precisar de certificado (nginx ≥ 1.19.4)
    ssl_reject_handshake on;
}
```

Efeito: só requisições endereçadas a `api.exemplo.com` chegam ao bloco da aplicação. Acesso por IP, por domínio apontado de terceiros ou scanner genérico morre aqui com custo quase zero.

## 3. Server block da aplicação

`/etc/nginx/sites-available/api.exemplo.com`:

```nginx
# Keep-alive entre nginx e app: reaproveita conexões, reduz latência
upstream base_node {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name api.exemplo.com;
    # HTTP só existe para redirecionar (certbot gerencia o challenge sozinho)
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.exemplo.com;

    # --- TLS (certbot preenche/gerencia estas linhas) ---
    ssl_certificate     /etc/letsencrypt/live/api.exemplo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.exemplo.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # HSTS: navegador nunca mais tenta HTTP (helmet também envia; aqui cobre
    # qualquer resposta que não passe pela app, como erros do próprio nginx)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Access log com timing — essencial para investigar ataque/lentidão (ver 005)
    log_format api_timing '$remote_addr [$time_local] "$request" $status '
                          '$body_bytes_sent rt=$request_time urt=$upstream_response_time';
    access_log /var/log/nginx/api-access.log api_timing;

    location /api/ {
        proxy_pass http://base_node;

        # IP real do cliente → app usa no rate limit (exige TRUST_PROXY=1 no .env)
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host $host;

        # Keep-alive com o upstream
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        # Timeouts: requisição legítima desta API não passa de segundos
        # (statement_timeout do banco é 10s — 30s aqui dá folga sem segurar conexão morta)
        proxy_connect_timeout 5s;
        proxy_send_timeout    30s;
        proxy_read_timeout    30s;
    }

    # Tudo fora de /api/ não existe neste servidor
    location / {
        return 444;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/000-default-drop /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/api.exemplo.com /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 4. TLS com Let's Encrypt (certbot)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.exemplo.com
sudo certbot renew --dry-run    # renovação automática já fica agendada (systemd timer)
```

Verifique a nota do TLS em https://www.ssllabs.com/ssltest/ — alvo: A ou A+.

## 5. Pontos que amarram com a aplicação

| nginx | Aplicação | Por quê |
| --- | --- | --- |
| `proxy_set_header X-Forwarded-For` | `TRUST_PROXY=1` no `.env` | Sem os dois, `req.ip` = IP do nginx e o rate limit por IP pune todo mundo junto |
| `client_max_body_size 1m` | `express.json({ limit: "1mb" })` | Mesmo limite nas duas camadas; nginx corta de graça antes de gastar Node |
| `proxy_read_timeout 30s` | `DB_STATEMENT_TIMEOUT_MS=10000` | Query nunca passa de 10s → 30s no proxy nunca corta requisição legítima |
| `return 444` fora de `/api/` | Rotas todas sob `/api` | Swagger já desligado em produção; o resto não existe para a internet |
| HSTS no nginx | helmet (HSTS também) | Redundância barata; helmet não cobre respostas geradas pelo próprio nginx |

---

**Próximo:** [005 — Proteção contra DDoS e abuso](005-protecao-ddos-e-abuso.md)
