import { createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import path from "path";
import { env } from "@/config";

// ─── Diretório de logs ──────────────────────────────────────────
const LOG_DIR = path.resolve(__dirname, "../../../logs");

// ─── Formatos ───────────────────────────────────────────────────

/** Formato estruturado para arquivos (JSON + timestamp + stack) */
const fileFormat = format.combine(
  format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  format.errors({ stack: true }),
  format.json()
);

/** Formato legível para console (colorido + timestamp) */
const consoleFormat = format.combine(
  format.colorize({ all: true }),
  format.timestamp({ format: "HH:mm:ss" }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return stack
      ? `${timestamp} ${level}: ${message}\n${stack}${metaStr}`
      : `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// ─── Transports ─────────────────────────────────────────────────

/** Arquivo apenas para erros — rotação diária, retenção 30d */
const errorFileTransport = new DailyRotateFile({
  filename: path.join(LOG_DIR, "error-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  level: "error",
  maxSize: "20m",
  maxFiles: "30d",
  zippedArchive: true,
});

/** Arquivo combinado (info+) — rotação diária, retenção 14d */
const combinedFileTransport = new DailyRotateFile({
  filename: path.join(LOG_DIR, "combined-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  level: "info",
  maxSize: "20m",
  maxFiles: "14d",
  zippedArchive: true,
});

/** Console — apenas em desenvolvimento */
const consoleTransport = new transports.Console({
  level: "debug",
  format: consoleFormat,
});

// ─── Logger ─────────────────────────────────────────────────────

const logger = createLogger({
  level: env.isProduction ? "info" : "debug",
  format: fileFormat,
  defaultMeta: { service: "base_node" },
  transports: [
    errorFileTransport,
    combinedFileTransport,
    // Console apenas em dev
    ...(!env.isProduction ? [consoleTransport] : []),
  ],
  // Captura exceções e rejeições não tratadas
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "exceptions-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "30d",
      zippedArchive: true,
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, "rejections-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "30d",
      zippedArchive: true,
    }),
  ],
});

export default logger;
