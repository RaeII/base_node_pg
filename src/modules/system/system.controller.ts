import { Request, Response } from "express";
import Controller from "@/shared/core/Controller";
import { Controller as Route, Get } from "@/shared/core/decorators";
import { ApiResponse, ApiSummary, ApiTags } from "@/shared/core/decorators/index";
import { healthCheck } from "@/db/health";
import { getPoolMetrics } from "@/db/metrics";
import { healthResponseSchema, metricsResponseSchema } from "@/modules/system/schemas/system.schema";

@Route("/system")
@ApiTags("Sistema")
class SystemController extends Controller {
    @Get("/health")
    @ApiSummary(
        "Health check",
        "200 quando OK, 503 quando degradado/down. Use em liveness/readiness probes (K8s).",
    )
    @ApiResponse(200, "Banco acessível e pool saudável", healthResponseSchema)
    @ApiResponse(503, "Pool saturado ou banco inacessível", healthResponseSchema)
    async health(_req: Request, res: Response) {
        const result = await healthCheck();
        // 503 quando degradado/down — readiness probe remove o pod do load balancer.
        const httpStatus = result.status === "ok" ? 200 : 503;
        return res.status(httpStatus).json(result);
    }

    @Get("/metrics")
    @ApiSummary(
        "Pool metrics",
        "Estatísticas dos pools de leitura e escrita em JSON. Sem dependência de Prometheus.",
    )
    @ApiResponse(200, "Métricas dos pools", metricsResponseSchema)
    async metrics(_req: Request, res: Response) {
        return res.status(200).json(getPoolMetrics());
    }
}

export default SystemController;
