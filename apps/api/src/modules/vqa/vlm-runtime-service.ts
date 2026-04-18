import { AppError } from "../../core/errors.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"

interface ResolvedVlmModelConfig {
  apiBaseUrl: string
  apiKey: string
  model: string
  timeoutSeconds: number
}

interface DescribeFrameInput {
  imageUrl: string
  prompt?: string
}

interface DescribeFramesInput {
  frames: DescribeFrameInput[]
  systemPrompt?: string
  userPrompt: string
}

interface DescribeFramesResponse {
  content: string
  model: string
  raw: unknown
}

export class VlmRuntimeService {
  constructor(
    private readonly modelCatalogRepository: ModelCatalogRepository,
    private readonly llmClient: Pick<OpenAiCompatibleClient, "generateVisionText">,
  ) {}

  async describeFrame(input: {
    imageUrl: string
    prompt?: string
    systemPrompt?: string
    userPrompt?: string
  }): Promise<DescribeFramesResponse> {
    return this.describeFrames({
      frames: [{ imageUrl: input.imageUrl, prompt: input.prompt }],
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt || "请描述这张图中与视频问答相关的关键信息。",
    })
  }

  async describeFrames(input: DescribeFramesInput): Promise<DescribeFramesResponse> {
    const modelConfig = await this.resolveVlmModelConfig()
    const normalizedFrames = input.frames
      .map((item) => ({
        imageUrl: String(item.imageUrl || "").trim(),
        prompt: String(item.prompt || "").trim(),
      }))
      .filter((item) => Boolean(item.imageUrl))

    if (normalizedFrames.length === 0) {
      throw AppError.badRequest("图文描述至少需要一张图片。", {
        code: "VLM_IMAGE_REQUIRED",
      })
    }

    const response = await this.llmClient.generateVisionText({
      apiKey: modelConfig.apiKey,
      baseUrl: modelConfig.apiBaseUrl,
      model: modelConfig.model,
      timeoutSeconds: modelConfig.timeoutSeconds,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      frames: normalizedFrames,
    })

    return {
      content: response.content,
      model: modelConfig.model,
      raw: response.raw,
    }
  }

  private async resolveVlmModelConfig(): Promise<ResolvedVlmModelConfig> {
    const models = await this.modelCatalogRepository.listModels()
    const target = models.items.find((item) =>
      item.id === "vlm-default" &&
      item.enabled &&
      (item.component === "vlm") &&
      (item.provider === "openai_compatible" || item.provider === "ollama") &&
      Boolean(item.api_base_url.trim() && item.api_model.trim() && item.api_key.trim())
    ) || models.items.find((item) =>
      item.enabled &&
      (item.component === "vlm") &&
      (item.provider === "openai_compatible" || item.provider === "ollama") &&
      Boolean(item.api_base_url.trim() && item.api_model.trim() && item.api_key.trim())
    )

    if (!target) {
      throw AppError.conflict("未找到可用的图文模型配置。", {
        code: "VLM_MODEL_NOT_READY",
        hint: "请在模型设置中为 vlm-default 配置可兼容 OpenAI 接口的 base URL、model 和 API Key。",
      })
    }

    return {
      apiBaseUrl: target.api_base_url.trim(),
      apiKey: target.api_key.trim(),
      model: target.api_model.trim(),
      timeoutSeconds: Number(target.api_timeout_seconds) > 0 ? Number(target.api_timeout_seconds) : 120,
    }
  }
}
