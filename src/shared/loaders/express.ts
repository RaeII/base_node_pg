import {
  json,
  Application,
  Request,
  Response,
  NextFunction,
  ErrorRequestHandler,
} from "express";
import cors from "cors";

/**
 * Registra os middlewares que devem ser executados ANTES das rotas.
 * (json parser, cors, async local storage, etc.)
 */
export function loadPreRouteMiddlewares(app: Application) {
  app.use(json({ limit: '10mb' }));

  const options: cors.CorsOptions = {
    credentials: true,
    methods: 'GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE',
    origin: "http://localhost:3000",
    preflightContinue: false,
    optionsSuccessStatus: 200
  }

  app.use(cors(options));
}

/**
 * Registra os handlers de erro que devem ser executados DEPOIS das rotas.
 * (404, error handlers, etc.)
 */
export function loadPostRouteMiddlewares(app: Application) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const err: any = new Error("Not Found");
    err["status"] = 404;
    next(err);
  });

  // error handlers
  app.use(((err: any, req: Request, res: Response, next: NextFunction) => {
    /**
     * Handle 401 thrown by express-jwt library
     */
    if (err.name === "UnauthorizedError") {
      return res.status(err.status).send({ message: err.message }).end();
    }
    return next(err);
  }) as ErrorRequestHandler);

  app.use(((err: any, req: Request, res: Response) => {
    res.status(err.status || 500);
    res.json({
      errors: {
        message: err.message,
      },
    });
  }) as ErrorRequestHandler);
}

// Mantém export default para retrocompatibilidade (registra tudo de uma vez)
export default (app: Application) => {
  loadPreRouteMiddlewares(app);
  loadPostRouteMiddlewares(app);
};
