import { AppError } from "../core/errors.js"
import { requestJson } from "./http.js"

export interface RerankResult {
  index: number
  score: number
}

export interface RerankInput {
  apiKey: string
  baseUrl: string
  documents: string[]
  model: string
  query: string
  signal?: AbortSignal
  siteName?: string
  topN?: number
}

interface RerankPayload {
  results?: Array<{ index?: number; relevance_score?: number }>
  error?: { message?: string }
}

/**
 * OpenRouter 重排序客户端。
 * 文档：`POST /api/v1/rerank`，body `{ model, query, documents, top_n }`。
 */
export class OpenRouterProvider {
  constructor(private readonly options: { baseUrl: string; requestTimeoutMs: number; siteName: string }) {}

  async rerank(input: RerankInput): Promise<RerankResult[]> {
    if (input.documents.length === 0) {
      return []
    }
    const payload = await requestJson<RerankPayload>({
      url: `${this.options.baseUrl.replace(/\/+$/, "")}/rerank`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Albert-PZY/VidGnost",
        "X-OpenRouter-Title": input.siteName || "VidGnost",
      },
      signal: input.signal,
      timeoutMs: Math.max(30_000, Math.min(this.options.requestTimeoutMs, 120_000)),
      retries: 1,
      label: `OpenRouter ${input.model}`,
      body: JSON.stringify({
        model: input.model,
        query: input.query,
        documents: input.documents.map((text) => ({ text })),
        top_n: Math.max(1, Math.min(input.topN ?? input.documents.length, input.documents.length)),
      }),
    })

    const results = payload.payload.results
    if (!Array.isArray(results)) {
      throw AppError.unavailable("重排序服务返回格式无效。", { code: "RERANK_INVALID_RESPONSE" })
    }
    return results
      .map((item) => ({
        index: Number(item.index ?? -1),
        score: Number(item.relevance_score ?? 0),
      }))
      .filter((item) => item.index >= 0 && item.index < input.documents.length)
  }

  async probe(apiKey: string): Promise<{ latencyMs: number; modelCount: number }> {
    const started = Date.now()
    const payload = await requestJson<{ data?: unknown[] }>({
      url: `${this.options.baseUrl.replace(/\/+$/, "")}/models`,
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 30_000,
      retries: 0,
      label: "OpenRouter models",
    })
    return { latencyMs: Date.now() - started, modelCount: Array.isArray(payload.payload.data) ? payload.payload.data.length : 0 }
  }
}
