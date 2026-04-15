import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { selfCheckReportResponseSchema } from "@vidgnost/contracts"

import { pathExists } from "../src/core/fs.js"
import { buildApp } from "../src/server/build-app.js"

describe("self-check routes", () => {
  let app: FastifyInstance
  let baseUrl = ""
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-self-check-"))
    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
    })
    baseUrl = await app.listen({
      host: "127.0.0.1",
      port: 0,
    })
  })

  afterAll(async () => {
    await app.close()
    if (storageDir) {
      await rm(storageDir, { force: true, recursive: true })
    }
  })

  it("starts self-check, exposes report/events, and supports auto-fix rerun", async () => {
    const startResponse = await app.inject({
      method: "POST",
      url: "/api/self-check/start",
    })

    expect(startResponse.statusCode).toBe(200)
    const startPayload = startResponse.json<{ session_id: string; status: string }>()
    expect(startPayload.status).toBe("running")

    let report = await waitForSelfCheckTerminal(app, startPayload.session_id)
    expect(selfCheckReportResponseSchema.parse(report).session_id).toBe(startPayload.session_id)
    expect(report.steps.length).toBeGreaterThan(0)
    expect(report.steps.some((step) => step.id === "env")).toBe(true)

    const eventsResponse = await fetch(`${baseUrl}/api/self-check/${startPayload.session_id}/events`, {
      headers: {
        Accept: "text/event-stream",
      },
    })
    expect(eventsResponse.status).toBe(200)
    expect(eventsResponse.headers.get("content-type") || "").toContain("text/event-stream")
    const eventsBody = await eventsResponse.text()
    expect(eventsBody).toContain("\"type\":\"self_check_started\"")
    expect(eventsBody).toContain("\"type\":\"self_check_complete\"")

    const autoFixResponse = await app.inject({
      method: "POST",
      url: `/api/self-check/${startPayload.session_id}/auto-fix`,
      payload: {},
    })
    expect(autoFixResponse.statusCode).toBe(200)
    expect(autoFixResponse.json()).toEqual({
      session_id: startPayload.session_id,
      status: "fixing",
    })

    report = await waitForSelfCheckTerminal(app, startPayload.session_id)
    expect(report.status).toBe("completed")
    expect(await pathExists(path.join(storageDir, "vector-index", "chroma-db"))).toBe(true)
    expect(report.auto_fix_available).toBe(false)
  })
})

async function waitForSelfCheckTerminal(
  app: FastifyInstance,
  sessionId: string,
): Promise<{
  auto_fix_available: boolean
  progress: number
  session_id: string
  status: string
  steps: Array<{ id: string }>
}> {
  for (let index = 0; index < 80; index += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/self-check/${sessionId}/report`,
    })
    expect(response.statusCode).toBe(200)
    const payload = response.json<{
      auto_fix_available: boolean
      progress: number
      session_id: string
      status: string
      steps: Array<{ id: string }>
    }>()
    if (payload.status === "completed" || payload.status === "failed") {
      return payload
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
  }
  throw new Error(`Self-check session did not reach terminal state: ${sessionId}`)
}
