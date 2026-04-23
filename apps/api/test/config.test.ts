import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { FastifyInstance } from "fastify"

import {
  apiErrorPayloadSchema,
  bilibiliAuthQrPollResponseSchema,
  bilibiliAuthQrStartResponseSchema,
  bilibiliAuthStatusResponseSchema,
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

  it("starts, polls and clears bilibili auth without exposing cookies", async () => {
    const bilibiliStorageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-bilibili-"))
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes("/x/passport-login/web/qrcode/generate")) {
        return createBilibiliJsonResponse({
          code: 0,
          data: {
            qrcode_key: "test-qrcode-key",
            url: "https://passport.bilibili.com/h5-app/passport/login/scan?test=1",
          },
        })
      }
      if (url.includes("/x/passport-login/web/qrcode/poll")) {
        return createBilibiliJsonResponse(
          {
            code: 0,
            data: {
              code: 0,
              message: "success",
            },
          },
          {
            setCookie: [
              "SESSDATA=sess-123; Path=/; HttpOnly",
              "bili_jct=csrf-123; Path=/",
              "DedeUserID=42; Path=/",
              "DedeUserID__ckMd5=hash-42; Path=/",
              "sid=sid-42; Path=/",
              "unrelated_cookie=should-not-persist; Path=/",
            ],
          },
        )
      }
      if (url.includes("/x/web-interface/nav")) {
        return createBilibiliJsonResponse({
          code: 0,
          data: {
            face: "https://i0.hdslb.com/bfs/face/member.png",
            level_info: {
              current_level: 6,
            },
            mid: 42,
            uname: "测试用户",
            vip: {
              label: {
                text: "大会员",
              },
            },
          },
        })
      }
      throw new Error(`Unexpected Bilibili URL: ${url}`)
    })
    const bilibiliApp = await buildApp(
      {
        apiPrefix: "/api",
        storageDir: bilibiliStorageDir,
      },
      {
        bilibiliFetch: fetchMock,
      },
    )

    try {
      const initialResponse = await bilibiliApp.inject({
        method: "GET",
        url: "/api/config/bilibili-auth",
      })
      expect(initialResponse.statusCode).toBe(200)
      expect(bilibiliAuthStatusResponseSchema.parse(initialResponse.json())).toMatchObject({
        status: "missing",
        account: null,
      })

      const startResponse = await bilibiliApp.inject({
        method: "POST",
        url: "/api/config/bilibili-auth/qrcode/start",
      })
      expect(startResponse.statusCode).toBe(200)
      expect(bilibiliAuthQrStartResponseSchema.parse(startResponse.json())).toMatchObject({
        status: "pending",
        qrcode_key: "test-qrcode-key",
      })

      const pollResponse = await bilibiliApp.inject({
        method: "GET",
        url: "/api/config/bilibili-auth/qrcode/poll?qrcode_key=test-qrcode-key",
      })
      expect(pollResponse.statusCode).toBe(200)
      expect(bilibiliAuthQrPollResponseSchema.parse(pollResponse.json())).toMatchObject({
        status: "success",
        account: {
          mid: "42",
          uname: "测试用户",
        },
      })

      const statusResponse = await bilibiliApp.inject({
        method: "GET",
        url: "/api/config/bilibili-auth",
      })
      expect(statusResponse.statusCode).toBe(200)
      const statusPayload = bilibiliAuthStatusResponseSchema.parse(statusResponse.json())
      expect(statusPayload).toMatchObject({
        status: "active",
        account: {
          mid: "42",
          uname: "测试用户",
        },
      })
      expect(JSON.stringify(statusPayload)).not.toContain("sess-123")
      expect(JSON.stringify(statusPayload)).not.toContain("csrf-123")
      expect(statusPayload).not.toHaveProperty("cookies")
      expect(statusPayload).not.toHaveProperty("cookie_names")
      expect(fetchMock).toHaveBeenCalledTimes(3)

      const clearResponse = await bilibiliApp.inject({
        method: "DELETE",
        url: "/api/config/bilibili-auth/session",
      })
      expect(clearResponse.statusCode).toBe(200)
      expect(bilibiliAuthStatusResponseSchema.parse(clearResponse.json())).toMatchObject({
        status: "missing",
        account: null,
      })
    } finally {
      await bilibiliApp.close()
      await rm(bilibiliStorageDir, { force: true, recursive: true })
    }
  })

  it("returns pending bilibili qr metadata from auth status without exposing cookies", async () => {
    const bilibiliStorageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-bilibili-pending-"))
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes("/x/passport-login/web/qrcode/generate")) {
        return createBilibiliJsonResponse({
          code: 0,
          data: {
            qrcode_key: "pending-key",
            url: "https://passport.bilibili.com/h5-app/passport/login/scan?pending=1",
          },
        })
      }
      throw new Error(`Unexpected Bilibili URL: ${url}`)
    })
    const bilibiliApp = await buildApp(
      {
        apiPrefix: "/api",
        storageDir: bilibiliStorageDir,
      },
      {
        bilibiliFetch: fetchMock,
      },
    )

    try {
      const startResponse = await bilibiliApp.inject({
        method: "POST",
        url: "/api/config/bilibili-auth/qrcode/start",
      })
      expect(startResponse.statusCode).toBe(200)
      expect(bilibiliAuthQrStartResponseSchema.parse(startResponse.json())).toMatchObject({
        status: "pending",
        qrcode_key: "pending-key",
      })

      const statusResponse = await bilibiliApp.inject({
        method: "GET",
        url: "/api/config/bilibili-auth",
      })
      expect(statusResponse.statusCode).toBe(200)
      const statusPayload = bilibiliAuthStatusResponseSchema.parse(statusResponse.json())
      expect(statusPayload).toMatchObject({
        status: "pending",
        account: null,
        qrcode_key: "pending-key",
        qrcode_url: "https://passport.bilibili.com/h5-app/passport/login/scan?pending=1",
        qr_image_data_url: expect.stringContaining("data:image/png;base64,"),
        poll_interval_ms: 1500,
      })
      expect(JSON.stringify(statusPayload)).not.toContain("SESSDATA")
      expect(statusPayload).not.toHaveProperty("cookies")
    } finally {
      await bilibiliApp.close()
      await rm(bilibiliStorageDir, { force: true, recursive: true })
    }
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

    const whisperResponse = await app.inject({ method: "GET", url: "/api/config/whisper" })
    const ollamaResponse = await app.inject({ method: "GET", url: "/api/config/ollama" })
    const modelsResponse = await app.inject({ method: "GET", url: "/api/config/models" })

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
    expect(modelList.items.find((item) => item.id === "whisper-default")?.size_bytes).toBeGreaterThan(0)

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

function createBilibiliJsonResponse(
  payload: unknown,
  init: {
    setCookie?: string[]
    status?: number
  } = {},
): Response {
  const status = init.status ?? 200
  const headers = new Headers()
  const responseHeaders = headers as Headers & { getSetCookie?: () => string[] }
  responseHeaders.getSetCookie = () => [...(init.setCookie || [])]
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  } as Response
}
