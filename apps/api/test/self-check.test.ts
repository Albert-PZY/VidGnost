import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import type { AddressInfo } from "node:net"

import { llmConfigResponseSchema, selfCheckReportResponseSchema, type SelfCheckReportResponse } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("self-check routes", () => {
  let app: FastifyInstance
  let baseUrl = ""
  let ollamaBaseUrl = ""
  let ollamaServer: ReturnType<typeof createServer>
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-self-check-"))
    ollamaServer = createServer((request, response) => {
      if (request.url === "/api/tags") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ models: [] }))
        return
      }
      if (request.url === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ data: [] }))
        return
      }
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: { message: "not found" } }))
    })
    await new Promise<void>((resolve) => {
      ollamaServer.listen(0, "127.0.0.1", () => resolve())
    })
    const port = (ollamaServer.address() as AddressInfo).port
    ollamaBaseUrl = `http://127.0.0.1:${port}`
    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
      ollamaBaseUrl,
      llmBaseUrl: `${ollamaBaseUrl}/v1`,
    })
    baseUrl = await app.listen({
      host: "127.0.0.1",
      port: 0,
    })
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((resolve, reject) => {
      ollamaServer.close((error) => (error ? reject(error) : resolve()))
    })
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
    expect(report.steps.some((step) => step.id === "rerank")).toBe(true)

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
    expect(report.auto_fix_available).toBe(false)
  }, 20_000)

  it("verifies llm readiness by probing /models and confirming the configured model", async () => {
    const remoteCalls: string[] = []
    const remoteServer = createServer((request, response) => {
      remoteCalls.push(String(request.url || ""))
      if (request.url === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          data: [
            { id: "ready-model" },
          ],
        }))
        return
      }
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: { message: "not found" } }))
    })
    await new Promise<void>((resolve) => {
      remoteServer.listen(0, "127.0.0.1", () => resolve())
    })
    const remotePort = (remoteServer.address() as AddressInfo).port

    try {
      const currentConfigResponse = await app.inject({
        method: "GET",
        url: "/api/config/llm",
      })
      const currentConfig = llmConfigResponseSchema.parse(currentConfigResponse.json())
      const saveConfigResponse = await app.inject({
        method: "PUT",
        url: "/api/config/llm",
        payload: {
          ...currentConfig,
          base_url: `http://127.0.0.1:${remotePort}/v1`,
          api_key: "test-key",
          model: "ready-model",
        },
      })
      expect(saveConfigResponse.statusCode).toBe(200)

      const startResponse = await app.inject({
        method: "POST",
        url: "/api/self-check/start",
      })
      expect(startResponse.statusCode).toBe(200)

      const report = await waitForSelfCheckTerminal(app, startResponse.json<{ session_id: string }>().session_id)
      const llmStep = report.steps.find((step) => step.id === "llm")

      expect(llmStep).toMatchObject({
        status: "passed",
        check_depth: "model_verified",
      })
      expect(remoteCalls).toContain("/v1/models")
    } finally {
      await new Promise<void>((resolve, reject) => {
        remoteServer.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it("auto-detects local Ollama vision models and passes the VLM self-check without a manual API key", async () => {
    const remoteServer = createServer((request, response) => {
      if (request.url === "/api/tags") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          models: [
            { name: "qwen2.5:3b" },
            { name: "qwen2.5vl:3b" },
            { name: "bge-m3:latest" },
            { name: "sam860/qwen3-reranker:0.6b-q8_0" },
          ],
        }))
        return
      }
      if (request.url === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          data: [
            { id: "qwen2.5:3b" },
            { id: "qwen2.5vl:3b" },
            { id: "bge-m3:latest" },
            { id: "sam860/qwen3-reranker:0.6b-q8_0" },
          ],
        }))
        return
      }
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          choices: [
            {
              message: {
                content: "我能看见图片。",
              },
            },
          ],
        }))
        return
      }
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: { message: "not found" } }))
    })
    await new Promise<void>((resolve) => {
      remoteServer.listen(0, "127.0.0.1", () => resolve())
    })
    const remotePort = (remoteServer.address() as AddressInfo).port
    const runtimeStorageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-self-check-vlm-"))
    const runtimeApp = await buildApp({
      apiPrefix: "/api",
      storageDir: runtimeStorageDir,
      ollamaBaseUrl: `http://127.0.0.1:${remotePort}`,
      llmBaseUrl: `http://127.0.0.1:${remotePort}/v1`,
    })

    try {
      const startResponse = await runtimeApp.inject({
        method: "POST",
        url: "/api/self-check/start",
      })
      expect(startResponse.statusCode).toBe(200)

      const report = await waitForSelfCheckTerminal(runtimeApp, startResponse.json<{ session_id: string }>().session_id)
      const embeddingStep = report.steps.find((step) => step.id === "embedding")
      const rerankStep = report.steps.find((step) => step.id === "rerank")
      const vlmStep = report.steps.find((step) => step.id === "vlm")

      expect(embeddingStep).toMatchObject({
        status: "passed",
        check_depth: "model_verified",
      })
      expect(rerankStep).toMatchObject({
        status: "passed",
        check_depth: "model_verified",
      })
      expect(vlmStep).toMatchObject({
        status: "passed",
        check_depth: "model_verified",
      })
    } finally {
      await runtimeApp.close()
      await new Promise<void>((resolve, reject) => {
        remoteServer.close((error) => (error ? reject(error) : resolve()))
      })
      await rm(runtimeStorageDir, { force: true, recursive: true })
    }
  })

  it("returns a fast reachability result while the local vision probe warms up and reuses the cached probe later", async () => {
    let visionCalls = 0
    const remoteServer = createServer((request, response) => {
      if (request.url === "/api/tags") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          models: [
            { name: "qwen2.5:3b" },
            { name: "qwen2.5vl:3b" },
            { name: "bge-m3:latest" },
            { name: "sam860/qwen3-reranker:0.6b-q8_0" },
          ],
        }))
        return
      }
      if (request.url === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          data: [
            { id: "qwen2.5:3b" },
            { id: "qwen2.5vl:3b" },
          ],
        }))
        return
      }
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        visionCalls += 1
        setTimeout(() => {
          response.writeHead(200, { "Content-Type": "application/json" })
          response.end(JSON.stringify({
            choices: [
              {
                message: {
                  content: "我能看见图片。",
                },
              },
            ],
          }))
        }, 1500)
        return
      }
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: { message: "not found" } }))
    })
    await new Promise<void>((resolve) => {
      remoteServer.listen(0, "127.0.0.1", () => resolve())
    })
    const remotePort = (remoteServer.address() as AddressInfo).port
    const runtimeStorageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-self-check-vlm-cache-"))
    const runtimeApp = await buildApp({
      apiPrefix: "/api",
      storageDir: runtimeStorageDir,
      ollamaBaseUrl: `http://127.0.0.1:${remotePort}`,
      llmBaseUrl: `http://127.0.0.1:${remotePort}/v1`,
    })

    try {
      const firstStartResponse = await runtimeApp.inject({
        method: "POST",
        url: "/api/self-check/start",
      })
      expect(firstStartResponse.statusCode).toBe(200)
      const firstReport = await waitForSelfCheckTerminal(
        runtimeApp,
        firstStartResponse.json<{ session_id: string }>().session_id,
        {
          intervalMs: 50,
          maxAttempts: 80,
        },
      )
      const firstVlmStep = firstReport.steps.find((step) => step.id === "vlm")

      expect(firstVlmStep).toMatchObject({
        status: "passed",
        check_depth: "reachability",
      })
      expect(firstVlmStep?.message).toContain("后台预热")
      expect(visionCalls).toBe(1)

      await new Promise((resolve) => {
        setTimeout(resolve, 1800)
      })

      const secondStartResponse = await runtimeApp.inject({
        method: "POST",
        url: "/api/self-check/start",
      })
      expect(secondStartResponse.statusCode).toBe(200)
      const secondReport = await waitForSelfCheckTerminal(
        runtimeApp,
        secondStartResponse.json<{ session_id: string }>().session_id,
        {
          intervalMs: 50,
          maxAttempts: 80,
        },
      )
      const secondVlmStep = secondReport.steps.find((step) => step.id === "vlm")

      expect(secondVlmStep).toMatchObject({
        status: "passed",
        check_depth: "model_verified",
      })
      expect(visionCalls).toBe(1)
    } finally {
      await runtimeApp.close()
      await new Promise<void>((resolve, reject) => {
        remoteServer.close((error) => (error ? reject(error) : resolve()))
      })
      await rm(runtimeStorageDir, { force: true, recursive: true })
    }
  }, 20_000)
})

async function waitForSelfCheckTerminal(
  app: FastifyInstance,
  sessionId: string,
  options: {
    intervalMs?: number
    maxAttempts?: number
  } = {},
): Promise<SelfCheckReportResponse> {
  const maxAttempts = Math.max(1, options.maxAttempts || 200)
  const intervalMs = Math.max(10, options.intervalMs || 100)
  for (let index = 0; index < maxAttempts; index += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/self-check/${sessionId}/report`,
    })
    expect(response.statusCode).toBe(200)
    const payload = selfCheckReportResponseSchema.parse(response.json())
    if (payload.status === "completed" || payload.status === "failed") {
      return payload
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs)
    })
  }
  throw new Error(`Self-check session did not reach terminal state: ${sessionId}`)
}
