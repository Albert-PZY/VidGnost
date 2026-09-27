import type { ModelKind, ProviderProtocol } from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import { requestJson, sendRequest } from "../http.js"
import {
  LANGUAGE_NAMES,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type EmbeddingInput,
  type ProbeInput,
  type ProbeResult,
  type ProtocolAdapter,
  type TranslateInput,
} from "./types.js"

const DEFAULT_TIMEOUT_MS = 120_000
const STREAM_TIMEOUT_MS = 300_000

interface ContentPayload {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
  promptFeedback?: { blockReason?: unknown }
  usageMetadata?: { candidatesTokenCount?: unknown; promptTokenCount?: unknown; totalTokenCount?: unknown }
}

interface ContentStreamChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
  error?: { message?: unknown }
}

interface EmbeddingPayload {
  embeddings?: Array<{ values?: unknown }>
}

interface ModelsPayload {
  models?: unknown
}

/**
 * Google Gemini 协议（`v1beta` REST）。
 * 模型名写在路径里而不是请求体里，认证走 `x-goog-api-key`，
 * 另外它对历史消息的角色用的是 `model` 而不是 `assistant`。
 */
export class GeminiAdapter implements ProtocolAdapter {
  readonly protocol: ProviderProtocol = "gemini"
  readonly kinds: ModelKind[] = ["chat", "vision", "embedding", "translation"]
  readonly streaming = true

  /** 对话与多模态共用 `generateContent`：`images` 非空时给最后一条 user 消息加内联图像。 */
  async chat(input: ChatInput): Promise<ChatResult> {
    const label = `${this.protocol} ${input.model}`
    const payload = await requestJson<ContentPayload>({
      url: `${trimBase(input.baseUrl)}/models/${cleanModel(input.model)}:generateContent`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: 1,
      label,
      body: contentBody(input),
    })

    const parts = payload.payload.candidates?.[0]?.content?.parts
    if (!Array.isArray(parts)) {
      const blocked = normalizeText(payload.payload.promptFeedback?.blockReason)
      throw AppError.unavailable(
        `${label} 未返回候选内容${blocked ? `（被安全策略拦截：${blocked}）` : ""}。`,
        { code: "CHAT_INVALID_RESPONSE" },
      )
    }

    const content = parts
      .map((part) => normalizeText(part?.text))
      .join("")
      .trim()
    if (!content) {
      throw AppError.unavailable(`${label} 未返回文本内容。`, { code: "CHAT_INVALID_RESPONSE" })
    }

    const usage = payload.payload.usageMetadata
    return {
      content,
      usage: {
        inputTokens: toNumber(usage?.promptTokenCount),
        outputTokens: toNumber(usage?.candidatesTokenCount),
        totalTokens: toNumber(usage?.totalTokenCount),
      },
    }
  }

  async *chatStream(input: ChatInput): AsyncGenerator<string, void, unknown> {
    const label = `${this.protocol} ${input.model} (stream)`
    // `alt=sse` 才会返回 SSE 分片，否则是一段可拼接的 JSON 数组流。
    const url = `${trimBase(input.baseUrl)}/models/${cleanModel(input.model)}:streamGenerateContent?alt=sse`
    const response = await sendRequest({
      url,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? STREAM_TIMEOUT_MS,
      retries: 0,
      label,
      body: contentBody(input),
    })

    if (!response.ok) {
      const raw = await response.text().catch(() => "")
      throw AppError.unavailable(`${label} 请求失败：HTTP ${response.status} ${raw.slice(0, 300)}`, {
        code: "CHAT_STREAM_FAILED",
      })
    }

    for await (const data of readSseData(response, label)) {
      let chunk: ContentStreamChunk
      try {
        chunk = JSON.parse(data) as ContentStreamChunk
      } catch {
        continue // 心跳或半截分片，跳过即可
      }
      if (chunk.error?.message) {
        throw AppError.unavailable(`${label} 流式返回错误：${String(chunk.error.message)}`, {
          code: "CHAT_STREAM_FAILED",
        })
      }
      const parts = chunk.candidates?.[0]?.content?.parts
      if (!Array.isArray(parts)) {
        continue
      }
      const delta = parts
        .map((part) => normalizeText(part?.text))
        .join("")
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
    const model = cleanModel(input.model)
    const payload = await requestJson<EmbeddingPayload>({
      url: `${trimBase(input.baseUrl)}/models/${model}:batchEmbedContents`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      retries: 1,
      label,
      body: JSON.stringify({
        requests: input.inputs.map((text) => ({
          // 批接口要求每条请求自带完整模型路径。
          model: `models/${model}`,
          content: { parts: [{ text }] },
          ...(input.dimensions ? { outputDimensionality: input.dimensions } : {}),
        })),
      }),
    })

    const rows = payload.payload.embeddings
    if (!Array.isArray(rows)) {
      throw AppError.unavailable(`${label} 返回格式无效：缺少 embeddings 数组。`, { code: "EMBEDDING_INVALID_RESPONSE" })
    }
    const vectors = rows.map((row) => (Array.isArray(row?.values) ? row.values.map((value) => toNumber(value)) : []))
    if (vectors.length !== input.inputs.length) {
      throw AppError.unavailable(`${label} 返回向量数量不匹配：期望 ${input.inputs.length}，实际 ${vectors.length}。`, {
        code: "EMBEDDING_COUNT_MISMATCH",
      })
    }
    return vectors
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
    const models = Array.isArray(payload.payload.models) ? payload.payload.models : []
    return { latencyMs: Date.now() - started, detail: `可用模型 ${models.length} 个` }
  }
}

/* ------------------------------------------------------------------ 请求构造 */

function contentBody(input: ChatInput): string {
  // `contents` 不认 system 角色，系统提示词走 systemInstruction；多条时按顺序拼接。
  const system = [
    input.systemPrompt,
    ...input.messages.filter((message) => message.role === "system").map((message) => message.content),
  ]
    .filter((text): text is string => Boolean(text))
    .join("\n\n")

  return JSON.stringify({
    contents: buildContents(input),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature: input.temperature,
      maxOutputTokens: input.maxTokens,
      ...(input.responseFormat?.type === "json_object" ? { responseMimeType: "application/json" } : {}),
    },
  })
}

function buildContents(input: ChatInput): Array<Record<string, unknown>> {
  const images = input.images ?? []
  const target = images.length > 0 ? lastUserIndex(input.messages) : -1

  return input.messages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) => message.role !== "system")
    .map(({ index, message }) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts:
        index === target
          ? [{ text: message.content }, ...images.map(imagePart)]
          : [{ text: message.content }],
    }))
}

/** Gemini 只能内联 data URI；公网地址按 Files API 的 file_uri 交给服务端解析。 */
function imagePart(image: string): Record<string, unknown> {
  if (!image.startsWith("data:")) {
    return { file_data: { file_uri: image } }
  }
  const matched = /^data:([^;,]+);base64,(.+)$/s.exec(image)
  if (!matched) {
    throw AppError.unavailable("图像 data URI 缺少 base64 负载，无法作为 inline_data 发送。", {
      code: "VISION_IMAGE_INVALID",
    })
  }
  return {
    inline_data: {
      mime_type: matched[1] ?? "image/jpeg",
      data: (matched[2] ?? "").replace(/\s/g, ""),
    },
  }
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

/** 官方文档里的模型名常带 `models/` 前缀，而路径里已经有一段，重复会 404。 */
function cleanModel(model: string): string {
  return model.replace(/^models\//, "")
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    "x-goog-api-key": apiKey,
    "content-type": "application/json",
  }
}

/** 用量字段缺失时按 0 计，不因为统计信息不全就让整次调用失败。 */
function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
