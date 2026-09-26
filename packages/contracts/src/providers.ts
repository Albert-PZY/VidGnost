import type { IsoDateTime } from "./common.js"

/* ------------------------------------------------------------------ 提供方 */

export type ProviderId = "dashscope" | "openrouter" | "openai-compatible" | "local"

export type ProviderAuthSource = "env" | "inline" | "none"

export interface ProviderConfig {
  id: ProviderId
  label: string
  baseUrl: string
  enabled: boolean
  auth: {
    source: ProviderAuthSource
    /** 读取密钥的环境变量名。 */
    envVar?: string
    /** 仅在后端内存保留；对外序列化时只返回脱敏尾码。 */
    inlineKey?: string
  }
  /** 可读的密钥状态，接口返回时使用。 */
  credentialStatus: {
    present: boolean
    /** 形如 `sk-…3f9a`。 */
    masked: string | null
    origin: "env" | "inline" | "missing"
  }
  note?: string
}

/* ------------------------------------------------------------------ 模型 */

export type ModelKind = "chat" | "vision" | "asr" | "embedding" | "rerank" | "translation"

/** 模型角色：流水线按角色取模型，而不是写死模型名。 */
export type ModelRole =
  | "llm.fast"
  | "llm.balanced"
  | "llm.reasoning"
  | "llm.quality"
  | "llm.bulk"
  | "llm.fallback"
  | "vision.primary"
  | "asr.online"
  | "asr.local"
  | "embedding"
  | "rerank"
  | "translate"

export interface ModelCatalogEntry {
  id: string
  provider: ProviderId
  kind: ModelKind
  label: string
  description: string
  /** 面向用户的能力标签，例如 `长文本`、`推理`、`多模态`。 */
  tags: string[]
  contextWindow?: number
  free?: boolean
  /** 推荐用法，展示在设置页。 */
  recommendedFor?: ModelRole[]
}

export interface ModelRoute {
  role: ModelRole
  provider: ProviderId
  model: string
  /** 角色用途说明。 */
  label: string
  /** 该角色不可用时是否允许回退到 `llm.fallback` / 其他候选。 */
  allowFallback: boolean
  /** 生成参数覆盖。 */
  temperature?: number
  maxTokens?: number
}

export interface ModelSettings {
  routes: ModelRoute[]
  updatedAt: IsoDateTime
}

/* ------------------------------------------------------------------ 健康 */

export interface CheckResult {
  name: string
  ok: boolean
  detail: string
  latencyMs?: number
}

export interface ProviderHealth {
  provider: ProviderId
  ok: boolean
  checkedAt: IsoDateTime
  checks: CheckResult[]
}

export interface RuntimeHealth {
  ok: boolean
  checkedAt: IsoDateTime
  providers: ProviderHealth[]
  toolchain: CheckResult[]
}

/* ------------------------------------------------------------------ 设置 */

export interface AppSettings {
  /** 默认处理预设。 */
  defaultPreset: "fast" | "balanced" | "deep"
  defaultLanguage: string
  defaultAsr: "auto" | "online" | "local"
  defaultVision: boolean
  defaultProofread: boolean
  defaultTranslateTo: string | null
  /** 本地 whisper 配置。 */
  whisper: {
    pythonExecutable: string
    model: string
    device: "auto" | "cpu" | "cuda"
    computeType: string
    modelDir: string
  }
  /** 并发上限，避免在线限流。 */
  maxConcurrentTasks: number
  /** 是否保留中间产物（ffmpeg 中间文件）。 */
  keepIntermediateMedia: boolean
  updatedAt: IsoDateTime
}

export interface SettingsPatch {
  settings?: Partial<Omit<AppSettings, "updatedAt">>
  routes?: ModelRoute[]
}
