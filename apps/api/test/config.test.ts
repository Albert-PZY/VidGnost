import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import {
  apiErrorPayloadSchema,
  llmConfigResponseSchema,
  modelListResponseSchema,
  ollamaModelsMigrationResponseSchema,
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
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-"))
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

  it("serves health and config preflight requests to loopback dev origins", async () => {
    const [healthResponse, llmPreflightResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/health",
        headers: {
          origin: "http://127.0.0.1:16221",
        },
      }),
      app.inject({
        method: "OPTIONS",
        url: "/api/config/llm",
        headers: {
          origin: "http://127.0.0.1:16221",
          "access-control-request-method": "PUT",
          "access-control-request-headers": "content-type",
        },
      }),
    ])

    expect(healthResponse.statusCode).toBe(200)
    expect(healthResponse.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:16221")

    expect(llmPreflightResponse.statusCode).toBe(204)
    expect(llmPreflightResponse.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:16221")
    expect(String(llmPreflightResponse.headers["access-control-allow-methods"] || "")).toContain("PUT")
    expect(String(llmPreflightResponse.headers["access-control-allow-methods"] || "")).toContain("PATCH")
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
    const whisperModelPath = path.join(storageDir, "models", "whisper", "whisper-default")
    await mkdir(whisperModelPath, { recursive: true })
    await writeFile(path.join(whisperModelPath, "config.json"), "{\"model_type\":\"whisper\"}\n", "utf8")
    await writeFile(path.join(whisperModelPath, "model.bin"), "fake-whisper-model", "utf8")

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
      chunk_seconds: 30,
    })
    expect(whisperConfigResponseSchema.parse(whisperResponse.json()).runtime_libraries).toMatchObject({
      bin_dir: expect.any(String),
      discovered_files: {
        model: whisperModelPath,
        model_dir: path.join(storageDir, "models", "whisper"),
      },
      path_configured: expect.any(Boolean),
    })
    expect(ollamaRuntimeConfigResponseSchema.parse(ollamaResponse.json())).toMatchObject({
      base_url: expect.any(String),
      service: {
        reachable: expect.any(Boolean),
        can_self_restart: expect.any(Boolean),
      },
    })

    const modelList = modelListResponseSchema.parse(modelsResponse.json())
    expect(modelList.items).toHaveLength(5)
    expect(modelList.items.map((item) => item.id).sort()).toEqual([
      "embedding-default",
      "llm-default",
      "rerank-default",
      "vlm-default",
      "whisper-default",
    ])

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

    const downloadResponse = await app.inject({
      method: "POST",
      url: "/api/config/models/whisper-default/download",
      payload: {},
    })
    expect(downloadResponse.statusCode).toBe(200)
    expect(modelListResponseSchema.parse(downloadResponse.json()).items.find((item) => item.id === "whisper-default")).toMatchObject({
      download: {
        state: "completed",
      },
    })

    const cancelDownloadResponse = await app.inject({
      method: "DELETE",
      url: "/api/config/models/whisper-default/download",
    })
    expect(cancelDownloadResponse.statusCode).toBe(200)
    expect(modelListResponseSchema.parse(cancelDownloadResponse.json()).items.find((item) => item.id === "whisper-default")).toMatchObject({
      download: {
        state: "cancelled",
      },
    })

    const migrateOllamaModelsResponse = await app.inject({
      method: "POST",
      url: "/api/config/ollama/migrate-models",
      payload: {
        target_dir: path.join(storageDir, "custom-ollama-models"),
      },
    })
    expect(migrateOllamaModelsResponse.statusCode).toBe(200)
    expect(ollamaModelsMigrationResponseSchema.parse(migrateOllamaModelsResponse.json())).toMatchObject({
      moved: false,
      target_dir: path.join(storageDir, "custom-ollama-models"),
    })
  })

  it("keeps Ollama install path pinned to the default runtime while allowing model directory updates", async () => {
    const defaultInstallDir =
      process.platform === "win32"
        ? path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Ollama")
        : "/usr/local/bin"
    const defaultExecutablePath = path.join(defaultInstallDir, process.platform === "win32" ? "ollama.exe" : "ollama")
    const customModelsDir = path.join(storageDir, "custom-ollama-models-locked")

    const response = await app.inject({
      method: "PUT",
      url: "/api/config/ollama",
      payload: {
        install_dir: "D:\\Custom\\Ollama",
        executable_path: "D:\\Custom\\Ollama\\ollama.exe",
        models_dir: customModelsDir,
        base_url: "http://127.0.0.1:22345",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(ollamaRuntimeConfigResponseSchema.parse(response.json())).toMatchObject({
      install_dir: defaultInstallDir,
      executable_path: defaultExecutablePath,
      models_dir: customModelsDir,
      base_url: "http://127.0.0.1:22345",
    })
  })

  it("normalizes bounded model config fields when catalog storage contains out-of-range values", async () => {
    const initialResponse = await app.inject({
      method: "GET",
      url: "/api/config/models",
    })
    expect(initialResponse.statusCode).toBe(200)
    const initialModels = modelListResponseSchema.parse(initialResponse.json())

    const corruptedModels = initialModels.items.map((item) =>
      item.id === "rerank-default"
        ? {
            ...item,
            rerank_top_n: 999,
            api_timeout_seconds: 9999,
          }
        : item,
    )

    await writeFile(path.join(storageDir, "models", "catalog.json"), JSON.stringify(corruptedModels, null, 2), "utf8")

    const normalizedResponse = await app.inject({
      method: "GET",
      url: "/api/config/models",
    })

    expect(normalizedResponse.statusCode).toBe(200)
    expect(modelListResponseSchema.parse(normalizedResponse.json()).items.find((item) => item.id === "rerank-default")).toMatchObject({
      rerank_top_n: 20,
      api_timeout_seconds: 600,
    })
  })
})
