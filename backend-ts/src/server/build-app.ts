import Fastify, { type FastifyInstance } from "fastify"

import { createLoggerOptions } from "../core/logger.js"
import { resolveConfig, type AppConfig } from "../core/config.js"
import { RuntimeMetricsService } from "../modules/runtime/runtime-metrics-service.js"
import { registerHealthRoute } from "../routes/health.js"
import { registerRuntimeRoutes } from "../routes/runtime.js"

export async function buildApp(inputConfig?: Partial<AppConfig>): Promise<FastifyInstance> {
  const baseConfig = resolveConfig()
  const config: AppConfig = {
    ...baseConfig,
    ...inputConfig,
  }

  const app = Fastify({
    logger: createLoggerOptions(),
  })

  const runtimeMetricsService = new RuntimeMetricsService()

  await registerHealthRoute(app, config)
  await registerRuntimeRoutes(app, config, runtimeMetricsService)
  return app
}
