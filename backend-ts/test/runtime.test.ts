import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { runtimeMetricsResponseSchema, runtimePathsResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("GET /api/runtime/*", () => {
  let app: FastifyInstance
  const storageDir = path.resolve(process.cwd(), "backend", "storage")

  beforeAll(async () => {
    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it("returns runtime metrics payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/runtime/metrics",
    })

    expect(response.statusCode).toBe(200)
    expect(runtimeMetricsResponseSchema.parse(response.json())).toMatchObject({
      uptime_seconds: expect.any(Number),
      cpu_percent: expect.any(Number),
      memory_used_bytes: expect.any(Number),
      memory_total_bytes: expect.any(Number),
      gpu_percent: expect.any(Number),
      gpu_memory_used_bytes: expect.any(Number),
      gpu_memory_total_bytes: expect.any(Number),
      sampled_at: expect.any(String),
    })
  })

  it("returns compatibility runtime paths payload", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/runtime/paths",
    })

    expect(response.statusCode).toBe(200)
    expect(runtimePathsResponseSchema.parse(response.json())).toEqual({
      storage_dir: storageDir,
      event_log_dir: path.join(storageDir, "event-logs"),
      trace_log_dir: path.join(storageDir, "event-logs", "traces"),
    })
  })
})
