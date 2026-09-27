import type {
  CheckResult,
  ModelCatalogEntry,
  ModelRole,
  ProviderConfig,
  ProviderId,
} from "@vidgnost/contracts"

import { AppError, describeError } from "../core/errors.js"
import { logger } from "../core/logger.js"
import type { AppConfig } from "../core/config.js"
import { DEFAULT_ROUTES, EMBEDDING_DIMENSIONS, MODEL_CATALOG, customModelsToCatalog } from "./catalog.js"
import { LocalWhisperProvider, type LocalAsrResult } from "./local-whisper.js"
import {
  assertCapability,
  createAdapters,
  supportsCapability,
  type AsrResult,
  type ChatMessage,
  type ChatResult,
  type ProtocolAdapter,
} from "./protocols/index.js"
import { SettingsStore, type ProviderRecord, type ResolvedRoute } from "./settings-store.js"

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
 * 模型网关：把「角色」解析为具体提供方与模型，再按提供方声明的协议取适配器。
 * 业务层因此既不依赖模型名，也不依赖提供方 id。
 */
export class ModelGateway {
  readonly settings: SettingsStore
  readonly localWhisper: LocalWhisperProvider

  private readonly adapters: Record<string, ProtocolAdapter>
  private readonly config: AppConfig

  constructor(config: AppConfig) {
    this.config = config
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
    this.localWhisper = new LocalWhisperProvider()
    this.adapters = createAdapters({
      readSettings: () => this.settings.getSettings(),
      requestTimeoutMs: config.requestTimeoutMs,
      siteName: "VidGnost",
      uploadModel: "qwen-audio-3.1-asr-flash-filetrans",
      whisper: this.localWhisper,
    })
  }

  /** 按角色解析路由链（主 + 兜底）。 */
  async chain(role: ModelRole): Promise<ResolvedRoute[]> {
    const chain = await this.settings.resolveWithFallback(role)
    if (chain.length === 0) {
      throw AppError.unavailable(`模型角色 ${role} 未配置。`, { code: "MODEL_ROLE_MISSING" })
    }
    return chain
  }

  /** 内置目录 + 用户登记的模型，供目录接口与健康检查共用。 */
  async catalogue(): Promise<ModelCatalogEntry[]> {
    const providers = await this.settings.getProviders()
    return [...MODEL_CATALOG, ...providers.flatMap((provider) => customModelsToCatalog(provider))]
  }

  /* ------------------------------------------------------------- 文本生成 */

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

  /** 流式文本生成。协议未实现流式时回退为一次性返回。 */
  async *chatStream(role: ModelRole, options: ChatOptions): AsyncGenerator<string, void, unknown> {
    const route = (await this.chain(role))[0]
    const { adapter, provider, apiKey, baseUrl } = await this.resolveAdapter(route.provider)

    if (!supportsCapability(adapter, "chat") || !adapter.chatStream) {
      const result = await this.runChat(route, options)
      yield result.content
      return
    }

    yield* adapter.chatStream({
      apiKey,
      baseUrl,
      maxTokens: options.maxTokens ?? route.maxTokens,
      messages: buildMessages(options),
      model: route.model,
      signal: options.signal,
      temperature: options.temperature ?? route.temperature,
      timeoutMs: options.timeoutMs,
    })
    void provider
  }

  /* --------------------------------------------------------------- 能力 */

  async embed(input: { inputs: string[]; signal?: AbortSignal }): Promise<{ vectors: number[][]; dimensions: number; model: string }> {
    const route = (await this.chain("embedding"))[0]
    const { adapter, provider, apiKey, baseUrl } = await this.resolveAdapter(route.provider)
    assertCapability(adapter, "embedding", provider.label)

    const dimensions = dimensionsFor(provider, route.model)
    const batches = chunkStrings(input.inputs, 16)
    const vectors: number[][] = []
    for (const batch of batches) {
      const result = await adapter.embed!({
        apiKey,
        baseUrl,
        dimensions,
        inputs: batch,
        model: route.model,
        signal: input.signal,
      })
      vectors.push(...result)
    }
    return { vectors, dimensions: vectors[0]?.length || dimensions || 0, model: route.model }
  }

  async vision(input: { images: string[]; prompt: string; signal?: AbortSignal; systemPrompt?: string }): Promise<string> {
    const route = (await this.chain("vision.primary"))[0]
    const { adapter, provider, apiKey, baseUrl } = await this.resolveAdapter(route.provider)
    assertCapability(adapter, "vision", provider.label)

    const result = await adapter.chat!({
      apiKey,
      baseUrl,
      images: input.images,
      maxTokens: route.maxTokens ?? 1200,
      messages: [{ role: "user", content: input.prompt }],
      model: route.model,
      signal: input.signal,
      systemPrompt: input.systemPrompt,
      temperature: route.temperature,
    })
    return result.content
  }

  async translate(input: {
    signal?: AbortSignal
    sourceLang?: string
    targetLang: string
    texts: string[]
  }): Promise<string[]> {
    const route = (await this.chain("translate"))[0]
    const { adapter, provider, apiKey, baseUrl } = await this.resolveAdapter(route.provider)
    assertCapability(adapter, "translation", provider.label)

    const batches = chunkStrings(input.texts, 20)
    const output: string[] = []
    for (const batch of batches) {
      const result = await adapter.translate!({
        apiKey,
        baseUrl,
        model: route.model,
        signal: input.signal,
        targetLanguage: input.targetLang,
        texts: batch,
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

    try {
      const { adapter, provider, apiKey, baseUrl } = await this.resolveAdapter(route.provider)
      assertCapability(adapter, "rerank", provider.label)
      const results = await adapter.rerank!({
        apiKey,
        baseUrl,
        documents: input.documents,
        model: route.model,
        query: input.query,
        signal: input.signal,
        topN: input.topN,
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
    const { adapter, provider, apiKey, baseUrl } = await this.resolveAdapter(route.provider)
    assertCapability(adapter, "asr", provider.label)
    input.onProgress?.(`使用 ${provider.label} 转写…`)
    const result = await adapter.transcribe!({
      apiKey,
      baseUrl,
      filePath: input.filePath,
      language: input.language,
      model: route.model,
      signal: input.signal,
    })
    return { ...result, model: route.model }
  }

  /** 本地离线转写，走本地 worker，不经过在线适配器。 */
  async transcribeLocal(input: {
    filePath: string
    language?: string
    onProgress?: (message: string) => void
    onSegment?: (segment: { start: number; end: number; text: string }) => void
    signal?: AbortSignal
  }): Promise<LocalAsrResult> {
    const settings = await this.settings.getSettings()
    if (!settings.whisper.modelDir) {
      throw AppError.unavailable("本地 Whisper 模型目录未配置。", {
        code: "LOCAL_WHISPER_MODEL_MISSING",
        hint: "在「模型 → 本地模型」里填写 CTranslate2 模型目录。",
      })
    }
    return this.localWhisper.transcribe({
      audioPath: input.filePath,
      computeType: settings.whisper.computeType,
      device: settings.whisper.device,
      language: input.language,
      modelDir: settings.whisper.modelDir,
      onSegment: input.onSegment,
      onStatus: input.onProgress,
      pythonExecutable: settings.whisper.pythonExecutable,
      signal: input.signal,
    })
  }

  /* --------------------------------------------------------------- 凭据 */

  async apiKeyFor(provider: ProviderId): Promise<string> {
    const config = await this.requireProvider(provider)
    const key = this.settings.resolveApiKey(config)
    if (!key) {
      throw AppError.unavailable(`提供方 ${config.label} 缺少 API Key。`, {
        code: "PROVIDER_KEY_MISSING",
        hint: config.auth.envVar
          ? `请设置环境变量 ${config.auth.envVar}，或在模型页填写内联密钥。`
          : "请在模型页填写密钥。",
      })
    }
    return key
  }

  async baseUrlFor(provider: ProviderId): Promise<string> {
    const config = await this.requireProvider(provider)
    if (!config.baseUrl) {
      throw AppError.unavailable(`提供方 ${config.label} 缺少 Base URL。`, { code: "PROVIDER_BASE_URL_MISSING" })
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

  /** 单个提供方的连通性检查，供运行时自检使用。入参是含内联密钥的内部记录。 */
  async probeProvider(provider: ProviderRecord): Promise<CheckResult[]> {
    const checks: CheckResult[] = []
    const adapter = this.adapterFor(provider.protocol)

    if (provider.protocol !== "local") {
      const key = this.settings.resolveApiKey(provider)
      if (!key) {
        return [{ name: "凭据", ok: false, detail: provider.auth.envVar ? `缺少环境变量 ${provider.auth.envVar}` : "未填写密钥" }]
      }
      if (!adapter.probe) {
        return [{ name: "协议探针", ok: true, detail: `${adapter.protocol} 没有探针，跳过` }]
      }
      try {
        const started = Date.now()
        const result = await adapter.probe({ apiKey: key, baseUrl: provider.baseUrl })
        checks.push({ name: "连通性", ok: true, detail: result.detail, latencyMs: Date.now() - started })
      } catch (error) {
        checks.push({ name: "连通性", ok: false, detail: describeError(error) })
      }
      return checks
    }

    const settings = await this.settings.getSettings()
    checks.push({
      name: "Whisper 模型目录",
      ok: Boolean(settings.whisper.modelDir),
      detail: settings.whisper.modelDir || "未配置",
    })
    return checks
  }

  /* ------------------------------------------------------------- 内部 */

  private adapterFor(protocol: ProviderConfig["protocol"]): ProtocolAdapter {
    const adapter = this.adapters[protocol]
    if (!adapter) {
      throw AppError.unavailable(`未知协议：${protocol}`, { code: "PROVIDER_PROTOCOL_UNKNOWN" })
    }
    return adapter
  }

  private async requireProvider(id: ProviderId): Promise<ProviderRecord> {
    const config = await this.settings.getProvider(id)
    if (!config) {
      throw AppError.unavailable(`提供方 ${id} 未配置。`, { code: "PROVIDER_MISSING" })
    }
    if (!config.enabled) {
      throw AppError.unavailable(`提供方 ${config.label} 已禁用。`, { code: "PROVIDER_DISABLED" })
    }
    return config
  }

  private async resolveAdapter(providerId: ProviderId): Promise<{
    adapter: ProtocolAdapter
    apiKey: string
    baseUrl: string
    provider: ProviderRecord
  }> {
    const provider = await this.requireProvider(providerId)
    return {
      adapter: this.adapterFor(provider.protocol),
      apiKey: provider.protocol === "local" ? "" : await this.apiKeyFor(providerId),
      baseUrl: provider.baseUrl,
      provider,
    }
  }

  private async runChat(route: ResolvedRoute, options: ChatOptions): Promise<ChatResult> {
    const { adapter, provider, apiKey, baseUrl } = await this.resolveAdapter(route.provider)
    assertCapability(adapter, "chat", provider.label)
    return adapter.chat!({
      apiKey,
      baseUrl,
      maxTokens: options.maxTokens ?? route.maxTokens,
      messages: buildMessages(options),
      model: route.model,
      responseFormat: options.responseFormat,
      signal: options.signal,
      temperature: options.temperature ?? route.temperature,
      timeoutMs: options.timeoutMs,
    })
  }
}

function buildMessages(options: ChatOptions): ChatMessage[] {
  return [
    ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
    { role: "user" as const, content: options.userPrompt },
  ]
}

/** 向量维度：自定义模型登记的优先，其次内置表。 */
function dimensionsFor(provider: ProviderRecord, modelId: string): number | undefined {
  const custom = provider.models.find((model) => model.id === modelId)
  return custom?.dimensions ?? EMBEDDING_DIMENSIONS[modelId]
}

function chunkStrings(items: string[], size: number): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}
