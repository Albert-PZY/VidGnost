import { readFile } from "node:fs/promises"
import path from "node:path"

import type { ModelKind, ProviderProtocol } from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import { requestJson, sendRequest } from "../http.js"
import {
  LANGUAGE_NAMES,
  type AsrResult,
  type AsrSentence,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type EmbeddingInput,
  type ProbeInput,
  type ProbeResult,
  type ProtocolAdapter,
  type RerankInput,
  type RerankResult,
  type TranscribeInput,
  type TranslateInput,
} from "./types.js"

const DEFAULT_TIMEOUT_MS = 120_000
const STREAM_TIMEOUT_MS = 300_000

/** 自建端点常按 Content-Type 判断音频格式，缺省 octet-stream 会被直接拒收。 */
const AUDIO_MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
}

interface ChatPayload {
  choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>
  usage?: { completion_tokens?: unknown; prompt_tokens?: unknown; total_tokens?: unknown }
}

interface ChatStreamChunk {
  choices?: Array<{ delta?: { content?: unknown } }>
  error?: { message?: unknown }
}

interface EmbeddingPayload {
  data?: Array<{ embedding?: unknown; index?: unknown }>
}

interface RerankPayload {
  results?: Array<{ index?: unknown; relevance_score?: unknown }>
}

interface TranscriptionPayload {
  duration?: unknown
  language?: unknown
  segments?: Array<{ end?: unknown; start?: unknown; text?: unknown }>
  text?: unknown
}

interface ModelsPayload {
  data?: unknown
}

/**
 * OpenAI 兼容协议：vLLM、Ollama、LM Studio 与多数云厂商都按这套形状暴露端点，
 * 因此这里只按固定路径拼请求，不对提供方做任何特判。
 */
export class OpenAIAdapter implements ProtocolAdapter {
  readonly protocol: ProviderProtocol
  readonly kinds: ModelKind[] = ["chat", "vision", "embedding", "rerank", "asr", "translation"]
  readonly streaming = true

  /**
   * 协议名参与错误信息与转写来源标注。OpenRouter 复用本适配器时传入自己的协议名，
   * 否则报错会显示成 openai，排查时看不出请求实际发给了谁。
   */
  constructor(protocol: ProviderProtocol = "openai") {
    this.protocol = protocol
  }

  /** 对话与多模态共用一条端点：`images` 非空时把最后一条 user 消息换成多模态内容。 */
  async chat(input: ChatInput): Promise<ChatResult> {
    const label = `${this.protocol} ${input.model}`
    const payload = await requestJson<ChatPayload>({
      url: `${trimBase(input.baseUrl)}/chat/completions`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: 1,
      label,
      body: chatBody(input, false),
    })

    const message = payload.payload.choices?.[0]?.message
    const content = normalizeText(message?.content)
    if (!content) {
      throw AppError.unavailable(`${label} 未返回文本内容。`, { code: "CHAT_INVALID_RESPONSE" })
    }

    return {
      content,
      reasoning: normalizeText(message?.reasoning_content) || undefined,
      usage: {
        inputTokens: toNumber(payload.payload.usage?.prompt_tokens),
        outputTokens: toNumber(payload.payload.usage?.completion_tokens),
        totalTokens: toNumber(payload.payload.usage?.total_tokens),
      },
    }
  }

  async *chatStream(input: ChatInput): AsyncGenerator<string, void, unknown> {
    const label = `${this.protocol} ${input.model} (stream)`
    const response = await sendRequest({
      url: `${trimBase(input.baseUrl)}/chat/completions`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? STREAM_TIMEOUT_MS,
      retries: 0,
      label,
      body: chatBody(input, true),
    })

    if (!response.ok) {
      const raw = await response.text().catch(() => "")
      throw AppError.unavailable(`${label} 请求失败：HTTP ${response.status} ${raw.slice(0, 300)}`, {
        code: "CHAT_STREAM_FAILED",
      })
    }

    for await (const data of readSseData(response, label)) {
      let chunk: ChatStreamChunk
      try {
        chunk = JSON.parse(data) as ChatStreamChunk
      } catch {
        continue // 心跳或半截分片，跳过即可
      }
      if (chunk.error?.message) {
        throw AppError.unavailable(`${label} 流式返回错误：${String(chunk.error.message)}`, {
          code: "CHAT_STREAM_FAILED",
        })
      }
      const delta = normalizeText(chunk.choices?.[0]?.delta?.content)
      if (delta) {
        yield delta
      }
    }
  }

  async embed(input: EmbeddingInput): Promise<number[][]> {
    if (input.inputs.length === 0) {
      return []
    }
    const label = `${this.protocol} ${input.model} (embeddings)`
    const payload = await requestJson<EmbeddingPayload>({
      url: `${trimBase(input.baseUrl)}/embeddings`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      retries: 1,
      label,
      body: JSON.stringify({
        model: input.model,
        input: input.inputs,
        ...(input.dimensions ? { dimensions: input.dimensions } : {}),
      }),
    })

    const rows = payload.payload.data
    if (!Array.isArray(rows)) {
      throw AppError.unavailable(`${label} 返回格式无效：缺少 data 数组。`, { code: "EMBEDDING_INVALID_RESPONSE" })
    }

    // 服务端不保证返回顺序，按 index 归位后才能与输入一一对应。
    const vectors = [...rows]
      .sort((left, right) => toNumber(left?.index) - toNumber(right?.index))
      .map((row) => (Array.isArray(row?.embedding) ? row.embedding.map((value) => toNumber(value)) : []))

    if (vectors.length !== input.inputs.length) {
      throw AppError.unavailable(`${label} 返回向量数量不匹配：期望 ${input.inputs.length}，实际 ${vectors.length}。`, {
        code: "EMBEDDING_COUNT_MISMATCH",
      })
    }
    return vectors
  }

  async rerank(input: RerankInput): Promise<RerankResult[]> {
    if (input.documents.length === 0) {
      return []
    }
    const limit = Math.max(1, Math.min(input.topN ?? input.documents.length, input.documents.length))
    const label = `${this.protocol} ${input.model} (rerank)`
    const payload = await requestJson<RerankPayload>({
      url: `${trimBase(input.baseUrl)}/rerank`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      retries: 1,
      label,
      body: JSON.stringify({
        model: input.model,
        query: input.query,
        documents: input.documents.map((text) => ({ text })),
        top_n: limit,
      }),
    })

    const results = payload.payload.results
    if (!Array.isArray(results)) {
      throw AppError.unavailable(`${label} 返回格式无效：缺少 results 数组。`, { code: "RERANK_INVALID_RESPONSE" })
    }
    return results
      .map((item) => ({ index: toNumber(item?.index), score: toNumber(item?.relevance_score) }))
      .filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < input.documents.length)
  }

  async transcribe(input: TranscribeInput): Promise<AsrResult> {
    const label = `${this.protocol} ${input.model} (transcriptions)`
    const fileName = path.basename(input.filePath)
    const buffer = await readFile(input.filePath)

    const form = new FormData()
    form.append("file", new Blob([new Uint8Array(buffer)], { type: audioMimeType(fileName) }), fileName)
    form.append("model", input.model)
    form.append("response_format", "verbose_json")
    form.append("timestamp_granularities[]", "segment")
    if (input.language && input.language !== "auto") {
      form.append("language", input.language)
    }

    const payload = await requestJson<TranscriptionPayload>({
      url: `${trimBase(input.baseUrl)}/audio/transcriptions`,
      method: "POST",
      // 不能手写 Content-Type：multipart 的 boundary 必须由 fetch 生成。
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: 1,
      label,
    })

    const durationMs = Math.round(toNumber(payload.payload.duration) * 1000)
    const rawSegments = payload.payload.segments
    const sentences: AsrSentence[] = Array.isArray(rawSegments)
      ? rawSegments
          .map((segment) => ({
            beginTimeMs: Math.round(toNumber(segment?.start) * 1000),
            endTimeMs: Math.round(toNumber(segment?.end) * 1000),
            text: normalizeText(segment?.text),
          }))
          .filter((sentence) => sentence.text)
      : []

    // 只回 text 的兼容端点没有分段，整段作为一条句子，避免上层丢掉转写结果。
    const wholeText = normalizeText(payload.payload.text)
    const result: AsrSentence[] =
      sentences.length > 0
        ? sentences
        : wholeText
          ? [{ beginTimeMs: 0, endTimeMs: durationMs, text: wholeText }]
          : []

    if (result.length === 0) {
      throw AppError.unavailable(`${label} 未返回转写内容。`, { code: "ASR_INVALID_RESPONSE" })
    }

    return {
      language:
        normalizeText(payload.payload.language) || (input.language && input.language !== "auto" ? input.language : "auto"),
      sentences: result,
      durationMs,
      provider: `${this.protocol}/${input.model}`,
    }
  }

  /** 翻译没有独立端点，借用对话接口：编号后一次请求，要求模型回 JSON 数组。 */
  async translate(input: TranslateInput): Promise<string[]> {
    if (input.texts.length === 0) {
      return []
    }
    const target = LANGUAGE_NAMES[input.targetLanguage] ?? input.targetLanguage
    const result = await this.chat({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      signal: input.signal,
      temperature: 0,
      systemPrompt: `你是专业翻译，把用户给出的每条编号文本翻译成${target}，只返回 JSON 字符串数组，不添加解释。`,
      messages: [{ role: "user", content: translationPrompt(target, input.texts) }],
    })
    return parseTranslations(result.content, input.texts.length)
  }

  async probe(input: ProbeInput): Promise<ProbeResult> {
    const started = Date.now()
    const payload = await requestJson<ModelsPayload>({
      url: `${trimBase(input.baseUrl)}/models`,
      method: "GET",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: 30_000,
      retries: 0,
      label: `${this.protocol} models`,
    })
    const models = Array.isArray(payload.payload.data) ? payload.payload.data : []
    return { latencyMs: Date.now() - started, detail: `可用模型 ${models.length} 个` }
  }
}

/* ------------------------------------------------------------------ 请求构造 */

function chatBody(input: ChatInput, stream: boolean): string {
  return JSON.stringify({
    model: input.model,
    messages: chatMessages(input),
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
    ...(stream ? { stream: true } : {}),
  })
}

function chatMessages(input: ChatInput): Array<Record<string, unknown>> {
  const images = input.images ?? []
  const target = images.length > 0 ? lastUserIndex(input.messages) : -1
  const messages: Array<Record<string, unknown>> = []

  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt })
  }
  input.messages.forEach((message, index) => {
    messages.push({
      role: message.role,
      content:
        index === target
          ? [
              { type: "text", text: message.content },
              ...images.map((url) => ({ type: "image_url", image_url: { url } })),
            ]
          : message.content,
    })
  })
  return messages
}

function lastUserIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index
    }
  }
  return -1
}

function translationPrompt(target: string, texts: string[]): string {
  const numbered = texts.map((text, index) => `${index + 1}. ${text}`).join("\n")
  return `把下面 ${texts.length} 条编号文本逐条翻译成${target}，保持顺序与条数，返回 JSON 数组，例如 ["第一条译文","第二条译文"]：\n${numbered}`
}

/* ------------------------------------------------------------------ 响应解析 */

/** 取出一个 SSE 事件块里的全部 `data:` 负载；空行、注释与 `[DONE]` 一律跳过。 */
function* sseData(event: string): Generator<string, void, unknown> {
  for (const line of event.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) {
      continue
    }
    const data = trimmed.slice(5).trim()
    if (!data || data === "[DONE]") {
      continue
    }
    yield data
  }
}

/** 逐段产出流式响应里的 `data:` 负载。 */
async function* readSseData(response: Response, label: string): AsyncGenerator<string, void, unknown> {
  if (!response.body) {
    throw AppError.unavailable(`${label} 流式响应没有响应体。`, { code: "CHAT_STREAM_FAILED" })
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ""
      for (const event of events) {
        for (const data of sseData(event)) {
          yield data
        }
      }
    }
    // 有些服务端在最后一条事件后不再补空行，收尾补扫一次，避免丢掉最后一段增量。
    for (const data of sseData(buffer)) {
      yield data
    }
  } finally {
    // 调用方提前 break 时释放连接，避免 SSE 挂在后台继续下载。
    await reader.cancel().catch(() => undefined)
  }
}

/** JSON 数组优先，解析失败按行回退；两种形状都对不上就报错，避免静默错位。 */
function parseTranslations(content: string, expected: number): string[] {
  const start = content.indexOf("[")
  const end = content.lastIndexOf("]")
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(content.slice(start, end + 1))
      if (Array.isArray(parsed) && parsed.length === expected && parsed.every((item) => typeof item === "string")) {
        return parsed as string[]
      }
    } catch {
      // 落到按行拆分
    }
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:\d+[.、)]|[-*])\s*/, "")
        .replace(/^["“']|["”']$/g, "")
        .trim(),
    )
    .filter(Boolean)
  if (lines.length === expected) {
    return lines
  }
  throw AppError.unavailable(`翻译返回条数与原文不一致：期望 ${expected}，实际 ${lines.length}。`, {
    code: "TRANSLATION_INVALID_RESPONSE",
  })
}

function normalizeText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim()
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "")
        }
        return ""
      })
      .join("")
      .trim()
  }
  return ""
}

/* -------------------------------------------------------------------- 工具 */

/** baseUrl 由用户填写，视为 API 根路径，这里只负责去掉尾部斜杠。 */
function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "")
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }
}

function audioMimeType(fileName: string): string {
  return AUDIO_MIME_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream"
}

/** 用量字段缺失时按 0 计，不因为统计信息不全就让整次调用失败。 */
function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
