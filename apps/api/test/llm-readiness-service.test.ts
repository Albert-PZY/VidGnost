import { describe, expect, it } from "vitest"

import { LlmReadinessService } from "../src/modules/runtime/llm-readiness-service.js"

describe("LlmReadinessService.verifyRemoteModel", () => {
  it("treats Ollama :latest aliases as the configured model", async () => {
    const service = new LlmReadinessService({
      async listModels() {
        return {
          models: ["qwen2.5:3b", "bge-m3:latest", "sam860/qwen3-reranker:0.6b-q8_0"],
          raw: {},
        }
      },
      async generateVisionText() {
        return {
          content: "unused",
          raw: {},
        }
      },
    })

    const result = await service.verifyRemoteModel({
      apiKey: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      label: "默认嵌入模型",
      model: "bge-m3",
      timeoutSeconds: 5,
    })

    expect(result).toMatchObject({
      ok: true,
      checkDepth: "model_verified",
      details: {
        模型已验证: "是",
      },
    })
  })

  it("returns a friendly loopback reachability message instead of leaking fetch failed", async () => {
    const service = new LlmReadinessService({
      async listModels() {
        throw new TypeError("fetch failed")
      },
      async generateVisionText() {
        return {
          content: "unused",
          raw: {},
        }
      },
    })

    const result = await service.verifyRemoteModel({
      apiKey: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      label: "LLM 模型",
      model: "qwen2.5:3b",
      timeoutSeconds: 5,
    })

    expect(result.ok).toBe(false)
    expect(result.checkDepth).toBe("reachability")
    expect(result.message).toContain("无法连接到本地 Ollama 服务")
    expect(result.message).not.toContain("fetch failed")
    expect(result.details).toMatchObject({
      "Base URL": "http://127.0.0.1:11434/v1",
      远程可达: "否",
      鉴权: "已配置",
    })
  })

  it("returns a friendly loopback vision-probe message instead of leaking fetch failed", async () => {
    const service = new LlmReadinessService({
      async listModels() {
        return {
          models: ["qwen2.5vl:3b"],
          raw: {},
        }
      },
      async generateVisionText() {
        throw new TypeError("fetch failed")
      },
    })

    const result = await service.probeVisionModel({
      apiKey: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      imageUrl: "https://example.com/test.png",
      label: "视觉模型",
      model: "qwen2.5vl:3b",
      timeoutSeconds: 5,
    })

    expect(result.ok).toBe(false)
    expect(result.checkDepth).toBe("reachability")
    expect(result.message).toContain("无法连接到本地 Ollama 服务")
    expect(result.message).not.toContain("fetch failed")
    expect(result.details).toMatchObject({
      "Base URL": "http://127.0.0.1:11434/v1",
      探测图片: "https://example.com/test.png",
      远程可达: "否",
      鉴权: "已配置",
    })
  })
})
