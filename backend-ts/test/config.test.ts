import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import {
  apiErrorPayloadSchema,
  llmConfigResponseSchema,
  modelListResponseSchema,
  ollamaRuntimeConfigResponseSchema,
  promptTemplateBundleResponseSchema,
  uiSettingsResponseSchema,
  whisperConfigResponseSchema,
} from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("config routes", () => {
  let app: FastifyInstance
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-backend-ts-"))
    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
    })
  })

  afterAll(async () => {
    await app.close()
    if (storageDir) {
      await rm(storageDir, { force: true, recursive: true })
    }
  })

  it("reads and updates ui settings with compatibility defaults", async () => {
    const initialResponse = await app.inject({
      method: "GET",
      url: "/api/config/ui",
    })
    expect(initialResponse.statusCode).toBe(200)
    expect(uiSettingsResponseSchema.parse(initialResponse.json())).toMatchObject({
      language: "zh",
      font_size: 14,
      background_image_fill_mode: "cover",
    })

    const updatedResponse = await app.inject({
      method: "PUT",
      url: "/api/config/ui",
      payload: {
        language: "en",
        font_size: 18,
        theme_hue: 140,
        background_image_fill_mode: "contain",
      },
    })

    expect(updatedResponse.statusCode).toBe(200)
    expect(uiSettingsResponseSchema.parse(updatedResponse.json())).toMatchObject({
      language: "en",
      font_size: 18,
      theme_hue: 140,
      background_image_fill_mode: "contain",
    })
  })

  it("reads and updates llm config", async () => {
    const initialResponse = await app.inject({
      method: "GET",
      url: "/api/config/llm",
    })
    const initialPayload = llmConfigResponseSchema.parse(initialResponse.json())
    expect(initialPayload.mode).toBe("api")

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      payload: {
        ...initialPayload,
        base_url: "https://example.com/v1",
        api_key: "secret-key",
        model: "test-model",
        correction_mode: "rewrite",
        correction_batch_size: 32,
        correction_overlap: 5,
      },
    })

    expect(updateResponse.statusCode).toBe(200)
    expect(llmConfigResponseSchema.parse(updateResponse.json())).toMatchObject({
      base_url: "https://example.com/v1",
      api_key: "secret-key",
      api_key_configured: true,
      model: "test-model",
      correction_mode: "rewrite",
      correction_batch_size: 32,
      correction_overlap: 5,
    })
  })

  it("creates prompt templates and rejects invalid selection ids", async () => {
    const initialResponse = await app.inject({
      method: "GET",
      url: "/api/config/prompts",
    })
    const initialPayload = promptTemplateBundleResponseSchema.parse(initialResponse.json())
    expect(initialPayload.templates).toHaveLength(4)

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/config/prompts/templates",
      payload: {
        channel: "notes",
        name: "My Notes Prompt",
        content: "test content",
      },
    })

    expect(createResponse.statusCode).toBe(200)
    const createdPayload = promptTemplateBundleResponseSchema.parse(createResponse.json())
    const createdTemplate = createdPayload.templates.find((item) => item.name === "My Notes Prompt")
    expect(createdTemplate).toBeTruthy()

    const invalidSelectionResponse = await app.inject({
      method: "PUT",
      url: "/api/config/prompts/selection",
      payload: {
        notes: "missing-template",
      },
    })

    expect(invalidSelectionResponse.statusCode).toBe(400)
    expect(apiErrorPayloadSchema.parse(invalidSelectionResponse.json())).toMatchObject({
      code: "PROMPT_TEMPLATE_SELECTION_INVALID",
    })
  })

  it("serves whisper, ollama and model config compatibility surfaces", async () => {
    const [whisperResponse, ollamaResponse, modelsResponse] = await Promise.all([
      app.inject({ method: "GET", url: "/api/config/whisper" }),
      app.inject({ method: "GET", url: "/api/config/ollama" }),
      app.inject({ method: "GET", url: "/api/config/models" }),
    ])

    expect(whisperResponse.statusCode).toBe(200)
    expect(ollamaResponse.statusCode).toBe(200)
    expect(modelsResponse.statusCode).toBe(200)

    expect(whisperConfigResponseSchema.parse(whisperResponse.json())).toMatchObject({
      model_default: "small",
      language: "zh",
    })
    expect(ollamaRuntimeConfigResponseSchema.parse(ollamaResponse.json())).toMatchObject({
      base_url: expect.any(String),
      service: {
        reachable: expect.any(Boolean),
        can_self_restart: false,
      },
    })

    const modelList = modelListResponseSchema.parse(modelsResponse.json())
    expect(modelList.items).toHaveLength(6)
    expect(modelList.items.find((item) => item.id === "llm-default")).toBeTruthy()

    const updateModelResponse = await app.inject({
      method: "PATCH",
      url: "/api/config/models/llm-default",
      payload: {
        provider: "openai_compatible",
        api_base_url: "https://example.com/v1",
        api_key: "remote-secret",
        api_model: "remote-model",
      },
    })

    expect(updateModelResponse.statusCode).toBe(200)
    const updatedModels = modelListResponseSchema.parse(updateModelResponse.json())
    expect(updatedModels.items.find((item) => item.id === "llm-default")).toMatchObject({
      provider: "openai_compatible",
      api_key_configured: true,
      status: "ready",
    })
  })
})
