import type { AppSettings, ModelKind, ProviderProtocol } from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import type { LocalWhisperProvider } from "../local-whisper.js"
import { AnthropicAdapter } from "./anthropic.js"
import { DashScopeAdapter } from "./dashscope.js"
import { GeminiAdapter } from "./gemini.js"
import { LocalAdapter } from "./local.js"
import { OpenAIAdapter } from "./openai.js"
import { OpenRouterAdapter } from "./openrouter.js"
import { CAPABILITY_METHOD, type ProtocolAdapter } from "./types.js"

export * from "./types.js"

export interface AdapterDeps {
  readSettings: () => Promise<AppSettings>
  requestTimeoutMs: number
  siteName: string
  uploadModel: string
  whisper: LocalWhisperProvider
}

/** 建一份协议 → 适配器表。适配器都是无状态的，整个进程共用一个实例即可。 */
export function createAdapters(deps: AdapterDeps): Record<ProviderProtocol, ProtocolAdapter> {
  return {
    openai: new OpenAIAdapter(),
    anthropic: new AnthropicAdapter(),
    gemini: new GeminiAdapter(),
    dashscope: new DashScopeAdapter({
      requestTimeoutMs: deps.requestTimeoutMs,
      uploadModel: deps.uploadModel,
    }),
    openrouter: new OpenRouterAdapter({
      requestTimeoutMs: deps.requestTimeoutMs,
      siteName: deps.siteName,
    }),
    local: new LocalAdapter(deps.whisper, deps.readSettings),
  }
}

/** 协议是否支持某能力：既看声明的能力表，也看方法是否真的实现了。 */
export function supportsCapability(adapter: ProtocolAdapter, kind: ModelKind): boolean {
  if (!adapter.kinds.includes(kind)) {
    return false
  }
  return typeof adapter[CAPABILITY_METHOD[kind]] === "function"
}

export function assertCapability(adapter: ProtocolAdapter, kind: ModelKind, providerLabel: string): void {
  if (supportsCapability(adapter, kind)) {
    return
  }
  throw new AppError({
    message: `${providerLabel} 使用的协议 ${adapter.protocol} 不支持「${kind}」。`,
    code: "PROTOCOL_CAPABILITY_UNSUPPORTED",
    status: 400,
    hint: `该协议支持：${adapter.kinds.join("、")}。`,
  })
}
