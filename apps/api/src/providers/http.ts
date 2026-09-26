import type { JsonValue } from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"

export interface HttpRequestInput {
  url: string
  method?: "GET" | "POST" | "PUT" | "DELETE"
  headers?: Record<string, string>
  body?: FormData | string | null
  signal?: AbortSignal
  timeoutMs?: number
  /** 重试次数（不含首次）。仅对网络错误与 429/5xx 生效，流式请求不重试。 */
  retries?: number
  label?: string
}

export interface HttpResponse<T> {
  status: number
  payload: T
  raw: string
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529])

export async function requestJson<T = unknown>(input: HttpRequestInput): Promise<HttpResponse<T>> {
  const attempts = Math.max(1, (input.retries ?? 2) + 1)
  let lastError: unknown = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await sendRequest(input)
      const raw = await response.text()
      const payload = parseJson<T>(raw)

      if (!response.ok) {
        const error = toRemoteError(input.label || input.url, response.status, payload, raw)
        if (RETRYABLE_STATUS.has(response.status) && attempt < attempts - 1) {
          lastError = error
          await delay(backoffMs(attempt))
          continue
        }
        throw error
      }

      return { status: response.status, payload, raw }
    } catch (error) {
      if (error instanceof AppError && error.code !== "REMOTE_UNREACHABLE") {
        throw error
      }
      lastError = error
      if (attempt < attempts - 1) {
        await delay(backoffMs(attempt))
        continue
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : AppError.unavailable(`${input.label || input.url} 请求失败`, { code: "REMOTE_UNREACHABLE" })
}

export async function sendRequest(input: HttpRequestInput): Promise<Response> {
  const controller = new AbortController()
  const timeoutMs = input.timeoutMs ?? 120_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  input.signal?.addEventListener("abort", onAbort, { once: true })

  try {
    return await fetch(input.url, {
      method: input.method || "POST",
      headers: input.headers,
      body: input.body ?? null,
      signal: controller.signal,
    })
  } catch (error) {
    if (input.signal?.aborted) {
      throw AppError.conflict("请求已取消。", { code: "REQUEST_ABORTED" })
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw AppError.unavailable(`${input.label || input.url} 请求超时（${timeoutMs}ms）`, {
        code: "REMOTE_TIMEOUT",
      })
    }
    throw AppError.unavailable(`${input.label || input.url} 网络不可达：${error instanceof Error ? error.message : error}`, {
      code: "REMOTE_UNREACHABLE",
    })
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener("abort", onAbort)
  }
}

function parseJson<T>(raw: string): T {
  if (!raw.trim()) {
    return {} as T
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return { message: raw.slice(0, 2000) } as T
  }
}

function toRemoteError(label: string, status: number, payload: unknown, raw: string): AppError {
  const record = (payload || {}) as Record<string, unknown>
  const nested = (record.error || {}) as Record<string, unknown>
  const message =
    firstString(nested.message, record.message, record.Code, raw.slice(0, 300)) || `HTTP ${status}`
  const code = firstString(nested.code, record.code, record.Code) || `REMOTE_HTTP_${status}`
  const detail = safeDetail(payload)
  return new AppError({
    message: `${label}：${message}`,
    code,
    status: status >= 400 && status < 500 ? 502 : 503,
    detail,
  })
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return ""
}

function safeDetail(payload: unknown): JsonValue | undefined {
  if (payload === null || payload === undefined) {
    return undefined
  }
  try {
    const serialized = JSON.stringify(payload)
    return serialized.length > 4000 ? ({ truncated: serialized.slice(0, 4000) } as JsonValue) : (payload as JsonValue)
  } catch {
    return undefined
  }
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 600 * 2 ** attempt) + Math.floor(Math.random() * 250)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 有并发上限的批量执行器，用于 embedding / rerank / 视觉调用。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const size = Math.max(1, Math.min(limit, items.length))

  await Promise.all(
    Array.from({ length: size }, async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) {
          return
        }
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}
