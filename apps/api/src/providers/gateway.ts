import type { ModelRole, ProviderId } from "@vidgnost/contracts"

import { AppError, describeError } from "../core/errors.js"
import { logger } from "../core/logger.js"
import type { AppConfig } from "../core/config.js"
import { DEFAULT_ROUTES, EMBEDDING_DIMENSIONS, MODEL_CATALOG } from "./catalog.js"
import { DashScopeProvider, type AsrResult, type ChatMessage, type ChatResult } from "./dashscope.js"
import { LocalWhisperProvider } from "./local-whisper.js"
import { OpenRouterProvider } from "./openrouter.js"
import { SettingsStore, type ResolvedRoute } from "./settings-store.js"

export interface GatewayCallMeta {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ChatOptions {
  maxTokens?: number
  responseFormat?: { type: "json_object" }
  signal?: AbortSignal
  systemPrompt?: string
  temperature?: number
  timeoutMs?: number
  userPrompt: string
}

const log = logger.child({ scope: "gateway" })

/**
 * 模型网关：把「角色」解析为具体提供方与模型，统一处理密钥、超时、重试与兜底。
 * 所有在线模型调用都必须经过这里，避免业务层直接依赖具体模型名。
 */
export class ModelGateway {
  readonly dashscope: DashScopeProvider
  readonly openrouter: OpenRouterProvider
  readonly localWhisper: LocalWhisperProvider
  readonly settings: SettingsStore

  constructor(private readonly config: AppConfig) {
    this.settings = new SettingsStore(config, {
      settings: {
        defaultPreset: "balanced",
        defaultLanguage: "auto",
        defaultAsr: "auto",
        defaultVision: false,
        defaultProofread: false,
        defaultTranslateTo: null,
        whisper: {
          pythonExecutable: config.whisperPython,
          model: "large-v3",
          device: config.whisperDevice,
          computeType: config.whisperComputeType,
          modelDir: config.whisperModelDir,
        },
        maxConcurrentTasks: config.maxConcurrentTasks,
        keepIntermediateMedia: false,
        updatedAt: new Date().toISOString(),
      },
      routes: DEFAULT_ROUTES,
    })
    this.dashscope = new DashScopeProvider({
      baseUrl: config.dashscopeBaseUrl,
      uploadModel: "qwen-audio-3.1-asr-flash-filetrans",
      requestTimeoutMs: config.requestTimeoutMs,
    })
    this.openrouter = new OpenRouterProvider({
      baseUrl: config.openrouterBaseUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      siteName: "VidGnost",
    })
    this.localWhisper = new LocalWhisperProvider()
  }

  /** 按角色解析路由链（主 + 兜底）。 */
  async chain(role: ModelRole): Promise<ResolvedRoute[]> {
    const chain = await this.settings.resolveWithFallback(role)
    if (chain.length === 0) {
      throw AppError.unavailable(`模型角色 ${role} 未配置。`, { code: "MODEL_ROLE_MISSING" })
    }
    return chain
  }

  /** 一次文本生成。失败时按路由链兜底。 */
  async chat(role: ModelRole, options: ChatOptions): Promise<{ text: string; usage: ChatResult["usage"]; model: string }> {
    const chain = await this.chain(role)
    const errors: string[] = []

    for (const route of chain) {
      try {
        const result = await this.runChat(route, options)
        return { text: result.content, usage: result.usage, model: route.model }
      } catch (error) {
        errors.push(`${route.provider}/${route.model}: ${describeError(error)}`)
        log.warn({ role, provider: route.provider, model: route.model, error: describeError(error) }, "chat failed")
      }
    }

    throw AppError.unavailable(`模型调用失败（角色 ${role}）：${errors.join(" | ")}`, { code: "MODEL_CHAIN_FAILED" })
  }

  /** 流式文本生成。流式链路不重试，失败直接向上抛。 */
  async *chatStream(role: ModelRole, options: ChatOptions): AsyncGenerator<string, void, unknown> {
    const chain = await this.chain(role)
    const route = chain[0]
    const messages: ChatMessage[] = [
      ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
      { role: "user" as const, content: options.userPrompt },
    ]

    if (route.provider !== "dashscope") {
      const result = await this.chat(role, options)
      yield result.text
      return
    }

    const apiKey = await this.apiKeyFor(route.provider)
    yield* this.dashscope.chatStream({
      apiKey,
      baseUrl: this.config.dashscopeBaseUrl,
      messages,
      model: route.model,
      temperature: options.temperature ?? route.temperature,
      maxTokens: options.maxTokens ?? route.maxTokens,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    })
  }

  async embed(input: { inputs: string[]; signal?: AbortSignal }): Promise<{ vectors: number[][]; dimensions: number; model: string }> {
    const route = (await this.chain("embedding"))[0]
    if (route.provider === "local") {
      throw AppError.unavailable("本地向量模型未启用。", { code: "EMBEDDING_LOCAL_UNSUPPORTED" })
    }
    const apiKey = await this.apiKeyFor(route.provider)
    const dimensions = EMBEDDING_DIMENSIONS[route.model]
    const baseUrl = await this.baseUrlFor(route.provider)

    const batches = chunkStrings(input.inputs, 16)
    const vectors: number[][] = []
    for (const batch of batches) {
      const result = await this.dashscope.embed({
        apiKey,
        baseUrl,
        inputs: batch,
        model: route.model,
        dimensions,
        signal: input.signal,
      })
      vectors.push(...result)
    }
    return { vectors, dimensions: vectors[0]?.length || dimensions || 0, model: route.model }
  }

  async vision(input: { images: string[]; prompt: string; signal?: AbortSignal; systemPrompt?: string }): Promise<string> {
    const route = (await this.chain("vision.primary"))[0]
    if (route.provider === "local") {
      throw AppError.unavailable("视觉模型未配置在线提供方。", { code: "VISION_PROVIDER_MISSING" })
    }
    const apiKey = await this.apiKeyFor(route.provider)
    const baseUrl = await this.baseUrlFor(route.provider)
    return this.dashscope.vision({
      apiKey,
      baseUrl,
      images: input.images,
      model: route.model,
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      signal: input.signal,
      maxTokens: route.maxTokens ?? 1200,
    })
  }

  async translate(input: {
    signal?: AbortSignal
    sourceLang?: string
    targetLang: string
    texts: string[]
  }): Promise<string[]> {
    const route = (await this.chain("translate"))[0]
    const apiKey = await this.apiKeyFor(route.provider)
    const baseUrl = await this.baseUrlFor(route.provider)
    const batches = chunkStrings(input.texts, 20)
    const output: string[] = []
    for (const batch of batches) {
      const result = await this.dashscope.translate({
        apiKey,
        texts: batch,
        targetLang: input.targetLang,
        sourceLang: input.sourceLang,
        signal: input.signal,
      })
      output.push(...result)
    }
    return output
  }

  async rerank(input: { documents: string[]; query: string; signal?: AbortSignal; topN?: number }): Promise<{
    results: Array<{ index: number; score: number }>
    model: string
    degradation?: string
  }> {
    let route: ResolvedRoute
    try {
      route = (await this.chain("rerank"))[0]
    } catch (error) {
      return { results: [], model: "", degradation: describeError(error) }
    }
    if (route.provider === "local") {
      return { results: [], model: route.model, degradation: "重排模型为本地运行时，当前未实现。" }
    }
    const apiKey = await this.apiKeyFor(route.provider)
    const baseUrl = await this.baseUrlFor(route.provider)
    try {
      const results = await this.openrouter.rerank({
        apiKey,
        baseUrl,
        model: route.model,
        query: input.query,
        documents: input.documents,
        topN: input.topN,
        signal: input.signal,
      })
      return { results, model: route.model }
    } catch (error) {
      log.warn({ error: describeError(error) }, "rerank failed, fallback to rrf order")
      return { results: [], model: route.model, degradation: describeError(error) }
    }
  }

  /** 在线文件级转写。 */
  async transcribeOnline(input: {
    filePath: string
    language?: string
    onProgress?: (message: string) => void
    signal?: AbortSignal
  }): Promise<AsrResult & { model: string }> {
    const route = (await this.chain("asr.online"))[0]
    const apiKey = await this.apiKeyFor(route.provider)
    input.onProgress?.("上传音频到百炼临时空间…")
    const taskId = await this.dashscope.submitTranscription({
      apiKey,
      filePath: input.filePath,
      model: route.model,
      language: input.language,
      signal: input.signal,
    })
    input.onProgress?.(`转写任务已提交（${taskId.slice(0, 8)}），等待队列…`)
    const result = await this.dashscope.pollTranscription({
      apiKey,
      taskId,
      signal: input.signal,
      onTick: (status) => input.onProgress?.(`转写状态：${status}`),
    })
    return { ...result, model: route.model }
  }

  async apiKeyFor(provider: ProviderId): Promise<string> {
    const providers = await this.settings.getProviders()
    const config = providers.find((item) => item.id === provider)
    if (!config) {
      throw AppError.unavailable(`提供方 ${provider} 未配置。`, { code: "PROVIDER_MISSING" })
    }
    if (!config.enabled) {
      throw AppError.unavailable(`提供方 ${config.label} 已禁用。`, { code: "PROVIDER_DISABLED" })
    }
    const key = this.settings.resolveApiKey(config)
    if (!key) {
      throw AppError.unavailable(`提供方 ${config.label} 缺少 API Key。`, {
        code: "PROVIDER_KEY_MISSING",
        hint: config.auth.envVar
          ? `请设置环境变量 ${config.auth.envVar}，或在设置页填写内联密钥。`
          : "请在设置页填写密钥。",
      })
    }
    return key
  }

  async baseUrlFor(provider: ProviderId): Promise<string> {
    const providers = await this.settings.getProviders()
    const config = providers.find((item) => item.id === provider)
    if (!config?.baseUrl) {
      throw AppError.unavailable(`提供方 ${provider} 缺少 baseUrl。`, { code: "PROVIDER_BASE_URL_MISSING" })
    }
    return config.baseUrl
  }

  async hasCredential(provider: ProviderId): Promise<boolean> {
    try {
      await this.apiKeyFor(provider)
      return true
    } catch {
      return false
    }
  }

  private async runChat(route: ResolvedRoute, options: ChatOptions): Promise<ChatResult> {
    const messages: ChatMessage[] = [
      ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
      { role: "user" as const, content: options.userPrompt },
    ]

    if (route.provider === "dashscope") {
      const apiKey = await this.apiKeyFor(route.provider)
      return this.dashscope.chat({
        apiKey,
        baseUrl: this.config.dashscopeBaseUrl,
        messages,
        model: route.model,
        temperature: options.temperature ?? route.temperature,
        maxTokens: options.maxTokens ?? route.maxTokens,
        responseFormat: options.responseFormat,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      })
    }

    throw AppError.unavailable(`提供方 ${route.provider} 暂不支持文本生成。`, { code: "PROVIDER_CHAT_UNSUPPORTED" })
  }
}

export function catalogFor(provider: ProviderId) {
  return MODEL_CATALOG.filter((entry) => entry.provider === provider)
}

function chunkStrings(items: string[], size: number): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}
