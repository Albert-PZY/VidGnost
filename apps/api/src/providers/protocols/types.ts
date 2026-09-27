import type { ModelKind, ProviderProtocol } from "@vidgnost/contracts"

/**
 * 协议适配器的公共形状。
 *
 * 网关只认识这里的类型，不认识任何具体提供方：它按 `provider.protocol` 取适配器，
 * 再调用与能力同名的方法。适配器没实现某个方法时，由网关统一报「该协议不支持某能力」。
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatInput {
  apiKey: string
  baseUrl: string
  /** 多模态输入：data URI 或公网 URL。存在时按多模态请求构造。 */
  images?: string[]
  maxTokens?: number
  messages: ChatMessage[]
  model: string
  /** 传入 `{ type: "json_object" }` 时要求模型返回纯 JSON。 */
  responseFormat?: { type: "json_object" }
  signal?: AbortSignal
  systemPrompt?: string
  temperature?: number
  timeoutMs?: number
}

export interface ChatResult {
  content: string
  reasoning?: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
}

export interface EmbeddingInput {
  apiKey: string
  baseUrl: string
  dimensions?: number
  inputs: string[]
  model: string
  signal?: AbortSignal
}

export interface RerankInput {
  apiKey: string
  baseUrl: string
  documents: string[]
  model: string
  query: string
  signal?: AbortSignal
  topN?: number
}

export interface RerankResult {
  index: number
  score: number
}

export interface AsrSentence {
  beginTimeMs: number
  endTimeMs: number
  text: string
  words?: Array<{ beginTimeMs: number; endTimeMs: number; text: string }>
}

export interface AsrResult {
  language: string
  sentences: AsrSentence[]
  durationMs: number
  provider: string
}

export interface TranscribeInput {
  apiKey: string
  baseUrl: string
  /** 本地音频文件路径。 */
  filePath: string
  language?: string
  model: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface TranslateInput {
  apiKey: string
  baseUrl: string
  model: string
  signal?: AbortSignal
  targetLanguage: string
  texts: string[]
}

export interface ProbeInput {
  apiKey: string
  baseUrl: string
  model?: string
  signal?: AbortSignal
}

export interface ProbeResult {
  latencyMs: number
  detail: string
}

export interface ProtocolAdapter {
  readonly protocol: ProviderProtocol
  /** 该协议支持的能力，用于登记校验与界面提示。 */
  readonly kinds: ModelKind[]
  readonly streaming: boolean

  chat?(input: ChatInput): Promise<ChatResult>
  chatStream?(input: ChatInput): AsyncGenerator<string, void, unknown>
  embed?(input: EmbeddingInput): Promise<number[][]>
  rerank?(input: RerankInput): Promise<RerankResult[]>
  transcribe?(input: TranscribeInput): Promise<AsrResult>
  translate?(input: TranslateInput): Promise<string[]>
  probe?(input: ProbeInput): Promise<ProbeResult>
}

/** 能力名到适配器方法名的映射，网关与校验共用。 */
export const CAPABILITY_METHOD: Record<ModelKind, keyof ProtocolAdapter> = {
  chat: "chat",
  vision: "chat",
  embedding: "embed",
  rerank: "rerank",
  asr: "transcribe",
  translation: "translate",
}

/** 语言代码到中文名的简表，翻译提示词用。 */
export const LANGUAGE_NAMES: Record<string, string> = {
  zh: "简体中文",
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
  pt: "Português",
}
