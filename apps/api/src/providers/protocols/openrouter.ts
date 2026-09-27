import type { ModelKind } from "@vidgnost/contracts"

import { OpenRouterProvider } from "../openrouter.js"
import { OpenAIAdapter } from "./openai.js"
import type {
  ChatInput,
  ChatResult,
  EmbeddingInput,
  ProbeInput,
  ProbeResult,
  ProtocolAdapter,
  RerankInput,
  RerankResult,
  TranslateInput,
} from "./types.js"

/**
 * OpenRouter 协议。
 *
 * 对话、向量化与翻译和 OpenAI 兼容端点完全一致，直接复用 OpenAI 适配器；
 * 只有重排走 OpenRouter 原生的 `/rerank`，并按它的要求带上站点标识头。
 */
export class OpenRouterAdapter implements ProtocolAdapter {
  readonly protocol = "openrouter" as const
  readonly kinds: ModelKind[] = ["chat", "vision", "embedding", "rerank", "translation"]
  readonly streaming = true

  private readonly compatible = new OpenAIAdapter("openrouter")
  private readonly rerankClients = new Map<string, OpenRouterProvider>()

  constructor(private readonly options: { requestTimeoutMs: number; siteName: string }) {}

  private rerankClient(baseUrl: string): OpenRouterProvider {
    const key = baseUrl || "https://openrouter.ai/api/v1"
    let client = this.rerankClients.get(key)
    if (!client) {
      client = new OpenRouterProvider({
        baseUrl: key,
        requestTimeoutMs: this.options.requestTimeoutMs,
        siteName: this.options.siteName,
      })
      this.rerankClients.set(key, client)
    }
    return client
  }

  chat(input: ChatInput): Promise<ChatResult> {
    return this.compatible.chat(input)
  }

  chatStream(input: ChatInput): AsyncGenerator<string, void, unknown> {
    return this.compatible.chatStream(input)
  }

  embed(input: EmbeddingInput): Promise<number[][]> {
    return this.compatible.embed(input)
  }

  translate(input: TranslateInput): Promise<string[]> {
    return this.compatible.translate(input)
  }

  async rerank(input: RerankInput): Promise<RerankResult[]> {
    return this.rerankClient(input.baseUrl).rerank({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      documents: input.documents,
      model: input.model,
      query: input.query,
      signal: input.signal,
      topN: input.topN,
      siteName: this.options.siteName,
    })
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const result = await this.rerankClient(input.baseUrl).probe(input.apiKey)
    return { latencyMs: result.latencyMs, detail: `可用模型 ${result.modelCount} 个` }
  }
}
