import express, { Application } from "express";
import { env } from "@/config";
import { initializePreRouteLoaders, initializePostRouteLoaders } from "@/shared/loaders";
import { registerControllers } from "@/shared/core/registerControllers";
import { setupSwagger } from "@/shared/core/swagger/swagger.setup";
import AuthController from "@/modules/auth/auth.controller";
import UserController from "@/modules/user/user.controller";
import SystemController from "@/modules/system/system.controller";
import { drainPool } from "@/db/pool";
import { startPoolWatchdog, stopPoolWatchdog } from "@/db/watchdog";
import logger from "@/shared/utils/logger";

const controllers = [
	AuthController,
	UserController,
	SystemController,
];

async function startServer() {
	const app: Application = express();

	// 1. Middlewares que devem rodar ANTES das rotas (json parser, cors, etc.)
	await initializePreRouteLoaders(app);

	// 2. Registra os controllers decorados automaticamente
	registerControllers(app, "/api", controllers);

	// 3. Configura o Swagger UI com documentação gerada automaticamente
	setupSwagger(app, "/api", controllers, {
		title: "Back Node API",
		description: "Documentação",
		version: "1.0.0",
		servers: [
			{
				url: `http://localhost:${env.PORT}`,
				description: "Servidor de desenvolvimento",
			},
		],
	});

	// 4. Handlers de erro DEPOIS das rotas (404, error handlers)
	initializePostRouteLoaders(app);

	const server = app.listen(env.PORT, () => {
		console.log(`
				##############################
				Server listening on port: ${env.PORT}
				##############################`);
	}).on("error", (err: any) => {
		console.log(err);
		process.exit(1);
	});

	// Monitor periódico dos pools com alerta Discord em saturação
	startPoolWatchdog();

	const closeHttp = () =>
		new Promise<void>((resolve) => server.close(() => resolve()));

	// Graceful shutdown: separar `drain` (só fecha) de `gracefulShutdown` (decide exit code).
	// Importante para que `uncaughtException` saia com exit(1) — orquestrador K8s precisa ver o crash.
	const drain = async (): Promise<void> => {
		stopPoolWatchdog();
		await closeHttp();
		await drainPool(10_000);
	};

	const gracefulShutdown = async (signal: string) => {
		logger.info(`Received ${signal} — starting graceful shutdown`);
		try {
			await drain();
			logger.info("Graceful shutdown complete");
			process.exit(0);
		} catch (err) {
			logger.error("Error during graceful shutdown", {
				err: err instanceof Error ? err.message : String(err),
			});
			process.exit(1);
		}
	};

	process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
	process.on("SIGINT", () => gracefulShutdown("SIGINT"));

	process.on("uncaughtException", async (err) => {
		logger.error("Uncaught exception", { err: err.message, stack: err.stack });
		try {
			await drain();
		} catch {
			// continua para exit(1)
		}
		// exit(1) sempre — não use gracefulShutdown (que sai com 0)
		process.exit(1);
	});

	process.on("unhandledRejection", (err) => {
		logger.error("Unhandled rejection", {
			err: err instanceof Error ? err.message : String(err),
		});
	});
}

// Falha de boot (config inválida, banco indisponível) precisa ser visível no
// console/orquestrador e derrubar o processo — sem o catch, a rejeição iria
// silenciosa para o rejections log do Winston e o processo ficaria vivo sem listen.
startServer().catch((err) => {
	console.error("Fatal boot error:", err instanceof Error ? err.message : err);
	process.exit(1);
});
