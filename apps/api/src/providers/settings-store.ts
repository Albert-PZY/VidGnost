import path from "node:path"

import type {
  AppSettings,
  ModelRoute,
  ProviderConfig,
  ProviderId,
  SettingsPatch,
} from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { readJsonFile, writeJsonFile } from "../core/fs.js"

interface PersistedSettings {
  version: 3
  settings: AppSettings
  routes: ModelRoute[]
  providers: Array<Omit<ProviderConfig, "credentialStatus">>
}

export interface ResolvedRoute {
  role: ModelRoute["role"]
  provider: ProviderId
  model: string
  temperature?: number
  maxTokens?: number
  allowFallback: boolean
}

const SETTINGS_FILE = "config/settings.json"
const PROVIDER_IDS: ProviderId[] = ["dashscope", "openrouter", "openai-compatible"]

export class SettingsStore {
  private cache: PersistedSettings | null = null

  constructor(
    private readonly config: AppConfig,
    private readonly defaults: { settings: AppSettings; routes: ModelRoute[] },
  ) {}

  private get filePath(): string {
    return path.join(this.config.storageDir, SETTINGS_FILE)
  }

  async load(): Promise<PersistedSettings> {
    if (this.cache) {
      return this.cache
    }
    const persisted = await readJsonFile<PersistedSettings>(this.filePath)
    this.cache = this.normalize(persisted)
    return this.cache
  }

  async getSettings(): Promise<AppSettings> {
    return (await this.load()).settings
  }

  async getRoutes(): Promise<ModelRoute[]> {
    return (await this.load()).routes
  }

  async getProviders(): Promise<Array<Omit<ProviderConfig, "credentialStatus">>> {
    return (await this.load()).providers
  }

  /** 对外暴露的提供方列表，密钥脱敏。 */
  async describeProviders(): Promise<ProviderConfig[]> {
    const persisted = await this.load()
    return persisted.providers.map((provider) => this.withCredentialStatus(provider))
  }

  async resolve(role: ModelRoute["role"]): Promise<ResolvedRoute> {
    const persisted = await this.load()
    const route = persisted.routes.find((item) => item.role === role)
    if (!route) {
      throw new Error(`未配置模型角色：${role}`)
    }
    return this.toResolved(route)
  }

  async resolveWithFallback(role: ModelRoute["role"]): Promise<ResolvedRoute[]> {
    const persisted = await this.load()
    const route = persisted.routes.find((item) => item.role === role)
    if (!route) {
      return []
    }
    const chain = [this.toResolved(route)]
    if (route.allowFallback && role !== "llm.fallback" && role.startsWith("llm.")) {
      const fallback = persisted.routes.find((item) => item.role === "llm.fallback")
      if (fallback && fallback.model !== route.model) {
        chain.push(this.toResolved(fallback))
      }
    }
    return chain
  }

  /** 角色 → (provider, model) 的稳定签名，用于阶段缓存键。 */
  async signature(roles: ModelRoute["role"][]): Promise<string> {
    const persisted = await this.load()
    return roles
      .map((role) => {
        const route = persisted.routes.find((item) => item.role === role)
        return route ? `${role}=${route.provider}/${route.model}` : `${role}=missing`
      })
      .join("|")
  }

  async update(patch: SettingsPatch): Promise<PersistedSettings> {
    const persisted = await this.load()
    const next: PersistedSettings = {
      version: 3,
      settings: patch.settings ? { ...persisted.settings, ...normalizeSettingsPatch(patch.settings) } : persisted.settings,
      routes: patch.routes ? normalizeRoutes(patch.routes, persisted.routes) : persisted.routes,
      providers: persisted.providers,
    }
    next.settings = { ...next.settings, updatedAt: new Date().toISOString() }
    this.cache = next
    await writeJsonFile(this.filePath, next)
    return next
  }

  async updateProvider(input: { id: ProviderId; baseUrl?: string; enabled?: boolean; apiKey?: string | null }): Promise<ProviderConfig[]> {
    const persisted = await this.load()
    const providers = persisted.providers.map((provider) => {
      if (provider.id !== input.id) {
        return provider
      }
      const next = { ...provider }
      if (typeof input.baseUrl === "string" && input.baseUrl.trim()) {
        next.baseUrl = input.baseUrl.trim().replace(/\/+$/, "")
      }
      if (typeof input.enabled === "boolean") {
        next.enabled = input.enabled
      }
      if (input.apiKey !== undefined) {
        const trimmed = String(input.apiKey || "").trim()
        if (trimmed) {
          next.auth = { ...next.auth, source: "inline", inlineKey: trimmed }
        } else {
          next.auth = { source: "env", envVar: next.auth.envVar, inlineKey: undefined }
        }
      }
      return next
    })
    this.cache = { ...persisted, providers }
    await writeJsonFile(this.filePath, this.cache)
    return this.describeProviders()
  }

  /** 解析某提供方实际可用的密钥。内联优先，其次环境变量。 */
  resolveApiKey(provider: Omit<ProviderConfig, "credentialStatus">): string {
    if (provider.auth.source === "inline" && provider.auth.inlineKey) {
      return provider.auth.inlineKey
    }
    const envVar = provider.auth.envVar || ""
    const fromEnv = envVar ? String(process.env[envVar] || "").trim() : ""
    if (fromEnv) {
      return fromEnv
    }
    if (provider.id === "dashscope") {
      return this.config.dashscopeApiKey
    }
    if (provider.id === "openrouter") {
      return this.config.openrouterApiKey
    }
    return ""
  }

  private withCredentialStatus(provider: Omit<ProviderConfig, "credentialStatus">): ProviderConfig {
    const key = this.resolveApiKey(provider)
    const origin: ProviderConfig["credentialStatus"]["origin"] =
      provider.auth.source === "inline" && provider.auth.inlineKey
        ? "inline"
        : key
          ? "env"
          : "missing"
    return {
      ...provider,
      credentialStatus: {
        present: Boolean(key),
        masked: key ? maskKey(key) : null,
        origin,
      },
    }
  }

  private toResolved(route: ModelRoute): ResolvedRoute {
    return {
      role: route.role,
      provider: route.provider,
      model: route.model,
      temperature: route.temperature,
      maxTokens: route.maxTokens,
      allowFallback: route.allowFallback,
    }
  }

  private normalize(persisted: PersistedSettings | null): PersistedSettings {
    const settings = { ...this.defaults.settings, ...(persisted?.settings || {}) }
    const routes = normalizeRoutes(persisted?.routes || [], this.defaults.routes)
    const providers = PROVIDER_IDS.map((id) => {
      const stored = persisted?.providers?.find((item) => item.id === id)
      return stored ? { ...stored } : defaultProvider(id)
    })
    return { version: 3, settings, routes, providers }
  }
}

export function defaultProvider(id: ProviderId): Omit<ProviderConfig, "credentialStatus"> {
  switch (id) {
    case "dashscope":
      return {
        id,
        label: "阿里云百炼",
        baseUrl: "https://dashscope.aliyuncs.com",
        enabled: true,
        auth: { source: "env", envVar: "DASHSCOPE_API_KEY" },
        note: "提供 LLM / 多模态 / 文件级 ASR / 向量 / 翻译能力。",
      }
    case "openrouter":
      return {
        id,
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        enabled: true,
        auth: { source: "env", envVar: "OPENROUTER_API_KEY" },
        note: "当前用于 free 档重排序模型。",
      }
    default:
      return {
        id,
        label: "OpenAI 兼容",
        baseUrl: "",
        enabled: false,
        auth: { source: "env", envVar: "VIDGNOST_COMPAT_API_KEY" },
        note: "任意 OpenAI 兼容端点，启用后可被角色路由引用。",
      }
  }
}

function normalizeRoutes(input: ModelRoute[], fallback: ModelRoute[]): ModelRoute[] {
  const merged = new Map<string, ModelRoute>()
  for (const route of fallback) {
    merged.set(route.role, route)
  }
  for (const route of input) {
    if (!route?.role || !route?.model) {
      continue
    }
    const base = merged.get(route.role)
    merged.set(route.role, {
      role: route.role,
      provider: route.provider || base?.provider || "dashscope",
      model: String(route.model).trim(),
      label: route.label || base?.label || route.role,
      allowFallback: route.allowFallback ?? base?.allowFallback ?? true,
      temperature: clampRouteNumber(route.temperature ?? base?.temperature, 0, 2, 0.3),
      maxTokens: Math.round(clampRouteNumber(route.maxTokens ?? base?.maxTokens, 64, 200_000, 8000)),
    })
  }
  return [...merged.values()]
}

function normalizeSettingsPatch(patch: NonNullable<SettingsPatch["settings"]>): Partial<AppSettings> {
  const next: Partial<AppSettings> = {}
  if (patch.defaultPreset) next.defaultPreset = patch.defaultPreset
  if (patch.defaultLanguage) next.defaultLanguage = patch.defaultLanguage
  if (patch.defaultAsr) next.defaultAsr = patch.defaultAsr
  if (typeof patch.defaultVision === "boolean") next.defaultVision = patch.defaultVision
  if (typeof patch.defaultProofread === "boolean") next.defaultProofread = patch.defaultProofread
  if (patch.defaultTranslateTo !== undefined) next.defaultTranslateTo = patch.defaultTranslateTo
  if (typeof patch.maxConcurrentTasks === "number") next.maxConcurrentTasks = patch.maxConcurrentTasks
  if (typeof patch.keepIntermediateMedia === "boolean") next.keepIntermediateMedia = patch.keepIntermediateMedia
  if (patch.whisper) {
    const whisper = patch.whisper
    next.whisper = {
      pythonExecutable: whisper.pythonExecutable ?? "",
      model: whisper.model ?? "large-v3",
      device: whisper.device ?? "auto",
      computeType: whisper.computeType ?? "int8",
      modelDir: whisper.modelDir ?? "",
    }
  }
  return next
}

function clampNumber(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(min, Math.min(max, value))
}

function clampRouteNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  const clamped = clampNumber(value, min, max)
  return clamped === undefined ? fallback : clamped
}

export function maskKey(key: string): string {
  const trimmed = String(key || "").trim()
  if (trimmed.length <= 8) {
    return "••••"
  }
  return `${trimmed.slice(0, 5)}…${trimmed.slice(-4)}`
}
