import type { ModelKind, ProviderProtocol } from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import { requestJson, sendRequest } from "../http.js"
import {
  LANGUAGE_NAMES,
  type ChatInput,
  type ChatMessage,
  type ChatResult,
  type ProbeInput,
  type ProbeResult,
  type ProtocolAdapter,
  type TranslateInput,
} from "./types.js"

const ANTHROPIC_VERSION = "2023-06-01"
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TIMEOUT_MS = 120_000
const STREAM_TIMEOUT_MS = 300_000

interface MessagePayload {
  content?: Array<{ text?: unknown; type?: unknown }>
  usage?: { input_tokens?: unknown; output_tokens?: unknown }
}

interface MessageStreamEvent {
  delta?: { text?: unknown }
  error?: { message?: unknown }
  type?: unknown
}

interface ModelsPayload {
  data?: unknown
}

/**
 * Anthropic Messages 协议。
 * 与 OpenAI 形状的差别集中在三处：认证走 `x-api-key`、`max_tokens` 必填、
 * system 提示词是顶层字段而不是消息数组里的一条。
 */
export class AnthropicAdapter implements ProtocolAdapter {
  readonly protocol: ProviderProtocol = "anthropic"
  readonly kinds: ModelKind[] = ["chat", "vision", "translation"]
  readonly streaming = true

  /** 对话与多模态共用 `/messages`：`images` 非空时给最后一条 user 消息加图像块。 */
  async chat(input: ChatInput): Promise<ChatResult> {
    const label = `${this.protocol} ${input.model}`
    const payload = await requestJson<MessagePayload>({
      url: `${trimBase(input.baseUrl)}/messages`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retries: 1,
      label,
      body: messageBody(input, false),
    })

    const blocks = payload.payload.content
    if (!Array.isArray(blocks)) {
      throw AppError.unavailable(`${label} 返回格式无效：缺少 content 数组。`, { code: "CHAT_INVALID_RESPONSE" })
    }

    // 只取文本块：thinking、tool_use 之类的块不属于正文。
    const content = blocks
      .filter((block) => block?.type === "text")
      .map((block) => normalizeText(block?.text))
      .join("")
      .trim()
    if (!content) {
      throw AppError.unavailable(`${label} 未返回文本内容。`, { code: "CHAT_INVALID_RESPONSE" })
    }

    const inputTokens = toNumber(payload.payload.usage?.input_tokens)
    const outputTokens = toNumber(payload.payload.usage?.output_tokens)
    return {
      content,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    }
  }

  async *chatStream(input: ChatInput): AsyncGenerator<string, void, unknown> {
    const label = `${this.protocol} ${input.model} (stream)`
    const response = await sendRequest({
      url: `${trimBase(input.baseUrl)}/messages`,
      method: "POST",
      headers: jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? STREAM_TIMEOUT_MS,
      retries: 0,
      label,
      body: messageBody(input, true),
    })

    if (!response.ok) {
      const raw = await response.text().catch(() => "")
      throw AppError.unavailable(`${label} 请求失败：HTTP ${response.status} ${raw.slice(0, 300)}`, {
        code: "CHAT_STREAM_FAILED",
      })
    }

    for await (const data of readSseData(response, label)) {
      let event: MessageStreamEvent
      try {
        event = JSON.parse(data) as MessageStreamEvent
      } catch {
        continue // 心跳或半截分片，跳过即可
      }
      if (event.type === "error" || event.error?.message) {
        throw AppError.unavailable(`${label} 流式返回错误：${String(event.error?.message ?? event.type)}`, {
          code: "CHAT_STREAM_FAILED",
        })
      }
      // 只认文本增量：message_start / content_block_start / ping 等事件没有 delta.text。
      if (event.type !== "content_block_delta") {
        continue
      }
      const delta = normalizeText(event.delta?.text)
      if (delta) {
        yield delta
      }
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

function messageBody(input: ChatInput, stream: boolean): string {
  // Messages 接口不接受 system 角色，系统提示词必须提到顶层，多条时按顺序拼接。
  const system = [
    input.systemPrompt,
    ...input.messages.filter((message) => message.role === "system").map((message) => message.content),
  ]
    .filter((text): text is string => Boolean(text))
    .join("\n\n")

  return JSON.stringify({
    model: input.model,
    max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: input.temperature,
    ...(system ? { system } : {}),
    messages: visibleMessages(input),
    ...(stream ? { stream: true } : {}),
  })
}

function visibleMessages(input: ChatInput): Array<Record<string, unknown>> {
  const images = input.images ?? []
  const target = images.length > 0 ? lastUserIndex(input.messages) : -1

  return input.messages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) => message.role !== "system")
    .map(({ index, message }) => ({
      role: message.role,
      content:
        index === target
          ? [...images.map(imageBlock), { type: "text", text: message.content }]
          : message.content,
    }))
}

/** data URI 拆成 base64 源；公网地址交给 URL 源，不需要先下载再编码。 */
function imageBlock(image: string): Record<string, unknown> {
  if (!image.startsWith("data:")) {
    return { type: "image", source: { type: "url", url: image } }
  }
  const matched = /^data:([^;,]+);base64,(.+)$/s.exec(image)
  if (!matched) {
    throw AppError.unavailable("图像 data URI 缺少 base64 负载，无法作为图像块发送。", {
      code: "VISION_IMAGE_INVALID",
    })
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: matched[1] ?? "image/jpeg",
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

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  }
}

/** 用量字段缺失时按 0 计，不因为统计信息不全就让整次调用失败。 */
function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}
