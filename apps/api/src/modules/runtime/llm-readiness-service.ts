import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"

export interface LlmReadinessResult {
  checkDepth: "config_only" | "reachability" | "model_verified"
  details: Record<string, string>
  message: string
  ok: boolean
}

export class LlmReadinessService {
  constructor(
    private readonly llmClient: Pick<OpenAiCompatibleClient, "listModels">,
  ) {}

  async verifyRemoteModel(input: {
    apiKey: string
    baseUrl: string
    label: string
    model: string
    timeoutSeconds?: number
  }): Promise<LlmReadinessResult> {
    const baseUrl = String(input.baseUrl || "").trim()
    const apiKey = String(input.apiKey || "").trim()
    const model = String(input.model || "").trim()

    if (!baseUrl || !model) {
      return {
        ok: false,
        checkDepth: "config_only",
        message: `${input.label} 远程配置不完整。`,
        details: {
          "Base URL": baseUrl || "未配置",
          模型: model || "未配置",
          鉴权: apiKey ? "已配置" : "未配置",
        },
      }
    }
    if (!apiKey) {
      return {
        ok: false,
        checkDepth: "config_only",
        message: `${input.label} 缺少 API Key。`,
        details: {
          "Base URL": baseUrl,
          模型: model,
          鉴权: "未配置",
        },
      }
    }

    try {
      const response = await this.llmClient.listModels({
        apiKey,
        baseUrl,
        timeoutSeconds: input.timeoutSeconds,
      })
      const modelMatched = response.models.includes(model)
      return {
        ok: modelMatched,
        checkDepth: modelMatched ? "model_verified" : "reachability",
        message: modelMatched ? `${input.label} 远程模型已验证。` : `${input.label} 远程服务可达，但未找到配置模型。`,
        details: {
          "Base URL": baseUrl,
          模型: model,
          "远程模型数": String(response.models.length),
          远程可达: "是",
          模型已验证: modelMatched ? "是" : "否",
        },
      }
    } catch (error) {
      return {
        ok: false,
        checkDepth: "reachability",
        message: error instanceof Error && error.message.trim() ? error.message : `${input.label} 远程服务不可达。`,
        details: {
          "Base URL": baseUrl,
          模型: model,
          远程可达: "否",
          鉴权: "已配置",
        },
      }
    }
  }
}
