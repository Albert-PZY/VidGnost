import type { FastifyInstance } from "fastify"

import type { HealthResponse } from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"

export async function registerHealthRoute(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.get(`${config.apiPrefix}/health`, async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      app: config.appName,
      version: config.version,
    }
  })
}
