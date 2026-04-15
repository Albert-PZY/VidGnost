import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { healthResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("GET /api/health", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      appName: "VidGnost API",
      apiPrefix: "/api",
      host: "127.0.0.1",
      port: 8666,
      version: "0.1.0",
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it("returns the compatibility health payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    })

    expect(response.statusCode).toBe(200)
    expect(healthResponseSchema.parse(response.json())).toEqual({
      status: "ok",
      app: "VidGnost API",
      version: "0.1.0",
    })
  })
})
