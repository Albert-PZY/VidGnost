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
})
