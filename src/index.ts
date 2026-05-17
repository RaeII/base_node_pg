import express, { Application } from "express";
import { env } from "@/config";
import { initializePreRouteLoaders, initializePostRouteLoaders } from "@/shared/loaders";
import { registerControllers } from "@/shared/core/registerControllers";
import { setupSwagger } from "@/shared/core/swagger/swagger.setup";
import AuthController from "@/modules/auth/auth.controller";
import UserController from "@/modules/user/user.controller";

const controllers = [
	AuthController,
	UserController,
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

	app.listen(env.PORT, () => {
		console.log(`
			##############################
			Server listening on port: ${env.PORT}
			##############################`);
	}).on("error", (err: any) => {
		console.log(err);
		process.exit(1);
	});

}

startServer();