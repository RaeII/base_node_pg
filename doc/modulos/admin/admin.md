---
title: Módulo Admin
tags:
  - modules
  - admin
  - security
---

# Módulo Admin

Área administrativa: painel, informações do sistema e trilha de auditoria. O admin **é um usuário** (`"user".is_admin = TRUE`) — usa o sistema principal normalmente — mas a área admin exige uma **sessão admin elevada**, aberta por um login próprio.

**Pasta:** [`src/modules/admin/`](../../../src/modules/admin/) — `admin.controller.ts` (rotas `/api/admin`), `admin.service.ts` (painel, sistema, auditoria), `admin.database.ts` (tabela `audit_log` + agregados) + `schema/admin.schema.ts`. Migration `0003_admin.sql`.

> [!note] Login e gestão de usuários ficam nos módulos de origem
> O login admin (`POST /api/auth/admin/login`) vive no [[auth|Módulo Auth]], que é dono dos cookies. O CRUD de usuários é o do [[usuarios|Módulo Usuários]] (`/api/user`), protegido pelo mesmo `adminOnly`.

---

## Modelo de acesso (step-up)

Padrão recomendado para acesso privilegiado (OWASP Session Management): reautenticação, sessão nova na troca de privilégio, timeout curto e autorização checada no servidor a cada request.

1. **Login próprio:** `POST /api/auth/admin/login` pede a senha de novo, mesmo para quem já está logado. Não-admin recebe o **mesmo `401 "Credenciais inválidas"`** de senha errada (não revela quem é admin). Rate limit compartilhado com `/auth/login`.
2. **Sessão nova (anti session fixation):** revoga a sessão anterior do navegador (cookie de refresh) e abre outra em `auth_session` com `admin_expires_at` preenchido. A mesma sessão vale para o sistema principal.
3. **Timeout de inatividade + teto absoluto:** a elevação expira após `ADMIN_SESSION_IDLE_SECONDS` sem uso (default **15 min**, deslizante) e nunca passa de `ADMIN_SESSION_MAX_SECONDS` desde o login admin (default **8 h**). Depois disso a sessão continua como **usuário comum**: só a área admin pede novo login.
4. **Validação no banco a cada request** (`adminMiddleware.adminOnly`, ver [[middlewares-auth]]): sessão viva, elevação no prazo e usuário **ainda** ativo e admin, numa única query que também desliza o prazo. Rebaixar, desativar, trocar a senha ou encerrar as sessões corta o acesso **na hora**, sem esperar o access token (15 min) expirar.
5. **Auditoria:** login admin e toda mutação administrativa gravam em `audit_log`, na mesma transação da ação.

> [!important] O JWT não carrega permissão de admin
> O access token tem `sid` (id da sessão), não `admin`. Permissão admin vem sempre do banco — claim de token ficaria velho até o token expirar.

**Autoproteção:** o admin não pode remover o próprio `is_admin`, se desativar (`is_active: false` ou `DELETE`) — evita lockout.

---

## Endpoints

Todas exigem `jwtMiddleware` + `adminMiddleware.adminOnly` (sessão admin elevada). Sem elevação → **`403`** (o front manda para o login admin); access vencido → `401` (o front renova e repete).

### GET `/api/admin/me`

Admin da sessão elevada: `{ "data": PublicUser }`. O front chama ao entrar na área admin. Responde `403` mesmo com `AUTHORIZATION=0` se não houver elevação.

### GET `/api/admin/stats`

Números do painel em uma ida ao banco:

```json
{ "data": {
  "totalUsers": 3, "activeUsers": 2, "inactiveUsers": 1, "admins": 1,
  "newUsersLast7Days": 3, "loginsLast24h": 2,
  "activeSessions": 2, "adminSessions": 1
} }
```

### GET `/api/admin/system`

`{ "data": { health, runtime, database, security } }`:

| Bloco | Conteúdo |
| --- | --- |
| `health` | Mesmo `healthCheck()` de [[sistema]] (`ok`/`degraded`/`down` + pools) |
| `runtime` | `environment`, versão do Node, `uptimeSeconds`, memória (`rss`, heap) |
| `database` | Versão do PostgreSQL, tamanho do banco, conexões abertas — `null` se o banco está `down` |
| `security` | Configuração **efetiva** e não sensível: `AUTHORIZATION`, TTLs (access, refresh, serviço, sessão admin), rate limits, origens CORS, `sameSite`/`secure` do cookie, `TRUST_PROXY` |

> [!warning] Nunca exponha segredos aqui
> `JWT_SECRET`, credenciais do banco e `DISCORD_WEBHOOK` ficam fora por construção — o service monta o objeto campo a campo. Mantenha assim ao estender.

### GET `/api/admin/audit`

Trilha de auditoria paginada ([[paginacao]] — `?page=&limit=`, máx 100), mais recentes primeiro:

```json
{ "data": [ {
  "id": 13, "action": "user.update",
  "actor_id": 1, "actor_username": "root",
  "target_user_id": 2, "target_username": "maria",
  "detail": { "fields": ["is_admin"] }, "ip": "::1",
  "created_at": "2026-10-21T18:59:32.642Z"
} ], "pagination": { … } }
```

---

## Auditoria

| Ação | Quando | `detail` |
| --- | --- | --- |
| `admin.login` | Login admin com sucesso | — |
| `user.create` | `POST /api/user` | `is_admin`, `is_active` |
| `user.update` | `PUT /api/user/:id` | `fields` — só os **nomes** dos campos alterados |
| `user.deactivate` | `DELETE /api/user/:id` | — |
| `user.revoke_sessions` | `POST /api/user/:id/revoke-sessions` | — |
| `service_token.create` | `POST /api/auth/create-jwt` | `name` |

- Grave com `AdminService.audit({ ...auditActor(req, res), action, targetUserId, detail })` **dentro** do `withTransaction` da ação — os dois commitam juntos. `auditActor` (em `admin.middleware.ts`) devolve o admin validado (`res.locals.adminId`) e o IP.
- `detail` **nunca** recebe senha, hash ou token.
- Ação nova → adicione ao tipo `AuditAction` em `admin.schema.ts` e à tabela acima.
- Falhas de login seguem só no Winston (`Admin login failed`), não na tabela.

---

## Relacionado

- [[seguranca|Segurança]] — modelo de sessão, JWT, checklist
- [[auth|Módulo Auth]] — `POST /auth/admin/login`, `sid` no access token
- [[middlewares-auth|Middlewares de Autenticação]] — `adminOnly`
- [[usuarios|Módulo Usuários]] — CRUD usado pela área admin
- [[sistema|Módulo Sistema]] — `healthCheck`, métricas públicas
