import { Blob } from "node:buffer"
import { readFile } from "node:fs/promises"

import { AppError } from "../../core/errors.js"

export interface GeneratedTextResponse {
  content: string
  raw: unknown
}

export interface AudioTranscriptionResponse {
  language: string
  raw: unknown
  segments: Array<{
    end: number
    start: number
    text: string
  }>
  text: string
}

export interface RemoteModelListResponse {
  models: string[]
  raw: unknown
}

export class OpenAiCompatibleClient {
  async listModels(input: {
    apiKey: string
    baseUrl: string
    timeoutSeconds?: number
  }): Promise<RemoteModelListResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(10, input.timeoutSeconds || 60) * 1000)

    try {
      const response = await fetch(joinUrl(input.baseUrl, "/models"), {
        method: "GET",
        headers: buildAuthHeaders(input.apiKey, false),
        signal: controller.signal,
      })
      const payload = await readJsonPayload(response)
      if (!response.ok) {
        throw asRemoteApiError(payload, "模型列表请求失败")
      }

      const models = extractModelIds(payload)
      if (models.length === 0) {
        throw AppError.conflict("远程模型列表为空或格式无效。", {
          code: "LLM_MODELS_INVALID",
          detail: payload,
        })
      }

      return {
        models,
        raw: payload,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async generateText(input: {
    apiKey: string
    baseUrl: string
    model: string
    systemPrompt?: string
    timeoutSeconds?: number
    userPrompt: string
  }): Promise<GeneratedTextResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(10, input.timeoutSeconds || 120) * 1000)

    try {
      const response = await fetch(joinUrl(input.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: buildAuthHeaders(input.apiKey),
        signal: controller.signal,
        body: JSON.stringify({
          model: input.model,
          temperature: 0.2,
          messages: [
            ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
            { role: "user", content: input.userPrompt },
          ],
        }),
      })
      const payload = await readJsonPayload(response)
      if (!response.ok) {
        throw asRemoteApiError(payload, "LLM 请求失败")
      }

      const content = extractTextContent(payload)
      if (!content) {
        throw AppError.conflict("LLM 返回了空响应。", {
          code: "LLM_EMPTY_RESPONSE",
          detail: payload,
        })
      }
      return {
        content,
        raw: payload,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async transcribeAudio(input: {
    apiBaseUrl: string
    apiKey: string
    audioPath: string
    language?: string
    model: string
    timeoutSeconds?: number
  }): Promise<AudioTranscriptionResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Math.max(30, input.timeoutSeconds || 300) * 1000)

    try {
      const audioBuffer = await readFile(input.audioPath)
      const formData = new FormData()
      formData.append("file", new Blob([audioBuffer], { type: "audio/wav" }), "audio.wav")
      formData.append("model", input.model)
      formData.append("response_format", "verbose_json")
      if (input.language) {
        formData.append("language", input.language)
      }
      formData.append("timestamp_granularities[]", "segment")

      const response = await fetch(joinUrl(input.apiBaseUrl, "/audio/transcriptions"), {
        method: "POST",
        headers: {
          ...buildAuthHeaders(input.apiKey, false),
        },
        body: formData,
        signal: controller.signal,
      })
      const payload = await readJsonPayload(response)
      if (!response.ok) {
        throw asRemoteApiError(payload, "远程转写请求失败")
      }

      const segments = extractTranscriptionSegments(payload)
      const text = String((payload as { text?: unknown }).text || "")
        .trim() || segments.map((item) => item.text).join("\n").trim()
      if (!text) {
        throw AppError.conflict("远程转写返回了空结果。", {
          code: "ASR_EMPTY_RESPONSE",
          detail: payload,
        })
      }

      return {
        language: String((payload as { language?: unknown }).language || input.language || "zh"),
        raw: payload,
        segments,
        text,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function buildAuthHeaders(apiKey: string, withContentType = true): Record<string, string> {
  const headers: Record<string, string> = {}
  if (withContentType) {
    headers["Content-Type"] = "application/json"
  }
  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }
  return headers
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${suffix}`
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    const text = await response.text().catch(() => "")
    return {
      message: text || response.statusText,
    }
  }
}

function extractTextContent(payload: unknown): string {
  const choices = Array.isArray((payload as { choices?: unknown[] })?.choices)
    ? (payload as { choices: Array<Record<string, unknown>> }).choices
    : []
  const firstChoice = choices[0] || {}
  const message = firstChoice.message
  if (message && typeof message === "object") {
    const content = (message as { content?: unknown }).content
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
        .join("\n")
        .trim()
    }
  }
  return ""
}

function extractTranscriptionSegments(payload: unknown): Array<{ end: number; start: number; text: string }> {
  const rawSegments = Array.isArray((payload as { segments?: unknown[] })?.segments)
    ? (payload as { segments: Array<Record<string, unknown>> }).segments
    : []
  return rawSegments
    .map((item) => ({
      end: Number(item.end) || 0,
      start: Number(item.start) || 0,
      text: String(item.text || "").trim(),
    }))
    .filter((item) => item.text)
}

function extractModelIds(payload: unknown): string[] {
  const items = Array.isArray((payload as { data?: unknown[] })?.data)
    ? (payload as { data: Array<Record<string, unknown>> }).data
    : []
  return items
    .map((item) => String(item.id || "").trim())
    .filter(Boolean)
}

function asRemoteApiError(payload: unknown, fallbackMessage: string): AppError {
  const error = (payload as { error?: { message?: unknown; code?: unknown } })?.error
  return AppError.conflict(
    String(error?.message || (payload as { message?: unknown })?.message || fallbackMessage),
    {
      code: String(error?.code || "REMOTE_API_REQUEST_FAILED"),
      detail: payload,
    },
  )
}
