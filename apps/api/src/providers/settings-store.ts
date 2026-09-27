import path from "node:path"

import type {
  AppSettings,
  CustomModelEntry,
  ModelRoute,
  ProviderConfig,
  ProviderCreateRequest,
  ProviderId,
  ProviderModelUpsertRequest,
  ProviderPatchRequest,
  ProviderProtocol,
  SettingsPatch,
} from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import type { AppConfig } from "../core/config.js"
import { readJsonFile, writeJsonFile } from "../core/fs.js"
import { BUILTIN_PROVIDERS, protocolInfo } from "./catalog.js"

/** 持久化的提供方记录：密钥状态是派生的，不落盘。 */
export type ProviderRecord = Omit<ProviderConfig, "credentialStatus">

interface PersistedSettings {
  version: 4
  settings: AppSettings
  routes: ModelRoute[]
  providers: ProviderRecord[]
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
    const wasLegacy = Number((persisted as { version?: number } | null)?.version ?? 0) < 4
    this.cache = this.normalize(persisted)
    if (wasLegacy) {
      // 迁移结果立即写回，避免每次启动都要重新推断协议与内置标记。
      await writeJsonFile(this.filePath, this.cache)
    }
    return this.cache
  }

  async getSettings(): Promise<AppSettings> {
    return (await this.load()).settings
  }

  async getRoutes(): Promise<ModelRoute[]> {
    return (await this.load()).routes
  }

  async getProviders(): Promise<ProviderRecord[]> {
    return (await this.load()).providers
  }

  async getProvider(id: ProviderId): Promise<ProviderRecord | undefined> {
    return (await this.load()).providers.find((provider) => provider.id === id)
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
      version: 4,
      settings: patch.settings ? { ...persisted.settings, ...normalizeSettingsPatch(patch.settings) } : persisted.settings,
      routes: patch.routes ? normalizeRoutes(patch.routes, persisted.routes) : persisted.routes,
      providers: persisted.providers,
    }
    next.settings = { ...next.settings, updatedAt: new Date().toISOString() }
    this.cache = next
    await writeJsonFile(this.filePath, next)
    return next
  }

  /* --------------------------------------------------------- 提供方增删改 */

  async createProvider(input: ProviderCreateRequest): Promise<ProviderConfig[]> {
    const persisted = await this.load()
    const label = String(input.label || "").trim()
    if (!label) {
      throw badRequest("提供方名称不能为空。", "PROVIDER_LABEL_REQUIRED")
    }
    const info = protocolInfo(input.protocol)
    if (!info) {
      throw badRequest(`未知协议：${input.protocol}`, "PROVIDER_PROTOCOL_UNKNOWN")
    }
    const id = uniqueProviderId(input.id || slugify(label), persisted.providers)
    const baseUrl = (input.baseUrl || info.defaultBaseUrl).trim().replace(/\/+$/, "")
    const record: ProviderRecord = {
      id,
      label,
      protocol: input.protocol,
      builtin: false,
      baseUrl,
      enabled: input.enabled ?? true,
      auth: input.apiKey?.trim()
        ? { source: "inline", inlineKey: input.apiKey.trim() }
        : { source: "none" },
      models: [],
    }
    this.cache = { ...persisted, providers: [...persisted.providers, record] }
    await writeJsonFile(this.filePath, this.cache)
    return this.describeProviders()
  }

  async patchProvider(input: ProviderPatchRequest): Promise<ProviderConfig[]> {
    const persisted = await this.load()
    const target = persisted.providers.find((provider) => provider.id === input.id)
    if (!target) {
      throw AppError.notFound(`提供方 ${input.id} 不存在。`, { code: "PROVIDER_NOT_FOUND" })
    }
    const providers = persisted.providers.map((provider) => {
      if (provider.id !== input.id) {
        return provider
      }
      const next: ProviderRecord = { ...provider }
      if (typeof input.label === "string" && input.label.trim()) {
        next.label = input.label.trim()
      }
      if (input.protocol) {
        if (!protocolInfo(input.protocol)) {
          throw badRequest(`未知协议：${input.protocol}`, "PROVIDER_PROTOCOL_UNKNOWN")
        }
        // 换协议后原有模型可能不再受支持，直接拒绝，让用户先清理模型。
        const unsupported = next.models.filter((model) => !protocolInfo(input.protocol!)!.kinds.includes(model.kind))
        if (unsupported.length > 0) {
          throw badRequest(
            `协议 ${input.protocol} 不支持已登记的模型：${unsupported.map((model) => model.label).join("、")}`,
            "PROTOCOL_CAPABILITY_UNSUPPORTED",
          )
        }
        next.protocol = input.protocol
      }
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
          next.auth = { source: next.auth.envVar ? "env" : "none", envVar: next.auth.envVar, inlineKey: undefined }
        }
      }
      return next
    })
    this.cache = { ...persisted, providers }
    await writeJsonFile(this.filePath, this.cache)
    return this.describeProviders()
  }

  async deleteProvider(id: ProviderId): Promise<ProviderConfig[]> {
    const persisted = await this.load()
    const target = persisted.providers.find((provider) => provider.id === id)
    if (!target) {
      throw AppError.notFound(`提供方 ${id} 不存在。`, { code: "PROVIDER_NOT_FOUND" })
    }
    if (target.builtin) {
      throw badRequest(`${target.label} 是内置提供方，不能删除。`, "PROVIDER_BUILTIN")
    }
    const roles = persisted.routes.filter((route) => route.provider === id).map((route) => route.label)
    if (roles.length > 0) {
      throw badRequest(
        `${target.label} 仍被角色引用：${roles.join("、")}。请先把这些角色改到别的模型。`,
        "PROVIDER_IN_USE",
      )
    }
    this.cache = { ...persisted, providers: persisted.providers.filter((provider) => provider.id !== id) }
    await writeJsonFile(this.filePath, this.cache)
    return this.describeProviders()
  }

  /* ----------------------------------------------------------- 模型增删改 */

  async upsertModel(
    providerId: ProviderId,
    modelId: string,
    input: ProviderModelUpsertRequest,
  ): Promise<ProviderConfig[]> {
    const persisted = await this.load()
    const target = persisted.providers.find((provider) => provider.id === providerId)
    if (!target) {
      throw AppError.notFound(`提供方 ${providerId} 不存在。`, { code: "PROVIDER_NOT_FOUND" })
    }
    const id = String(modelId || "").trim()
    if (!id) {
      throw badRequest("模型 ID 不能为空。", "MODEL_ID_REQUIRED")
    }
    const info = protocolInfo(target.protocol)
    if (!info?.kinds.includes(input.kind)) {
      throw badRequest(
        `协议 ${info?.label ?? target.protocol} 不支持「${input.kind}」类型，它支持：${(info?.kinds ?? []).join("、")}。`,
        "PROTOCOL_CAPABILITY_UNSUPPORTED",
      )
    }
    const entry: CustomModelEntry = {
      id,
      label: String(input.label ?? "").trim() || id,
      kind: input.kind,
      contextWindow: positiveInt(input.contextWindow),
      dimensions: positiveInt(input.dimensions),
      description: input.description?.trim() || undefined,
      tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    }
    const providers = persisted.providers.map((provider) => {
      if (provider.id !== providerId) {
        return provider
      }
      const models = provider.models.filter((model) => model.id !== id)
      return { ...provider, models: [...models, entry] }
    })
    this.cache = { ...persisted, providers }
    await writeJsonFile(this.filePath, this.cache)
    return this.describeProviders()
  }

  async deleteModel(providerId: ProviderId, modelId: string): Promise<ProviderConfig[]> {
    const persisted = await this.load()
    const target = persisted.providers.find((provider) => provider.id === providerId)
    if (!target) {
      throw AppError.notFound(`提供方 ${providerId} 不存在。`, { code: "PROVIDER_NOT_FOUND" })
    }
    const roles = persisted.routes
      .filter((route) => route.provider === providerId && route.model === modelId)
      .map((route) => route.label)
    if (roles.length > 0) {
      throw badRequest(
        `模型 ${modelId} 仍被角色引用：${roles.join("、")}。请先把这些角色改到别的模型。`,
        "MODEL_IN_USE",
      )
    }
    if (!target.models.some((model) => model.id === modelId)) {
      // 与删除渠道保持一致：目标不存在时报错，避免把误操作显示成删除成功。
      throw AppError.notFound(`模型 ${modelId} 不在 ${target.label} 下。`, { code: "MODEL_NOT_FOUND" })
    }
    const providers = persisted.providers.map((provider) =>
      provider.id === providerId
        ? { ...provider, models: provider.models.filter((model) => model.id !== modelId) }
        : provider,
    )
    this.cache = { ...persisted, providers }
    await writeJsonFile(this.filePath, this.cache)
    return this.describeProviders()
  }

  /* --------------------------------------------------------------- 密钥 */

  /** 解析某提供方实际可用的密钥。内联优先，其次专用环境变量，最后回到内置配置。 */
  resolveApiKey(provider: ProviderRecord): string {
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

  private withCredentialStatus(provider: ProviderRecord): ProviderConfig {
    const key = this.resolveApiKey(provider)
    const origin: ProviderConfig["credentialStatus"]["origin"] =
      provider.auth.source === "inline" && provider.auth.inlineKey
        ? "inline"
        : key
          ? "env"
          : "missing"
    return {
      ...provider,
      // 内联密钥只留在后端内存与磁盘配置里；出参一律省略，只给脱敏尾码。
      auth: { source: provider.auth.source, envVar: provider.auth.envVar },
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
    const stored = persisted?.providers ?? []

    const providers: ProviderRecord[] = BUILTIN_PROVIDERS.map((spec) => {
      const saved = stored.find((item) => item.id === spec.id)
      return migrateProvider(saved ?? defaultProvider(spec.id), spec.id, true)
    })

    // 自定义提供方全部保留：这里不再按固定 id 列表重建，否则用户登记的内容会在重启后消失。
    for (const saved of stored) {
      if (!saved?.id || providers.some((provider) => provider.id === saved.id)) {
        continue
      }
      providers.push(migrateProvider(saved, saved.id, false))
    }

    return { version: 4, settings, routes, providers }
  }
}

function badRequest(message: string, code: string): AppError {
  return new AppError({ message, code, status: 400 })
}

function positiveInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return Math.round(value)
}

/** 由名称派生 id，保留中文与字母数字，其余转成连字符。 */
function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "provider"
}

function uniqueProviderId(base: string, providers: ProviderRecord[]): string {
  if (!providers.some((provider) => provider.id === base)) {
    return base
  }
  let index = 2
  while (providers.some((provider) => provider.id === `${base}-${index}`)) {
    index += 1
  }
  return `${base}-${index}`
}

/** 旧版本没有协议与内置标记，按 id 推断，避免升级后配置失效。 */
function migrateProvider(
  provider: Partial<ProviderRecord> & { id: string },
  id: ProviderId,
  builtin: boolean,
): ProviderRecord {
  const spec = BUILTIN_PROVIDERS.find((item) => item.id === id)
  const protocol: ProviderProtocol = provider.protocol ?? spec?.protocol ?? inferProtocol(id)
  return {
    id,
    label: provider.label || spec?.label || id,
    protocol,
    builtin: provider.builtin ?? builtin,
    baseUrl: (provider.baseUrl ?? spec?.baseUrl ?? "").replace(/\/+$/, ""),
    enabled: provider.enabled ?? spec?.enabled ?? true,
    auth: provider.auth ?? { source: spec?.envVar ? "env" : "none", envVar: spec?.envVar },
    models: Array.isArray(provider.models) ? provider.models : [],
    note: provider.note ?? spec?.note,
  }
}

function inferProtocol(id: ProviderId): ProviderProtocol {
  if (id === "dashscope" || id === "openrouter" || id === "local") {
    return id
  }
  return "openai"
}

export function defaultProvider(id: ProviderId): ProviderRecord {
  const spec = BUILTIN_PROVIDERS.find((item) => item.id === id)
  if (spec) {
    return {
      id: spec.id,
      label: spec.label,
      protocol: spec.protocol,
      builtin: true,
      baseUrl: spec.baseUrl,
      enabled: spec.enabled,
      auth: { source: spec.envVar ? "env" : "none", envVar: spec.envVar || undefined },
      models: [],
      note: spec.note,
    }
  }
  return {
    id,
    label: id,
    protocol: "openai",
    builtin: false,
    baseUrl: "",
    enabled: false,
    auth: { source: "none" },
    models: [],
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
  // 短密钥不露任何字符：留头留尾等于把整串还回去。
  if (trimmed.length <= 12) {
    return "••••"
  }
  return `${trimmed.slice(0, 5)}…${trimmed.slice(-4)}`
}
