# 001 — Visão Geral: Produção em Servidor Ubuntu

Guia de deploy e operação desta base (**TypeScript + Express 5 + PostgreSQL, runtime Bun**) em servidores **Ubuntu** (22.04/24.04 LTS). Cobre segurança do sistema, configuração da aplicação, proxy reverso, proteção contra DDoS/abuso e escalabilidade.

> Doc canônica da aplicação: [`doc/index-doc.md`](../../../doc/index-doc.md). Este diretório documenta **o servidor em volta da aplicação**.

---

## Topologia recomendada

```
Internet
   │
   ▼
[Cloudflare]  ← opcional, mas é a única defesa real contra DDoS volumétrico (ver 005)
   │
   ▼
[UFW] ────────── só 80/443 (e SSH) abertos
   │
   ▼
[nginx :443] ─── TLS, rate limit L7, corta requisições sem Host válido (ver 004/005)
   │
   ▼
[App :3000] ──── systemd + Bun, só acessível via localhost (ver 003)
   │
   ▼
[PostgreSQL] ─── localhost ou rede privada, nunca exposto (ver doc/banco-de-dados/postgres.md)
```

**Princípio:** defesa em camadas. Nenhuma camada sozinha segura tudo — cada uma corta uma classe de ataque antes de chegar na de baixo. A aplicação já traz a última camada pronta (helmet, rate limit por IP, limite de body 1mb, timeouts de query, fail-closed no boot).

## Arquivos deste guia

| Arquivo | Conteúdo |
| --- | --- |
| [002-hardening-ubuntu.md](002-hardening-ubuntu.md) | SSH, UFW, fail2ban, atualizações automáticas, sysctl, usuário da aplicação |
| [003-aplicacao-producao.md](003-aplicacao-producao.md) | `.env` de produção, systemd, deploy, permissões, logs |
| [004-nginx-proxy-tls.md](004-nginx-proxy-tls.md) | Proxy reverso, TLS/certbot, bloqueio de acesso direto por IP, timeouts |
| [005-protecao-ddos-e-abuso.md](005-protecao-ddos-e-abuso.md) | DDoS, flood de requisições, brute-force, requisições fora do seu frontend |
| [006-escalabilidade-operacao.md](006-escalabilidade-operacao.md) | Múltiplas instâncias, dimensionamento de pool, monitoramento, backup |

## Checklist mínimo antes de ir pro ar

- [ ] SSH só com chave, root login desabilitado (002)
- [ ] UFW ativo: `deny incoming` por padrão; só SSH, 80 e 443 (002)
- [ ] fail2ban ativo para SSH e nginx (002/005)
- [ ] `.env` de produção completo: `AUTHORIZATION=1`, `JWT_SECRET` ≥ 32 chars, `CORS_ORIGINS`, `TRUST_PROXY=1` (003)
- [ ] App rodando via systemd como usuário sem privilégio, `Restart=always` (003)
- [ ] nginx com TLS válido (certbot) + `default_server` que rejeita Host desconhecido (004)
- [ ] Rate limit no nginx (`limit_req`) além do rate limit da aplicação (005)
- [ ] PostgreSQL escutando só em localhost/rede privada, usuário da app sem DDL (doc do projeto)
- [ ] Backup automático do banco testado — restore incluído (006)
- [ ] Monitor externo de uptime apontando para `/api/system/health` (006)
