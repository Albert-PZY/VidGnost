import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"

export interface LlmReadinessResult {
  checkDepth: "config_only" | "reachability" | "model_verified"
  details: Record<string, string>
  message: string
  ok: boolean
}

export class LlmReadinessService {
  constructor(
    private readonly llmClient: Pick<OpenAiCompatibleClient, "generateVisionText" | "listModels">,
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
      const modelMatched = response.models.some((candidate) => modelsEquivalent(candidate, model))
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

  async probeVisionModel(input: {
    apiKey: string
    baseUrl: string
    imageUrl: string
    label: string
    model: string
    timeoutSeconds?: number
  }): Promise<LlmReadinessResult> {
    const baseUrl = String(input.baseUrl || "").trim()
    const apiKey = String(input.apiKey || "").trim()
    const model = String(input.model || "").trim()
    const imageUrl = String(input.imageUrl || "").trim()

    if (!baseUrl || !model || !imageUrl) {
      return {
        ok: false,
        checkDepth: "config_only",
        message: `${input.label} 视觉探测配置不完整。`,
        details: {
          "Base URL": baseUrl || "未配置",
          模型: model || "未配置",
          探测图片: imageUrl || "未配置",
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
          探测图片: imageUrl,
          鉴权: "未配置",
        },
      }
    }

    try {
      const result = await this.llmClient.generateVisionText({
        apiKey,
        baseUrl,
        model,
        timeoutSeconds: input.timeoutSeconds,
        userPrompt: "请用一句话确认你能看见图片。",
        frames: [{ imageUrl }],
      })
      const responseText = String(result.content || "").trim()
      return {
        ok: Boolean(responseText),
        checkDepth: responseText ? "model_verified" : "reachability",
        message: responseText ? `${input.label} 视觉能力探测成功。` : `${input.label} 图文服务可达，但返回了空响应。`,
        details: {
          "Base URL": baseUrl,
          模型: model,
          探测图片: imageUrl,
          远程可达: "是",
          视觉能力已验证: responseText ? "是" : "否",
        },
      }
    } catch (error) {
      return {
        ok: false,
        checkDepth: "reachability",
        message: error instanceof Error && error.message.trim() ? error.message : `${input.label} 视觉服务不可达。`,
        details: {
          "Base URL": baseUrl,
          模型: model,
          探测图片: imageUrl,
          远程可达: "否",
          鉴权: "已配置",
        },
      }
    }
  }
}

function modelsEquivalent(left: string, right: string): boolean {
  const leftAliases = buildModelAliases(left)
  const rightAliases = buildModelAliases(right)
  for (const alias of leftAliases) {
    if (rightAliases.has(alias)) {
      return true
    }
  }
  return false
}

function buildModelAliases(rawModelId: string): Set<string> {
  const normalized = String(rawModelId || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase()
  const aliases = new Set<string>()
  if (!normalized) {
    return aliases
  }

  aliases.add(normalized)
  if (normalized.endsWith(":latest")) {
    aliases.add(normalized.slice(0, -":latest".length))
  } else {
    aliases.add(`${normalized}:latest`)
  }

  const slashSegments = normalized.split("/")
  if (slashSegments.length > 2) {
    const withoutRegistry = slashSegments.slice(1).join("/")
    aliases.add(withoutRegistry)
    if (withoutRegistry.endsWith(":latest")) {
      aliases.add(withoutRegistry.slice(0, -":latest".length))
    } else {
      aliases.add(`${withoutRegistry}:latest`)
    }
  }

  const lastTwoSegments = slashSegments.slice(-2).join("/")
  if (lastTwoSegments && lastTwoSegments !== normalized) {
    aliases.add(lastTwoSegments)
    if (lastTwoSegments.endsWith(":latest")) {
      aliases.add(lastTwoSegments.slice(0, -":latest".length))
    } else {
      aliases.add(`${lastTwoSegments}:latest`)
    }
  }

  const tail = slashSegments[slashSegments.length - 1] || normalized
  aliases.add(tail)
  if (tail.endsWith(":latest")) {
    aliases.add(tail.slice(0, -":latest".length))
  } else {
    aliases.add(`${tail}:latest`)
  }

  return aliases
}
