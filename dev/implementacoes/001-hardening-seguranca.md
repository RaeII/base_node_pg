# 001 — Hardening de Segurança

Resumo de estudo das implementações de segurança aplicadas na base. Cada seção: **o que era**, **o que virou**, **por quê**.

Doc canônica correspondente: [`doc/arquitetura/seguranca.md`](../../doc/arquitetura/seguranca.md).

---

## 1. Boot fail-closed

**Antes:** só validava `JWT_SECRET` existir. `AUTHORIZATION` ausente/errado em produção = auth desligada silenciosamente.

**Depois:** `validateSecurityConfig()` em `src/shared/loaders/index.ts`, chamada antes de qualquer coisa em `initializePreRouteLoaders`:

```typescript
if (env.isProduction) {
  if (env.AUTHORIZATION !== 1) {
    throw new Error("Produção exige AUTHORIZATION=1...");
  }
}
```

- `JWT_SECRET` < 32 chars → `throw` em produção, `warn` em dev.
- Produção sem `DB_SSL` ou `CORS_ORIGINS` → `warn` (não bloqueia, mas avisa).

**Efeito colateral corrigido:** `startServer()` não tinha `.catch()`. Uma rejeição no boot (como esse `throw`) ia parar silenciosamente no `unhandledRejection` handler (só loga, processo fica vivo sem `listen`). Corrigido em `src/index.ts`:

```typescript
startServer().catch((err) => {
	console.error("Fatal boot error:", err instanceof Error ? err.message : err);
	process.exit(1);
});
```

**Por quê:** deploy com env incompleta é o cenário mais comum de "auth acidentalmente desligada em produção". Fail-closed transforma isso de vulnerabilidade silenciosa em crash imediato e visível.

---

## 2. Rate limiting

**Antes:** nenhum. Login aceitava tentativas ilimitadas (brute-force) e cada tentativa custava um `bcrypt.compare` (~250ms de CPU) — vetor de DoS barato.

**Depois:** novo arquivo `src/shared/middlewares/rateLimit.middleware.ts` com `express-rate-limit`:

```typescript
export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,  // default 60s
  limit: env.RATE_LIMIT_MAX,            // default 300/IP
});

export const loginRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_LOGIN_WINDOW_MS,
  limit: env.RATE_LIMIT_LOGIN_MAX,      // default 5/IP
  skipSuccessfulRequests: true,          // só falhas contam
});
```

- `globalRateLimiter` aplicado em `loaders/express.ts` (toda a API).
- `loginRateLimiter` aplicado só em `POST /auth/login` via `@Middleware(loginRateLimiter)`.
- `trust proxy` (`TRUST_PROXY` env) — necessário atrás de nginx/traefik, senão `req.ip` vê o IP do proxy pra todo mundo e o rate limit vira global-por-servidor em vez de por-cliente.

**Testado:** 6 tentativas de login seguidas → `401 401 401 429 429 429`.

---

## 3. Security headers (`helmet`)

**Antes:** nenhum header de segurança. `X-Powered-By: Express` exposto (facilita fingerprinting).

**Depois:** `app.use(helmet())` em `loaders/express.ts` + `app.disable("x-powered-by")`. Adiciona CSP, HSTS, `X-Frame-Options`, `nosniff`, etc. — tudo com defaults sãos do pacote, sem configuração custom.

**Body limit:** `json({ limit: '10mb' })` → `json({ limit: '1mb' })`. 10mb era alto demais pra uma API que só recebe JSON de formulário — payload grande é vetor de DoS de memória.

---

## 4. Cookie de autenticação e CORS

**Antes:**
```typescript
res.cookie("token_access", token, {
  sameSite: env.isProduction ? "none" : "lax",
  domain: env.isProduction ? ".example.com" : "localhost",  // placeholder esquecido
});
// CORS: origin fixo "http://localhost:3000"
```

**Problema:** `sameSite: "none"` em produção permite que qualquer site dispare requests autenticadas cross-site (CSRF) — o cookie é enviado de qualquer origem. `domain: ".example.com"` é um placeholder que quebraria o cookie em produção real (nunca teria sido trocado sem alguém notar em código).

**Depois:** `authCookieOptions()` centralizado em `auth.controller.ts`:
```typescript
function authCookieOptions(maxAgeSeconds?: number): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.COOKIE_SAMESITE,       // default "lax"
    ...(env.COOKIE_DOMAIN && { domain: env.COOKIE_DOMAIN }),  // vazio = host-only
  };
}
```
CORS: `origin` resolvido de `CORS_ORIGINS` (lista por vírgula); produção sem a env = `false` (nenhuma origem cross-site aceita) em vez de aceitar tudo por acidente.

**Por quê `lax` em vez de `none`:** `lax` bloqueia o envio do cookie em requests cross-site (POST vindo de outro domínio), que é a defesa básica contra CSRF. Só se justifica `none` se o front realmente mora em outro domínio — e aí precisa de defesa CSRF própria (token double-submit), documentado no aviso da doc.

---

## 5. JWT — verificação restrita + claim `type`

**Antes:**
```typescript
const decoded = jwt.verify(token, jwtSecret);  // sem restrição de algoritmo/issuer
const payload = { sub, userId, username, email, admin };
```

**Problema 1:** `jwt.verify` sem `algorithms` fixo aceita qualquer algoritmo presente no header do token — abre espaço pra ataques de confusão de algoritmo em bibliotecas mal configuradas.

**Problema 2:** o token de serviço (`POST /auth/create-jwt`) e o token de usuário eram indistinguíveis — o payload de serviço era só `{ name }`, mas como o `validJWTNeeded` só checa assinatura, esse token passava em qualquer rota que exigisse "só JWT válido" (sem `adminOnly`).

**Depois:**
```typescript
jwt.verify(token, jwtSecret, { algorithms: ["HS256"], issuer: env.APP_NAME });
// payload de usuário: { sub, userId, username, email, admin, type: "user" }
// payload de serviço: { name, type: "service" }  — SEM claim admin
```

`adminMiddleware` mudou de aceitar `admin` frouxo (`"true"`, `"1"`, `"admin"`, `"yes"`, `1`) para `admin === true` estrito — como o claim é assinado pela própria app, não precisa de parsing tolerante; isso só existia como superfície de erro.

**TTL:** era fixo 30 dias pro login. Virou `JWT_EXPIRES_IN_SECONDS` (default 7 dias) — sem mecanismo de revogação, token de 30 dias significa que desativar um usuário não tem efeito real por até 1 mês.

**Nova rota:** `POST /auth/logout` — `res.clearCookie()` com os mesmos atributos do `set` (senão o browser não remove).

---

## 6. Anti-enumeração e anti-timing no login

**Antes:**
```typescript
const row = await this.userDb.findByUsernameOrEmail(identifier);
if (!row) throwUser("Credenciais inválidas", 401);
const ok = row.password ? await bcrypt.compare(password, row.password) : false;
if (!ok) throwUser("Credenciais inválidas", 401);
if (!row.is_active) throwUser("Usuário não encontrado", 403);
```

**Dois vazamentos:**
1. **Timing:** usuário inexistente retorna sem rodar `bcrypt.compare` (rápido); usuário existente roda (lento, ~250ms). Um atacante mede o tempo de resposta e descobre quais usernames existem.
2. **Status code:** usuário inativo → `403 "Usuário não encontrado"`; senha errada → `401 "Credenciais inválidas"`. Duas respostas diferentes revelam se a conta existe.

**Depois** (`user.service.ts`):
```typescript
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("__timing_equalizer__", SALT_ROUNDS);
// ...
const row = await this.userDb.findByUsernameOrEmail(identifier);
const ok = await bcrypt.compare(password, row?.password || DUMMY_PASSWORD_HASH);
if (!row || !ok || !row.is_active) {
  throwUser("Credenciais inválidas", 401);
}
```
Sempre roda um `bcrypt.compare` (mesmo custo), sempre mesma mensagem e status para os três casos (inexistente / senha errada / inativo).

---

## 7. Validação de path params (`:id`)

**Antes:** `const id = Number(req.params.id)`. Chamar `/api/user/abc` gera `NaN`, que chega cru na query SQL, o driver PG rejeita, vira exceção não tratada → `500` + **alerta no Discord** (ver item 9 sobre throttle).

**Depois:** novo `idParamsSchema` em `user.schema.ts`:
```typescript
export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
```
Usado nos 3 controllers (`findById`, `update`, `delete`):
```typescript
const { id } = parseSchema(idParamsSchema, req.params);
```
`/api/user/abc` agora responde `400 "Dados inválidos"` em vez de `500`.

---

## 8. Projeção explícita de colunas (sem `SELECT *`)

**Antes:** todo `SELECT * FROM "user"` — a linha completa, **incluindo o hash de senha**, subia pra camada Service em toda leitura (list, findById, findByUsername, etc.). A defesa contra vazar a senha era só o `toPublicUser()` no topo, uma única camada de proteção.

**Depois** (`user.database.ts`):
```typescript
const USER_COLUMNS = `id, username, email, is_active, is_admin, last_login_at, created_at, updated_at`;
// findById, findByUsername, findByEmail, findAll → usam USER_COLUMNS (sem password)
// findByUsernameOrEmail → único método que inclui `password`, tipado como DbUserAuthRow
```
Novo tipo `DbUserAuthRow = DbUserRow & { password: string }` deixa explícito no type system qual método é "perigoso" (só usado no `authenticate()`).

**Por quê:** defense-in-depth — mesmo que uma camada futura esqueça de filtrar, o hash simplesmente não está no objeto.

---

## 9. Tratamento de erro — corrida de UNIQUE e throttle de alertas

**Problema 1 — corrida de unicidade:** `createUser`/`updateUser` fazem "check se já existe" → depois `INSERT`/`UPDATE`. Sob concorrência, dois requests podem passar no check ao mesmo tempo; quem garante unicidade de fato é a constraint `UNIQUE` do banco, que rejeita o segundo com erro `23505`. Antes, isso virava `500` genérico + alerta Discord (era tratado como bug, mas é esperado em alta concorrência).

**Depois** (`error.ts`, no topo de `handleError`):
```typescript
if ((error as any)?.code === "23505") {
  return res.status(409).json({ message: "Registro duplicado — valor já está em uso" });
}
```

**Problema 2 — flood de Discord:** `logAndNotify` disparava o webhook a cada erro, sem limite. Um atacante gerando erros repetidos (ex.: `/api/user/abc` mil vezes antes do fix do item 7) ou um bug em loop flooda o canal.

**Depois:** throttle por mensagem — a mesma string de erro só notifica 1x por minuto:
```typescript
const DISCORD_ALERT_COOLDOWN_MS = 60_000;
function shouldNotifyDiscord(message: string): boolean { /* Map<message, timestamp> */ }
```
O log em arquivo (Winston) continua registrando **todas** as ocorrências — só o Discord é throttled.

---

## 10. Handler final de erro do Express estava quebrado

**Antes** (`loaders/express.ts`):
```typescript
app.use(((err, req, res, next) => { ... }) as ErrorRequestHandler);  // 4 params, ok
app.use(((err, req, res) => {  // <- SÓ 3 PARÂMETROS
  res.status(err.status || 500);
  res.json({ errors: { message: err.message } });  // sempre vaza err.message
}) as ErrorRequestHandler);
```
Express identifica error handlers pela **aridade da função** (deve ter exatamente 4 parâmetros: `err, req, res, next`). O segundo handler tinha 3 — o `as ErrorRequestHandler` enganava o TypeScript, mas em runtime o Express nunca o reconheceria como error handler corretamente, e ele vazava `err.message` cru pro cliente sem logar nada.

**Depois:** um único handler final, com 4 parâmetros de verdade:
```typescript
const finalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err?.status || err?.statusCode || 500;
  if (status >= 500) logger.error("Unhandled error", { path: req.path, method: req.method, message: err?.message });
  const message = status >= 500 && env.isProduction ? "Ocorreu um erro interno" : err?.message;
  res.status(status).json({ message });
};
```

---

## 11. `/api/system/health` vazava erro do driver

**Antes:** quando o banco cai, `detail.error` retornava a mensagem crua da lib `pg` — pode incluir host, porta, nome de usuário do banco.

**Depois** (`db/health.ts`): loga a mensagem completa no Winston, responde ao cliente só `{ "error": "database unreachable" }`.

---

## 12. Infra — Docker, dependências

- **Dockerfile:** container rodava como `root` (comportamento default da imagem base). Adicionado `USER bun` após o build — se alguém escapar da app via RCE, não tem privilégio de root no container.
- **`bun audit`** apontou `form-data <4.0.6` (CVE high, CRLF injection) via dependência transitiva do `axios`. `axios` atualizado + `"overrides": { "form-data": "^4.0.6" }` no `package.json` pra garantir a versão fixa mesmo que uma dependência futura puxe uma versão antiga de novo.

---

## Variáveis de ambiente novas

Todas com default seguro — nenhuma é obrigatória pra manter o comportamento antigo em dev, mas produção herda os requisitos do item 1.

| Variável | Default | Papel |
| --- | --- | --- |
| `JWT_EXPIRES_IN_SECONDS` | `604800` (7d) | TTL do JWT de usuário |
| `SERVICE_JWT_EXPIRES_IN_SECONDS` | `2592000` (30d) | TTL do JWT de serviço |
| `CORS_ORIGINS` | vazio | Origens CORS, separadas por vírgula |
| `COOKIE_DOMAIN` | vazio (host-only) | Domain do cookie |
| `COOKIE_SAMESITE` | `lax` | `lax` \| `strict` \| `none` |
| `TRUST_PROXY` | `0` | Nº de proxies confiáveis à frente da app |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `300` | Limite global por IP |
| `RATE_LIMIT_LOGIN_WINDOW_MS` / `RATE_LIMIT_LOGIN_MAX` | `60000` / `5` | Limite do login (só falhas) |

---

## Pra estudar em ordem

1. `src/shared/loaders/index.ts` — `validateSecurityConfig()` (o fail-closed).
2. `src/shared/middlewares/rateLimit.middleware.ts` — como o `express-rate-limit` é configurado.
3. `src/modules/auth/auth.controller.ts` — `authCookieOptions()`, claims `type`, `create-jwt` validado.
4. `src/modules/user/user.service.ts` — `DUMMY_PASSWORD_HASH` e a lógica anti-enumeração.
5. `src/modules/user/user.database.ts` — `USER_COLUMNS` e por que só um método retorna `password`.
6. `src/shared/utils/error.ts` — `23505` → `409` e `shouldNotifyDiscord`.
7. `doc/arquitetura/seguranca.md` — página de referência com o checklist pra módulos novos.

## Relacionado

- [[../../doc/arquitetura/seguranca.md|Segurança (doc canônica)]]
- [[../../doc/guias/novo-modulo.md|Criar Novo Módulo]] — checklist de segurança pra módulos futuros
