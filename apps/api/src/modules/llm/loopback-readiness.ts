import { AppError } from "../../core/errors.js"
import type { OpenAiCompatibleClient } from "./openai-compatible-client.js"

const CACHE_TTL_MS = 30_000

interface ReachabilityCacheEntry {
  checkedAt: number
  reachable: boolean
}

export class LlmServiceReadinessProbe {
  private readonly cache = new Map<string, ReachabilityCacheEntry>()

  constructor(
    private readonly llmClient: Pick<OpenAiCompatibleClient, "listModels"> | null | undefined,
  ) {}

  async isReachable(input: {
    apiKey: string
    baseUrl: string
    timeoutSeconds?: number
  }): Promise<boolean> {
    if (!this.llmClient?.listModels) {
      return true
    }

    const cacheKey = buildCacheKey(input.baseUrl)
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.checkedAt <= CACHE_TTL_MS) {
      return cached.reachable
    }

    let reachable = false
    try {
      await this.llmClient.listModels({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        timeoutSeconds: input.timeoutSeconds,
      })
      reachable = true
    } catch (error) {
      reachable = error instanceof AppError
    }

    this.cache.set(cacheKey, {
      checkedAt: Date.now(),
      reachable,
    })
    return reachable
  }
}

export function isLoopbackUrl(baseUrl: string): boolean {
  try {
    const target = new URL(baseUrl)
    return target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "::1"
  } catch {
    return false
  }
}

function buildCacheKey(baseUrl: string): string {
  return String(baseUrl || "").trim().replace(/\/+$/, "").toLowerCase()
}
