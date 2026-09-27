import type { IsoDateTime } from "./common.js"

/* ------------------------------------------------------------------ 提供方 */

/**
 * 提供方标识。内置四个 id 见 `BUILTIN_PROVIDER_IDS`，自定义提供方使用任意字符串 id。
 */
export type ProviderId = string

/** 内置提供方：不允许删除，但仍可修改 Base URL、密钥与启用状态。 */
export const BUILTIN_PROVIDER_IDS = ["dashscope", "openrouter", "openai-compatible", "local"] as const

/**
 * 请求协议。决定用哪套请求形状与端点路径，与提供方是谁无关：
 * 自建 vLLM、Ollama、LM Studio、公司内网网关都用 `openai`。
 */
export type ProviderProtocol = "openai" | "anthropic" | "gemini" | "dashscope" | "openrouter" | "local"

export type ProviderAuthSource = "env" | "inline" | "none"

/** 用户登记的模型条目。 */
export interface CustomModelEntry {
  /** 发给提供方的模型名，例如 `qwen2.5-72b-instruct` 或 `gpt-4o-mini`。 */
  id: string
  /** 界面显示名。 */
  label: string
  kind: ModelKind
  contextWindow?: number
  /** 向量维度，仅 `embedding` 使用。 */
  dimensions?: number
  description?: string
  tags?: string[]
}

export interface ProviderConfig {
  id: ProviderId
  label: string
  protocol: ProviderProtocol
  /** 内置提供方不允许删除。 */
  builtin: boolean
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
  /** 用户登记的模型。 */
  models: CustomModelEntry[]
  note?: string
}

/** 协议能力说明，由目录接口返回给界面。 */
export interface ProviderProtocolInfo {
  protocol: ProviderProtocol
  label: string
  /** 该协议支持的能力类型。 */
  kinds: ModelKind[]
  streaming: boolean
  defaultBaseUrl: string
  /** 一句话说明适用范围。 */
  note: string
}

export interface ProviderCreateRequest {
  label: string
  protocol: ProviderProtocol
  /** 省略时取该协议的默认 Base URL。 */
  baseUrl?: string
  apiKey?: string
  enabled?: boolean
  /** 省略时由名称派生，冲突时追加序号。 */
  id?: string
}

export interface ProviderPatchRequest {
  id: ProviderId
  label?: string
  protocol?: ProviderProtocol
  baseUrl?: string
  enabled?: boolean
  /** 传 `null` 表示清除内联密钥，回退到环境变量；省略表示不改动。 */
  apiKey?: string | null
}

export interface ProviderModelUpsertRequest {
  label: string
  kind: ModelKind
  contextWindow?: number
  dimensions?: number
  description?: string
  tags?: string[]
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
  /** 用户登记的模型，界面据此显示标记。 */
  custom?: boolean
  /** 向量维度，`embedding` 模型使用。 */
  dimensions?: number
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
