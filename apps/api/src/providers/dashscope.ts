import { readFile } from "node:fs/promises"
import path from "node:path"

import { AppError } from "../core/errors.js"
import { delay, requestJson, sendRequest } from "./http.js"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatInput {
  apiKey: string
  baseUrl: string
  maxTokens?: number
  messages: ChatMessage[]
  model: string
  /** 传入 `{ type: "json_object" }` 时要求模型返回纯 JSON。 */
  responseFormat?: { type: "json_object" }
  signal?: AbortSignal
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

export interface VisionInput {
  apiKey: string
  baseUrl: string
  /** data URI 或公网 URL。 */
  images: string[]
  maxTokens?: number
  model: string
  prompt: string
  signal?: AbortSignal
  systemPrompt?: string
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

interface ChatCompletionPayload {
  choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  error?: { message?: string; code?: string }
  message?: string
}

interface EmbeddingPayload {
  data?: Array<{ embedding?: number[]; index?: number }>
  usage?: { total_tokens?: number }
}

const COMPAT_PATH = "/compatible-mode/v1"

/**
 * 记录不接受 `enable_thinking` 参数的模型（例如 GLM 系列要求该值必须为 true）。
 * 首次调用会被拒绝一次，随后按模型缓存，不再重复试探。
 */
const THINKING_UNSUPPORTED = new Set<string>()
const THINKING_REJECTED_PATTERN = /enable_thinking|thinking_budget/i

export class DashScopeProvider {
  private readonly uploadCache = new Map<string, { ossUrl: string; expiresAt: number }>()

  constructor(
    private readonly options: {
      baseUrl: string
      uploadModel: string
      requestTimeoutMs: number
    },
  ) {}

  /* ----------------------------------------------------------- 文本生成 */

  async chat(input: ChatInput): Promise<ChatResult> {
    try {
      return await this.chatOnce(input, this.shouldDisableThinking(input.model))
    } catch (error) {
      if (isThinkingRejection(error)) {
        THINKING_UNSUPPORTED.add(input.model)
        return this.chatOnce(input, false)
      }
      throw error
    }
  }

  private async chatOnce(input: ChatInput, disableThinking: boolean): Promise<ChatResult> {
    const payload = await requestJson<ChatCompletionPayload>({
      url: `${this.options.baseUrl}${COMPAT_PATH}/chat/completions`,
      method: "POST",
      headers: this.jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? this.options.requestTimeoutMs,
      retries: 2,
      label: `DashScope ${input.model}`,
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.3,
        max_tokens: input.maxTokens,
        ...(disableThinking ? { enable_thinking: false } : {}),
        ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
      }),
    })

    const message = payload.payload.choices?.[0]?.message
    const content = normalizeContent(message?.content)
    if (!content) {
      const reasoning = normalizeContent(message?.reasoning_content)
      if (reasoning) {
        throw AppError.unavailable(`${input.model} 只返回了推理内容，未返回正文，请提高 max_tokens。`, {
          code: "LLM_REASONING_ONLY",
        })
      }
      throw AppError.unavailable(`${input.model} 返回空响应。`, { code: "LLM_EMPTY_RESPONSE" })
    }

    return {
      content,
      reasoning: normalizeContent(message?.reasoning_content) || undefined,
      usage: {
        inputTokens: Number(payload.payload.usage?.prompt_tokens || 0),
        outputTokens: Number(payload.payload.usage?.completion_tokens || 0),
        totalTokens: Number(payload.payload.usage?.total_tokens || 0),
      },
    }
  }

  /**
   * 关闭思考链可以把结构化任务的延迟降低一半左右（实测 6.7s → 3.4s）。
   * 只对已知支持该参数的模型启用。
   */
  private shouldDisableThinking(model: string): boolean {
    return !THINKING_UNSUPPORTED.has(model)
  }

  async *chatStream(input: ChatInput): AsyncGenerator<string, void, unknown> {
    const response = await sendRequest({
      url: `${this.options.baseUrl}${COMPAT_PATH}/chat/completions`,
      method: "POST",
      headers: this.jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? this.options.requestTimeoutMs,
      label: `DashScope ${input.model} (stream)`,
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.3,
        max_tokens: input.maxTokens,
        stream: true,
        stream_options: { include_usage: false },
        ...(this.shouldDisableThinking(input.model) ? { enable_thinking: false } : {}),
      }),
    })

    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "")
      if (THINKING_REJECTED_PATTERN.test(raw)) {
        THINKING_UNSUPPORTED.add(input.model)
      }
      throw AppError.unavailable(`${input.model} 流式请求失败：HTTP ${response.status} ${raw.slice(0, 300)}`, {
        code: "LLM_STREAM_FAILED",
      })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split("\n\n")
      buffer = events.pop() || ""
      for (const event of events) {
        for (const line of event.split("\n")) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) {
            continue
          }
          const data = trimmed.slice(5).trim()
          if (!data || data === "[DONE]") {
            continue
          }
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> }
            const delta = normalizeContent(parsed.choices?.[0]?.delta?.content)
            if (delta) {
              yield delta
            }
          } catch {
            // 忽略无法解析的分片
          }
        }
      }
    }
  }

  /* ------------------------------------------------------------- 向量 */

  async embed(input: EmbeddingInput): Promise<number[][]> {
    if (input.inputs.length === 0) {
      return []
    }
    const payload = await requestJson<EmbeddingPayload>({
      url: `${this.options.baseUrl}${COMPAT_PATH}/embeddings`,
      method: "POST",
      headers: this.jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: this.options.requestTimeoutMs,
      retries: 2,
      label: `DashScope ${input.model} (embeddings)`,
      body: JSON.stringify({
        model: input.model,
        input: input.inputs,
        ...(input.dimensions ? { dimensions: input.dimensions } : {}),
        encoding_format: "float",
      }),
    })

    const rows = payload.payload.data || []
    const ordered = [...rows].sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
    const vectors = ordered.map((row) => row.embedding || [])
    if (vectors.length !== input.inputs.length) {
      throw AppError.unavailable(`向量数量不匹配：期望 ${input.inputs.length}，实际 ${vectors.length}`, {
        code: "EMBEDDING_COUNT_MISMATCH",
      })
    }
    return vectors
  }

  /* ----------------------------------------------------------- 多模态 */

  async vision(input: VisionInput): Promise<string> {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }]
    for (const image of input.images) {
      content.push({ type: "image_url", image_url: { url: image } })
    }

    const payload = await requestJson<ChatCompletionPayload>({
      url: `${this.options.baseUrl}${COMPAT_PATH}/chat/completions`,
      method: "POST",
      headers: this.jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: this.options.requestTimeoutMs,
      retries: 1,
      label: `DashScope ${input.model} (vision)`,
      body: JSON.stringify({
        model: input.model,
        messages: [
          ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
          { role: "user", content },
        ],
        temperature: 0.1,
        max_tokens: input.maxTokens ?? 1200,
      }),
    })

    const text = normalizeContent(payload.payload.choices?.[0]?.message?.content)
    if (!text) {
      throw AppError.unavailable("多模态模型返回空响应。", { code: "VLM_EMPTY_RESPONSE" })
    }
    return text
  }

  /* ------------------------------------------------------------- 翻译 */

  async translate(input: {
    apiKey: string
    signal?: AbortSignal
    sourceLang?: string
    targetLang: string
    texts: string[]
  }): Promise<string[]> {
    if (input.texts.length === 0) {
      return []
    }
    const payload = await requestJson<{ Data?: { TranslatedTexts?: string[] }; Code?: number; Message?: string }>({
      url: `${this.options.baseUrl}${COMPAT_PATH}/chat/completions`,
      method: "POST",
      headers: this.jsonHeaders(input.apiKey),
      signal: input.signal,
      timeoutMs: this.options.requestTimeoutMs,
      retries: 1,
      label: "DashScope qwen-mt-uni",
      body: JSON.stringify({
        model: this.options.uploadModel === "qwen-mt-uni" ? "qwen-mt-uni" : "qwen-mt-uni",
        input: {
          source_texts: input.texts,
          ...(input.sourceLang ? { source_lang: input.sourceLang } : {}),
          target_lang: input.targetLang,
        },
      }),
    })

    const translated = payload.payload.Data?.TranslatedTexts
    if (!Array.isArray(translated) || translated.length !== input.texts.length) {
      throw AppError.unavailable("翻译服务返回结果数量不匹配。", {
        code: "TRANSLATION_COUNT_MISMATCH",
        detail: payload.payload.Message,
      })
    }
    return translated.map((item) => String(item || ""))
  }

  /* ----------------------------------------------------------- 文件 ASR */

  /** 上传本地文件到百炼临时空间，返回 `oss://` 引用（含 5 分钟策略有效期缓存）。 */
  async uploadForAsr(input: { apiKey: string; filePath: string; signal?: AbortSignal }): Promise<string> {
    const { filePath, signal } = input
    const cached = this.uploadCache.get(filePath)
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.ossUrl
    }

    const policyResponse = await requestJson<{
      data?: {
        policy: string
        signature: string
        upload_dir: string
        upload_host: string
        oss_access_key_id: string
        x_oss_object_acl: string
        x_oss_forbid_overwrite: string
        max_file_size_mb: number
        expire_in_seconds: number
      }
    }>({
      url: `${this.options.baseUrl}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(this.options.uploadModel)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal,
      timeoutMs: 60_000,
      retries: 2,
      label: "DashScope upload policy",
    })

    const policy = policyResponse.payload.data
    if (!policy) {
      throw AppError.unavailable("未能获取百炼临时上传策略。", { code: "UPLOAD_POLICY_MISSING" })
    }

    const buffer = await readFile(filePath)
    const sizeMb = buffer.byteLength / (1024 * 1024)
    if (sizeMb > policy.max_file_size_mb) {
      throw AppError.badRequest(
        `音频分片 ${sizeMb.toFixed(1)}MB 超过百炼单文件上限 ${policy.max_file_size_mb}MB，请调小切片时长。`,
        { code: "ASR_CHUNK_TOO_LARGE" },
      )
    }

    const fileName = path.basename(filePath)
    const ossKey = `${policy.upload_dir}/${fileName}`
    const form = new FormData()
    form.append("OSSAccessKeyId", policy.oss_access_key_id)
    form.append("policy", policy.policy)
    form.append("Signature", policy.signature)
    form.append("key", ossKey)
    form.append("success_action_status", "200")
    form.append("x-oss-object-acl", policy.x_oss_object_acl)
    form.append("x-oss-forbid-overwrite", policy.x_oss_forbid_overwrite)
    form.append("file", new Blob([new Uint8Array(buffer)]), fileName)

    const uploadResponse = await sendRequest({
      url: policy.upload_host,
      method: "POST",
      body: form,
      signal,
      timeoutMs: Math.max(120_000, this.options.requestTimeoutMs),
      label: "DashScope OSS upload",
    })
    if (uploadResponse.status !== 200 && uploadResponse.status !== 204) {
      const text = await uploadResponse.text().catch(() => "")
      throw AppError.unavailable(`音频上传失败：HTTP ${uploadResponse.status} ${text.slice(0, 300)}`, {
        code: "UPLOAD_FAILED",
      })
    }

    const ossUrl = `oss://${ossKey}`
    this.uploadCache.set(filePath, {
      ossUrl,
      expiresAt: Date.now() + Math.max(60, policy.expire_in_seconds - 60) * 1000,
    })
    return ossUrl
  }

  async submitTranscription(input: {
    apiKey: string
    filePath: string
    language?: string
    model: string
    signal?: AbortSignal
  }): Promise<string> {
    const ossUrl = await this.uploadForAsr({ apiKey: input.apiKey, filePath: input.filePath, signal: input.signal })
    const payload = await requestJson<{ output?: { task_id?: string; task_status?: string } }>({
      url: `${this.options.baseUrl}/api/v1/services/audio/asr/transcription`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
        "X-DashScope-OssResourceResolve": "enable",
      },
      signal: input.signal,
      timeoutMs: 120_000,
      retries: 1,
      label: "DashScope ASR submit",
      body: JSON.stringify({
        model: input.model,
        input: { file_url: ossUrl },
        parameters: {
          ...(input.language && input.language !== "auto" ? { language: input.language } : {}),
          channel_id: [0],
          enable_words: true,
        },
      }),
    })

    const taskId = payload.payload.output?.task_id
    if (!taskId) {
      throw AppError.unavailable("转写任务提交失败：未返回 task_id。", { code: "ASR_SUBMIT_FAILED" })
    }
    return taskId
  }

  async pollTranscription(input: {
    apiKey: string
    onTick?: (status: string) => void
    signal?: AbortSignal
    taskId: string
    timeoutMs?: number
  }): Promise<AsrResult> {
    const deadline = Date.now() + (input.timeoutMs ?? 30 * 60_000)
    while (Date.now() < deadline) {
      const payload = await requestJson<{
        output?: {
          task_status?: string
          code?: string
          message?: string
          results?: Array<{ transcription_url?: string; subtask_status?: string }>
        }
      }>({
        url: `${this.options.baseUrl}/api/v1/tasks/${input.taskId}`,
        method: "GET",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: input.signal,
        timeoutMs: 60_000,
        retries: 2,
        label: "DashScope ASR poll",
      })

      const output = payload.payload.output || {}
      const status = String(output.task_status || "")
      input.onTick?.(status)

      if (status === "SUCCEEDED") {
        const url = output.results?.find((item) => item.transcription_url)?.transcription_url
        if (!url) {
          throw AppError.unavailable("转写完成但未返回结果地址。", { code: "ASR_RESULT_MISSING" })
        }
        return await this.fetchTranscriptionResult(url, input.signal)
      }
      if (status === "FAILED" || status === "UNKNOWN") {
        throw AppError.unavailable(`转写失败：${output.message || output.code || status}`, {
          code: output.code || "ASR_FAILED",
        })
      }
      await delay(2500)
    }
    throw AppError.unavailable("转写轮询超时。", { code: "ASR_TIMEOUT" })
  }

  private async fetchTranscriptionResult(url: string, signal?: AbortSignal): Promise<AsrResult> {
    const response = await sendRequest({ url, method: "GET", signal, timeoutMs: 60_000, label: "DashScope ASR result" })
    if (!response.ok) {
      throw AppError.unavailable(`下载转写结果失败：HTTP ${response.status}`, { code: "ASR_RESULT_DOWNLOAD_FAILED" })
    }
    const payload = (await response.json()) as {
      properties?: { language?: string; content_duration_in_milliseconds?: number }
      transcripts?: Array<{
        text?: string
        sentences?: Array<{
          begin_time?: number
          end_time?: number
          text?: string
          words?: Array<{ begin_time?: number; end_time?: number; text?: string }>
        }>
      }>
    }

    const transcript = payload.transcripts?.[0] || {}
    const sentences: AsrSentence[] = (transcript.sentences || [])
      .map((sentence) => ({
        beginTimeMs: Number(sentence.begin_time || 0),
        endTimeMs: Number(sentence.end_time || 0),
        text: String(sentence.text || "").trim(),
        words: (sentence.words || [])
          .map((word) => ({
            beginTimeMs: Number(word.begin_time || 0),
            endTimeMs: Number(word.end_time || 0),
            text: String(word.text || "").trim(),
          }))
          .filter((word) => word.text),
      }))
      .filter((sentence) => sentence.text)

    return {
      language: String(payload.properties?.language || "zh"),
      sentences,
      durationMs: Number(payload.properties?.content_duration_in_milliseconds || 0),
      provider: "dashscope-filetrans",
    }
  }

  /* ------------------------------------------------------------- 内部 */

  private jsonHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }
  }
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim()
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item
        }
        if (item && typeof item === "object" && "text" in item) {
          return String((item as { text?: unknown }).text || "")
        }
        return ""
      })
      .join("")
      .trim()
  }
  return ""
}

/** 判断错误是否为「该模型不接受 enable_thinking 参数」。 */
function isThinkingRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return THINKING_REJECTED_PATTERN.test(message)
}
