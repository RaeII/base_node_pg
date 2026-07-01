import type { Response } from "express";
import { z } from "zod";
import sendDiscord from "@/shared/utils/sendDiscord";
import logger from "@/shared/utils/logger";
import { env } from "@/config";

// ─── AppError ────────────────────────────────────────────────────

interface AppErrorIssue {
  path: string;
  message: string;
}

/**
 * Erro centralizado da aplicação.
 *
 * - `isUserError = true`  → mensagem destinada ao usuário final (validação, regra de negócio).
 *   Não gera log nem notificação no Discord.
 * - `isUserError = false` → erro interno (bug, infra). Gera log + Discord.
 *   Usuário recebe mensagem genérica.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly isUserError: boolean;
  readonly issues?: AppErrorIssue[];

  constructor(
    message: string,
    statusCode: number,
    isUserError: boolean,
    issues?: AppErrorIssue[]
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.isUserError = isUserError;
    this.issues = issues;
  }
}

// ─── Funções de lançamento ───────────────────────────────────────

/**
 * Lança um erro destinado ao **usuário** (validação, regra de negócio).
 * A mensagem será exibida diretamente ao usuário.
 * **Não** gera log nem envia para o Discord.
 */
export function throwUser(
  message: string,
  statusCode = 400,
  issues?: AppErrorIssue[]
): never {
  throw new AppError(message, statusCode, true, issues);
}

/**
 * Lança um erro **interno** (bug, falha de infra).
 * Gera log no console e envia notificação ao Discord.
 * Usuário recebe uma mensagem genérica.
 */
export function throwInternal(message: string, statusCode = 500): never {
  throw new AppError(message, statusCode, false);
}

// ─── Parse de Schema Zod ─────────────────────────────────────────

/**
 * Valida `data` contra um `ZodSchema`.
 * Se inválido, lança `AppError` com `isUserError = true` e issues formatados.
 * Retorna os dados tipados em caso de sucesso.
 */
export function parseSchema<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const issues: AppErrorIssue[] = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new AppError("Dados inválidos", 400, true, issues);
  }

  return result.data;
}

// ─── Handler centralizado ────────────────────────────────────────

const GENERIC_MESSAGE = "Ocorreu um erro interno";

/**
 * Trata qualquer erro e envia a resposta HTTP adequada.
 *
 * - **AppError (isUserError)**: responde com a mensagem real + issues (se houver).
 * - **AppError (interno)** ou **Error genérico**: loga, envia pro Discord,
 *   responde com mensagem genérica.
 */
export function handleError(error: unknown, res: Response): Response {

  // ── Violação de UNIQUE do PostgreSQL (23505) ──
  // Corrida entre o check de unicidade e o INSERT/UPDATE: a constraint segura,
  // e aqui vira 409 para o cliente em vez de 500 + alerta.
  if ((error as any)?.code === "23505") {
    return res.status(409).json({
      message: "Registro duplicado — valor já está em uso",
    });
  }

  // ── AppError conhecido ──
  if (error instanceof AppError) {
    if (error.isUserError) {
      return res.status(error.statusCode).json({
        message: error.message,
        ...(error.issues && { issues: error.issues }),
      });
    }

    // Erro interno — loga + Discord
    logAndNotify(error.message, error);

    return res.status(error.statusCode).json({
      message: GENERIC_MESSAGE,
    });
  }

  // ── Erro inesperado (não é AppError) ──
  logAndNotify(
    error instanceof Error ? error.message : String(error),
    error
  );

  return res.status(500).json({
    message: GENERIC_MESSAGE,
  });
}

// ─── Helpers internos ────────────────────────────────────────────

// Throttle de alertas Discord: a MESMA mensagem só alerta 1x por janela.
// Sem isso, um atacante que force erros repetidos (ou um bug em loop) flooda
// o canal. O log em arquivo continua registrando TODAS as ocorrências.
const DISCORD_ALERT_COOLDOWN_MS = 60_000;
const MAX_TRACKED_MESSAGES = 500;
const lastAlertAt = new Map<string, number>();

function shouldNotifyDiscord(message: string): boolean {
  const now = Date.now();
  const last = lastAlertAt.get(message) ?? 0;
  if (now - last < DISCORD_ALERT_COOLDOWN_MS) return false;

  // Evita crescimento sem limite do Map em cenário de mensagens únicas
  if (lastAlertAt.size >= MAX_TRACKED_MESSAGES) lastAlertAt.clear();
  lastAlertAt.set(message, now);
  return true;
}

function logAndNotify(message: string, error: unknown): void {
  const meta: Record<string, unknown> = {};

  if (error instanceof Error) {
    // Em dev mostra stack no console; em prod só vai pro arquivo
    if (!env.isProduction) meta.stack = error.stack;
  } else {
    meta.raw = String(error);
  }

  logger.error(message, meta);

  if (!shouldNotifyDiscord(message)) return;

  // Fire-and-forget — não bloqueia a resposta
  sendDiscord
    .sendErrorAlert(message, error)
    .catch((discordErr) => {
      logger.warn("Falha ao notificar Discord", {
        error: discordErr instanceof Error ? discordErr.message : String(discordErr),
      });
    });
}

