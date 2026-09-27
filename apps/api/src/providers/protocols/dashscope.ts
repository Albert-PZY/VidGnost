import type { ModelKind } from "@vidgnost/contracts"

import { DashScopeProvider } from "../dashscope.js"
import { requestJson } from "../http.js"
import type {
  AsrResult,
  ChatInput,
  ChatResult,
  EmbeddingInput,
  ProbeInput,
  ProbeResult,
  ProtocolAdapter,
  TranscribeInput,
  TranslateInput,
} from "./types.js"

/**
 * DashScope 原生协议。
 *
 * 底层客户端把 baseUrl 存在构造参数里（对话走兼容模式、转写与翻译走原生端点），
 * 而 baseUrl 现在由用户按提供方配置，因此这里按 baseUrl 缓存实例；
 * 顺带保住客户端的 ASR 上传缓存，避免每次转写都重新申请上传策略。
 */
export class DashScopeAdapter implements ProtocolAdapter {
  readonly protocol = "dashscope" as const
  readonly kinds: ModelKind[] = ["chat", "vision", "embedding", "asr", "translation"]
  readonly streaming = true

  private readonly clients = new Map<string, DashScopeProvider>()

  constructor(private readonly options: { requestTimeoutMs: number; uploadModel: string }) {}

  private client(baseUrl: string): DashScopeProvider {
    const key = baseUrl || "https://dashscope.aliyuncs.com"
    let client = this.clients.get(key)
    if (!client) {
      client = new DashScopeProvider({
        baseUrl: key,
        uploadModel: this.options.uploadModel,
        requestTimeoutMs: this.options.requestTimeoutMs,
      })
      this.clients.set(key, client)
    }
    return client
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    if (input.images?.length) {
      const content = await this.client(input.baseUrl).vision({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        images: input.images,
        maxTokens: input.maxTokens,
        model: input.model,
        prompt: lastUserMessage(input),
        signal: input.signal,
        systemPrompt: input.systemPrompt,
      })
      return { content, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
    }
    return this.client(input.baseUrl).chat({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      maxTokens: input.maxTokens,
      messages: input.messages,
      model: input.model,
      responseFormat: input.responseFormat,
      signal: input.signal,
      temperature: input.temperature,
      timeoutMs: input.timeoutMs,
    })
  }

  async *chatStream(input: ChatInput): AsyncGenerator<string, void, unknown> {
    yield* this.client(input.baseUrl).chatStream({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      maxTokens: input.maxTokens,
      messages: input.messages,
      model: input.model,
      signal: input.signal,
      temperature: input.temperature,
      timeoutMs: input.timeoutMs,
    })
  }

  async embed(input: EmbeddingInput): Promise<number[][]> {
    return this.client(input.baseUrl).embed({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      dimensions: input.dimensions,
      inputs: input.inputs,
      model: input.model,
      signal: input.signal,
    })
  }

  async translate(input: TranslateInput): Promise<string[]> {
    return this.client(input.baseUrl).translate({
      apiKey: input.apiKey,
      texts: input.texts,
      targetLang: input.targetLanguage,
      signal: input.signal,
    })
  }

  async transcribe(input: TranscribeInput): Promise<AsrResult> {
    const client = this.client(input.baseUrl)
    const taskId = await client.submitTranscription({
      apiKey: input.apiKey,
      filePath: input.filePath,
      language: input.language,
      model: input.model,
      signal: input.signal,
    })
    return client.pollTranscription({
      apiKey: input.apiKey,
      signal: input.signal,
      taskId,
    })
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const started = Date.now()
    const payload = await requestJson<{ data?: unknown[] }>({
      url: `${(input.baseUrl || "https://dashscope.aliyuncs.com").replace(/\/+$/, "")}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(
        this.options.uploadModel,
      )}`,
      method: "GET",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      timeoutMs: 30_000,
      retries: 0,
      label: "DashScope upload policy",
    })
    const hasPolicy = Boolean((payload.payload as { data?: { policy?: string } }).data?.policy)
    return { latencyMs: Date.now() - started, detail: hasPolicy ? "上传通道可用" : "上传通道返回缺少策略" }
  }
}

function lastUserMessage(input: ChatInput): string {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index]
    if (message?.role === "user") {
      return message.content
    }
  }
  return ""
}
