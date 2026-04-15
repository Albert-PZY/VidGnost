import path from "node:path"

import type { FastifyInstance } from "fastify"

import type { RuntimeMetricsResponse, RuntimePathsResponse } from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { RuntimeMetricsService } from "../modules/runtime/runtime-metrics-service.js"

export async function registerRuntimeRoutes(
  app: FastifyInstance,
  config: AppConfig,
  runtimeMetricsService: RuntimeMetricsService,
): Promise<void> {
  app.get(`${config.apiPrefix}/runtime/metrics`, async (): Promise<RuntimeMetricsResponse> => {
    return runtimeMetricsService.collect()
  })

  app.get(`${config.apiPrefix}/runtime/paths`, async (): Promise<RuntimePathsResponse> => {
    const storageDir = path.resolve(config.storageDir)
    const eventLogDir = path.join(storageDir, "event-logs")
    const traceLogDir = path.join(eventLogDir, "traces")

    return {
      storage_dir: storageDir,
      event_log_dir: eventLogDir,
      trace_log_dir: traceLogDir,
    }
  })
}
