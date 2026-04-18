import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"
import type { AddressInfo } from "node:net"

import { llmConfigResponseSchema, modelListResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("ollama model detection and llm sync", () => {
  let app: FastifyInstance
  let storageDir = ""
  let ollamaBaseUrl = ""
  let ollamaServer: ReturnType<typeof createServer>

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-ollama-sync-"))
    ollamaServer = createServer((request, response) => {
      if (request.url === "/api/tags") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          models: [
            { name: "qwen2.5:3b", size: 1929912432 },
            { name: "qwen2.5:7b", size: 4680000000 },
            { name: "qwen2.5vl:3b", size: 3200627168 },
            { name: "granite3.2-vision:2b", size: 2437852465 },
            { name: "bge-m3:latest", size: 1157672605 },
            { name: "sam860/qwen3-reranker:0.6b-q8_0", size: 639152832 },
          ],
        }))
        return
      }

      if (request.url === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          data: [
            { id: "qwen2.5:3b" },
            { id: "qwen2.5:7b" },
            { id: "qwen2.5vl:3b" },
            { id: "granite3.2-vision:2b" },
          ],
        }))
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

  it("marks Ollama-backed models ready from Ollama tags instead of pseudo paths", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config/models",
    })

    expect(response.statusCode).toBe(200)
    const payload = modelListResponseSchema.parse(response.json())

    expect(payload.items.find((item) => item.id === "llm-default")).toMatchObject({
      provider: "ollama",
      status: "ready",
      is_installed: true,
      size_bytes: 1929912432,
    })
    expect(payload.items.find((item) => item.id === "embedding-default")).toMatchObject({
      provider: "ollama",
      status: "ready",
      is_installed: true,
      size_bytes: 1157672605,
    })
    expect(payload.items.find((item) => item.id === "rerank-default")).toMatchObject({
      provider: "ollama",
      status: "ready",
      is_installed: true,
      size_bytes: 639152832,
    })
    expect(payload.items.find((item) => item.id === "vlm-default")).toMatchObject({
      provider: "ollama",
      model_id: "qwen2.5vl:3b",
      api_base_url: `${ollamaBaseUrl}/v1`,
      api_model: "qwen2.5vl:3b",
      status: "ready",
      is_installed: true,
      size_bytes: 3200627168,
    })
  })

  it("synchronizes llm-default changes into /config/llm for Ollama and remote providers", async () => {
    const saveRuntimeResponse = await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      payload: {
        mode: "api",
        load_profile: "balanced",
        local_model_id: "remote-before",
        api_key: "remote-before-key",
        api_key_configured: true,
        base_url: "https://remote-before.example/v1",
        model: "remote-before-model",
        correction_mode: "rewrite",
        correction_batch_size: 36,
        correction_overlap: 4,
      },
    })
    expect(saveRuntimeResponse.statusCode).toBe(200)

    const switchToOllamaResponse = await app.inject({
      method: "PATCH",
      url: "/api/config/models/llm-default",
      payload: {
        provider: "ollama",
        model_id: "qwen2.5:7b",
        load_profile: "memory_first",
      },
    })
    expect(switchToOllamaResponse.statusCode).toBe(200)

    const syncedOllamaRuntimeResponse = await app.inject({
      method: "GET",
      url: "/api/config/llm",
    })
    expect(syncedOllamaRuntimeResponse.statusCode).toBe(200)
    expect(llmConfigResponseSchema.parse(syncedOllamaRuntimeResponse.json())).toMatchObject({
      base_url: `${ollamaBaseUrl}/v1`,
      model: "qwen2.5:7b",
      local_model_id: "qwen2.5:7b",
      load_profile: "memory_first",
      api_key: "ollama",
      correction_mode: "rewrite",
      correction_batch_size: 36,
      correction_overlap: 4,
    })

    const switchToRemoteResponse = await app.inject({
      method: "PATCH",
      url: "/api/config/models/llm-default",
      payload: {
        provider: "openai_compatible",
        api_base_url: "https://example.com/v1",
        api_key: "remote-secret",
        api_model: "remote-model",
        load_profile: "balanced",
      },
    })
    expect(switchToRemoteResponse.statusCode).toBe(200)

    const syncedRemoteRuntimeResponse = await app.inject({
      method: "GET",
      url: "/api/config/llm",
    })
    expect(syncedRemoteRuntimeResponse.statusCode).toBe(200)
    expect(llmConfigResponseSchema.parse(syncedRemoteRuntimeResponse.json())).toMatchObject({
      base_url: "https://example.com/v1",
      model: "remote-model",
      load_profile: "balanced",
      api_key: "remote-secret",
      correction_mode: "rewrite",
      correction_batch_size: 36,
      correction_overlap: 4,
    })
  })
})
