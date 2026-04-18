import path from "node:path"
import { readdir, stat } from "node:fs/promises"

import type {
  ModelDescriptor,
  ModelDownloadStatus,
  ModelListResponse,
  ModelReloadRequest,
  ModelUpdateRequest,
} from "@vidgnost/contracts"

import { resolveAppPath, type AppConfig } from "../../core/config.js"
import { pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"
import { clampInteger, clampNumber } from "../../core/number.js"
import type { OllamaRuntimeConfigRepository } from "./ollama-runtime-config-repository.js"
import { listOllamaModels } from "./ollama-service-manager.js"

const DEFAULT_API_TIMEOUT_SECONDS = 120
const DEFAULT_OLLAMA_API_KEY = "ollama"
const DEFAULT_REMOTE_VLM_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
const DEFAULT_REMOTE_VLM_API_MODEL = "qwen-vl-max-latest"
const DEFAULT_REMOTE_VLM_MODEL_ID = "qwen2.5-vl-7b-instruct"
const REMOTE_PROVIDER = "openai_compatible"
const OLLAMA_VISION_MODEL_PREFERENCES = [
  "qwen2.5vl:3b",
  "qwen2.5vl:7b",
  "qwen2.5vl",
  "granite3.2-vision:2b",
  "granite3.2-vision",
  "moondream",
] as const

const DEFAULT_MODELS: ModelDescriptor[] = [
  {
    id: "whisper-default",
    component: "whisper",
    name: "Faster-Whisper Small",
    provider: "local",
    model_id: "small",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "int8",
    load_profile: "balanced",
    max_batch_size: 1,
    rerank_top_n: 8,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "",
    api_key: "",
    api_key_configured: false,
    api_model: "",
    api_protocol: "openai_compatible",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
  },
  {
    id: "llm-default",
    component: "llm",
    name: "默认 LLM",
    provider: "ollama",
    model_id: "qwen2.5:3b",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "Q4_K_M",
    load_profile: "balanced",
    max_batch_size: 1,
    rerank_top_n: 8,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "qwen3.5-plus",
    api_protocol: "openai_compatible",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
  },
  {
    id: "embedding-default",
    component: "embedding",
    name: "默认嵌入模型",
    provider: "ollama",
    model_id: "bge-m3",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "",
    load_profile: "balanced",
    max_batch_size: 16,
    rerank_top_n: 8,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "text-embedding-v4",
    api_protocol: "aliyun_bailian",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
  },
  {
    id: "rerank-default",
    component: "rerank",
    name: "默认重排序模型",
    provider: "ollama",
    model_id: "sam860/qwen3-reranker:0.6b-q8_0",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "Q8_0",
    load_profile: "balanced",
    max_batch_size: 8,
    rerank_top_n: 8,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "gte-rerank-v2",
    api_protocol: "aliyun_bailian",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
  },
  {
    id: "vlm-default",
    component: "vlm",
    name: "默认视觉模型",
    provider: "openai_compatible",
    model_id: "qwen2.5-vl-7b-instruct",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "",
    load_profile: "balanced",
    max_batch_size: 4,
    rerank_top_n: 8,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "qwen-vl-max-latest",
    api_protocol: "openai_compatible",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
  },
]

export class ModelCatalogRepository {
  readonly #config: AppConfig
  readonly #ollamaRuntimeConfigRepository: OllamaRuntimeConfigRepository
  readonly #path: string

  constructor(config: AppConfig, ollamaRuntimeConfigRepository: OllamaRuntimeConfigRepository) {
    this.#config = config
    this.#ollamaRuntimeConfigRepository = ollamaRuntimeConfigRepository
    this.#path = path.join(config.storageDir, "models", "catalog.json")
  }

  async listModels(): Promise<ModelListResponse> {
    await this.#ensureFile()
    return {
      items: await this.#hydrate(await this.#readModels()),
    }
  }

  async reloadModels(payload: ModelReloadRequest): Promise<ModelListResponse> {
    const models = await this.#readModels()
    const now = new Date().toISOString()
    for (const item of models) {
      if (payload.model_id && item.id !== payload.model_id) {
        continue
      }
      item.last_check_at = now
    }
    await this.#writeModels(models)
    return {
      items: await this.#hydrate(models),
    }
  }

  async updateModel(modelId: string, payload: ModelUpdateRequest): Promise<ModelListResponse> {
    const models = await this.#readModels()
    const target = models.find((item) => item.id === modelId)
    if (!target) {
      throw new Error("Model not found")
    }

    if (payload.name !== undefined) {
      target.name = payload.name.trim() || target.name
    }
    if (payload.provider !== undefined) {
      target.provider = normalizeProvider(target.component, payload.provider)
    }
    if (payload.model_id !== undefined) {
      target.model_id = payload.model_id.trim() || target.model_id
    }
    if (payload.path !== undefined) {
      target.path = normalizeOptionalPath(payload.path)
    }
    if (payload.status !== undefined) {
      target.status = payload.status
    }
    if (payload.load_profile !== undefined) {
      target.load_profile = payload.load_profile.trim() || target.load_profile
    }
    if (payload.quantization !== undefined) {
      target.quantization = payload.quantization.trim()
    }
    if (payload.max_batch_size !== undefined) {
      target.max_batch_size = clampInteger(payload.max_batch_size, target.max_batch_size, 1, 64)
    }
    if (payload.rerank_top_n !== undefined) {
      target.rerank_top_n = clampInteger(payload.rerank_top_n, target.rerank_top_n, 1, 20)
    }
    if (payload.enabled !== undefined) {
      target.enabled = payload.enabled
    }
    if (payload.api_base_url !== undefined) {
      target.api_base_url = payload.api_base_url.trim()
    }
    if (payload.api_key !== undefined) {
      target.api_key = payload.api_key.trim()
    }
    if (payload.api_model !== undefined) {
      target.api_model = payload.api_model.trim()
    }
    if (payload.api_protocol !== undefined) {
      target.api_protocol = payload.api_protocol.trim() || target.api_protocol
    }
    if (payload.api_timeout_seconds !== undefined) {
      target.api_timeout_seconds = clampInteger(payload.api_timeout_seconds, target.api_timeout_seconds, 10, 600)
    }
    target.last_check_at = new Date().toISOString()

    await this.#writeModels(models)
    return {
      items: await this.#hydrate(models),
    }
  }

  async updateDownloadState(
    modelId: string,
    patch: {
      current_file?: string
      downloaded_bytes?: number
      message: string
      percent?: number
      speed_bps?: number
      state: ModelDownloadStatus["state"]
      total_bytes?: number
    },
  ): Promise<ModelListResponse> {
    const models = await this.#readModels()
    const target = models.find((item) => item.id === modelId)
    if (!target) {
      throw new Error("Model not found")
    }

    const current = target.download || createDefaultDownloadStatus()
    const nextTotalBytes = Math.max(0, patch.total_bytes ?? current.total_bytes)
    const nextDownloadedBytes = Math.max(0, patch.downloaded_bytes ?? current.downloaded_bytes)
    const nextPercent = clampNumber(
      patch.percent ?? (nextTotalBytes > 0 ? (nextDownloadedBytes / nextTotalBytes) * 100 : current.percent),
      0,
      0,
      100,
    )

    target.download = {
      ...current,
      current_file: patch.current_file ?? current.current_file,
      downloaded_bytes: nextDownloadedBytes,
      message: patch.message,
      percent: nextPercent,
      speed_bps: Math.max(0, patch.speed_bps ?? current.speed_bps),
      state: patch.state,
      total_bytes: nextTotalBytes,
      updated_at: new Date().toISOString(),
    }
    target.last_check_at = new Date().toISOString()

    await this.#writeModels(models)
    return {
      items: await this.#hydrate(models),
    }
  }

  async #ensureFile(): Promise<void> {
    if (await pathExists(this.#path)) {
      return
    }
    await this.#writeModels(DEFAULT_MODELS.map((item) => ({ ...item })))
  }

  async #readModels(): Promise<ModelDescriptor[]> {
    await this.#ensureFile()
    const models = await readJsonFile<Array<Partial<ModelDescriptor>>>(
      this.#path,
      DEFAULT_MODELS.map((item) => ({ ...item })),
    )
    const byId = new Map(
      models.map((item) => [String(item.id || "").trim(), item] as const).filter(([id]) => Boolean(id)),
    )
    const normalizedModels = DEFAULT_MODELS.map((defaultItem) =>
      normalizeStoredModelDescriptor(
        defaultItem,
        byId.get(defaultItem.id) || (defaultItem.id === "vlm-default" ? byId.get("mllm-default") : undefined),
      ),
    )
    if (shouldRewriteStoredModels(models)) {
      await this.#writeModels(normalizedModels)
    }
    return normalizedModels
  }

  async #writeModels(models: ModelDescriptor[]): Promise<void> {
    await writeJsonFile(this.#path, models)
  }

  async #hydrate(models: ModelDescriptor[]): Promise<ModelDescriptor[]> {
    const ollamaRuntimeConfig = await this.#ollamaRuntimeConfigRepository.get()
    const ollamaModels = await listOllamaModels(ollamaRuntimeConfig.base_url)
    const ollamaModelIds = ollamaModels.map((item) => item.modelId)
    const effectiveModels = synchronizeManagedModels(models, {
      llmApiKey: this.#config.llmApiKey,
      ollamaBaseUrl: ollamaRuntimeConfig.base_url,
      ollamaModelIds,
    })
    if (shouldPersistManagedModels(models, effectiveModels)) {
      await this.#writeModels(effectiveModels)
    }

    const installedModelIds = new Set(ollamaModelIds)
    const ollamaModelSizes = new Map(ollamaModels.map((item) => [item.modelId, item.sizeBytes] as const))
    const hydrated: ModelDescriptor[] = []
    for (const item of effectiveModels) {
      const defaultPath = resolveDefaultPath(item, this.#config.storageDir, ollamaRuntimeConfig.models_dir)
      const effectivePath = item.path.trim() || defaultPath
      const effectiveApiBaseUrl = resolveEffectiveApiBaseUrl(item, ollamaRuntimeConfig.base_url)
      const effectiveApiModel = resolveEffectiveApiModel(item)
      const effectiveApiKey = resolveEffectiveApiKey(item, effectiveApiBaseUrl, this.#config.llmApiKey)
      const installed = item.provider === REMOTE_PROVIDER
        ? Boolean(effectiveApiBaseUrl && effectiveApiModel && effectiveApiKey)
        : item.provider === "ollama"
          ? isOllamaModelInstalled(item.model_id, installedModelIds)
          : Boolean(effectivePath && await pathExists(effectivePath))
      const sizeBytes = item.provider === "ollama"
        ? resolveOllamaModelSize(item.model_id, ollamaModelSizes)
        : item.provider === "local"
          ? await measurePathSizeBytes(effectivePath)
          : 0

      hydrated.push({
        ...item,
        path: effectivePath,
        default_path: defaultPath,
        api_base_url: effectiveApiBaseUrl,
        api_model: effectiveApiModel,
        api_key: effectiveApiKey,
        is_installed: installed,
        size_bytes: sizeBytes,
        supports_managed_download: false,
        api_key_configured: Boolean(effectiveApiKey.trim()),
        status: installed ? "ready" : "not_ready",
      })
    }
    return hydrated
  }
}

function normalizeStoredModelDescriptor(
  defaultItem: ModelDescriptor,
  storedItem?: Partial<ModelDescriptor>,
): ModelDescriptor {
  const compatibleStoredItem = storedItem
    ? { ...storedItem, id: defaultItem.id, component: defaultItem.component }
    : undefined
  const merged = {
    ...defaultItem,
    ...(compatibleStoredItem || {}),
  }

  return {
    ...defaultItem,
    name: normalizeModelName(defaultItem, merged.name),
    provider: normalizeProvider(defaultItem.component, String(merged.provider || defaultItem.provider)),
    model_id: normalizeModelId(defaultItem, merged.model_id),
    path: normalizeOptionalPath(String(merged.path || "")),
    status: normalizeRuntimeStatus(merged.status, defaultItem.status),
    quantization: normalizeTrimmedString(merged.quantization, defaultItem.quantization),
    load_profile: normalizeTrimmedString(merged.load_profile, defaultItem.load_profile),
    max_batch_size: clampInteger(merged.max_batch_size, defaultItem.max_batch_size, 1, 64),
    rerank_top_n: clampInteger(merged.rerank_top_n, defaultItem.rerank_top_n, 1, 20),
    enabled: typeof merged.enabled === "boolean" ? merged.enabled : defaultItem.enabled,
    size_bytes: clampInteger(merged.size_bytes, defaultItem.size_bytes, 0, Number.MAX_SAFE_INTEGER),
    is_installed: typeof merged.is_installed === "boolean" ? merged.is_installed : defaultItem.is_installed,
    supports_managed_download:
      typeof merged.supports_managed_download === "boolean"
        ? merged.supports_managed_download
        : defaultItem.supports_managed_download,
    download: normalizeDownloadStatus(merged.download),
    last_check_at: normalizeTrimmedString(merged.last_check_at, defaultItem.last_check_at),
    api_base_url: normalizeTrimmedString(merged.api_base_url, defaultItem.api_base_url),
    api_key: normalizeTrimmedString(merged.api_key, defaultItem.api_key),
    api_key_configured:
      typeof merged.api_key_configured === "boolean" ? merged.api_key_configured : defaultItem.api_key_configured,
    api_model: normalizeApiModel(defaultItem, merged.api_model),
    api_protocol: normalizeTrimmedString(merged.api_protocol, defaultItem.api_protocol),
    api_timeout_seconds: clampInteger(merged.api_timeout_seconds, defaultItem.api_timeout_seconds, 10, 600),
  }
}

function synchronizeManagedModels(
  models: ModelDescriptor[],
  input: {
    llmApiKey: string
    ollamaBaseUrl: string
    ollamaModelIds: string[]
  },
): ModelDescriptor[] {
  const preferredVisionModelId = selectPreferredOllamaVisionModel(input.ollamaModelIds)
  return models.map((item) => {
    let nextItem = { ...item }
    if (shouldAdoptOllamaVisionModel(item, preferredVisionModelId)) {
      nextItem = {
        ...nextItem,
        provider: "ollama",
        model_id: preferredVisionModelId,
      }
    }

    const effectiveApiBaseUrl = resolveEffectiveApiBaseUrl(nextItem, input.ollamaBaseUrl)
    const effectiveApiModel = resolveEffectiveApiModel(nextItem)
    const effectiveApiKey = resolveEffectiveApiKey(nextItem, effectiveApiBaseUrl, input.llmApiKey)

    return {
      ...nextItem,
      api_base_url: effectiveApiBaseUrl,
      api_model: effectiveApiModel,
      api_key: effectiveApiKey,
      api_key_configured: Boolean(effectiveApiKey.trim()),
    }
  })
}

function shouldPersistManagedModels(previous: ModelDescriptor[], next: ModelDescriptor[]): boolean {
  return JSON.stringify(previous) !== JSON.stringify(next)
}

function shouldAdoptOllamaVisionModel(item: ModelDescriptor, preferredVisionModelId: string): boolean {
  if (item.id !== "vlm-default" || !preferredVisionModelId) {
    return false
  }
  if (item.provider === "ollama" && item.model_id.trim() === preferredVisionModelId) {
    return false
  }
  return isDefaultRemoteVlmDescriptor(item)
}

function isDefaultRemoteVlmDescriptor(item: ModelDescriptor): boolean {
  return item.provider === REMOTE_PROVIDER &&
    item.model_id.trim() === DEFAULT_REMOTE_VLM_MODEL_ID &&
    item.api_base_url.trim() === DEFAULT_REMOTE_VLM_BASE_URL &&
    item.api_model.trim() === DEFAULT_REMOTE_VLM_API_MODEL &&
    !item.api_key.trim()
}

function selectPreferredOllamaVisionModel(installedModelIds: string[]): string {
  for (const preferred of OLLAMA_VISION_MODEL_PREFERENCES) {
    const matched = installedModelIds.find((candidate) => buildOllamaModelAliases(candidate).has(preferred))
    if (matched) {
      return matched
    }
  }
  return ""
}

function resolveEffectiveApiBaseUrl(item: ModelDescriptor, ollamaBaseUrl: string): string {
  if (item.provider === "ollama") {
    return `${ollamaBaseUrl.replace(/\/+$/, "")}/v1`
  }
  return item.api_base_url.trim()
}

function resolveEffectiveApiModel(item: ModelDescriptor): string {
  if (item.provider === "ollama") {
    return item.model_id.trim() || item.api_model.trim()
  }
  return item.api_model.trim() || item.model_id.trim()
}

function resolveEffectiveApiKey(item: ModelDescriptor, apiBaseUrl: string, fallbackKey: string): string {
  const candidate = item.api_key.trim()
  if (candidate) {
    return candidate
  }
  if (item.provider === "ollama" || isLoopbackUrl(apiBaseUrl)) {
    return fallbackKey.trim() || DEFAULT_OLLAMA_API_KEY
  }
  return ""
}

function shouldRewriteStoredModels(models: Array<Partial<ModelDescriptor>>): boolean {
  if (models.length !== DEFAULT_MODELS.length) {
    return true
  }
  return models.some((item) => {
    const modelId = String(item.id || "").trim()
    const component = String(item.component || "").trim()
    if (!DEFAULT_MODELS.some((defaultItem) => defaultItem.id === modelId)) {
      return true
    }
    if (component === "mllm") {
      return true
    }
    if ("frame_interval_seconds" in (item as Record<string, unknown>)) {
      return true
    }
    if ("api_image_max_bytes" in (item as Record<string, unknown>)) {
      return true
    }
    if ("api_image_max_edge" in (item as Record<string, unknown>)) {
      return true
    }
    if (modelId === "embedding-default" && String(item.api_model || "").trim() === "qwen3-vl-embedding") {
      return true
    }
    if (modelId === "rerank-default" && String(item.api_model || "").trim() === "qwen3-vl-rerank") {
      return true
    }
    if (modelId === "whisper-default" && (
      String(item.model_id || "").trim().toLowerCase().endsWith(".bin") ||
      String(item.name || "").includes("Whisper.cpp")
    )) {
      return true
    }
    return false
  })
}

function resolveDefaultPath(item: ModelDescriptor, storageDir: string, ollamaModelsDir: string): string {
  if (item.provider === "local") {
    if (item.component === "whisper") {
      return path.join(storageDir, "models", "whisper")
    }
    return item.path
  }
  if (item.provider === "ollama") {
    return path.join(ollamaModelsDir, item.model_id.replace(/[:/]+/g, "-"))
  }
  return ""
}

function isOllamaModelInstalled(modelId: string, installedModelIds: Set<string>): boolean {
  const targetAliases = buildOllamaModelAliases(modelId)
  for (const installedModelId of installedModelIds) {
    const installedAliases = buildOllamaModelAliases(installedModelId)
    for (const alias of targetAliases) {
      if (installedAliases.has(alias)) {
        return true
      }
    }
  }
  return false
}

function resolveOllamaModelSize(modelId: string, modelSizes: Map<string, number>): number {
  const targetAliases = buildOllamaModelAliases(modelId)
  for (const [candidateModelId, sizeBytes] of modelSizes.entries()) {
    const candidateAliases = buildOllamaModelAliases(candidateModelId)
    for (const alias of targetAliases) {
      if (candidateAliases.has(alias)) {
        return sizeBytes
      }
    }
  }
  return 0
}

function buildOllamaModelAliases(rawModelId: string): Set<string> {
  const normalized = String(rawModelId || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase()
  const aliases = new Set<string>()
  if (!normalized) {
    return aliases
  }

  aliases.add(normalized)
  if (normalized.endsWith(":latest")) {
    aliases.add(normalized.slice(0, -":latest".length))
  } else {
    aliases.add(`${normalized}:latest`)
  }

  const slashSegments = normalized.split("/")
  if (slashSegments.length > 2) {
    const withoutRegistry = slashSegments.slice(1).join("/")
    aliases.add(withoutRegistry)
    if (withoutRegistry.endsWith(":latest")) {
      aliases.add(withoutRegistry.slice(0, -":latest".length))
    } else {
      aliases.add(`${withoutRegistry}:latest`)
    }
  }

  const lastTwoSegments = slashSegments.slice(-2).join("/")
  if (lastTwoSegments && lastTwoSegments !== normalized) {
    aliases.add(lastTwoSegments)
    if (lastTwoSegments.endsWith(":latest")) {
      aliases.add(lastTwoSegments.slice(0, -":latest".length))
    } else {
      aliases.add(`${lastTwoSegments}:latest`)
    }
  }

  const tail = slashSegments[slashSegments.length - 1] || normalized
  aliases.add(tail)
  if (tail.endsWith(":latest")) {
    aliases.add(tail.slice(0, -":latest".length))
  } else {
    aliases.add(`${tail}:latest`)
  }

  return aliases
}

async function measurePathSizeBytes(targetPath: string): Promise<number> {
  const normalized = String(targetPath || "").trim()
  if (!normalized || !(await pathExists(normalized))) {
    return 0
  }
  return measureExistingPathSizeBytes(normalized)
}

async function measureExistingPathSizeBytes(targetPath: string): Promise<number> {
  const targetStat = await stat(targetPath)
  if (targetStat.isFile()) {
    return targetStat.size
  }
  if (!targetStat.isDirectory()) {
    return 0
  }

  const entries = await readdir(targetPath, { withFileTypes: true })
  let totalBytes = 0
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      totalBytes += await measureExistingPathSizeBytes(entryPath)
      continue
    }
    if (entry.isFile()) {
      totalBytes += (await stat(entryPath)).size
    }
  }
  return totalBytes
}

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const target = new URL(rawUrl)
    return target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "::1"
  } catch {
    return false
  }
}

function normalizeProvider(component: ModelDescriptor["component"], provider: string): string {
  const candidate = provider.trim().toLowerCase()
  if (component === "whisper") {
    return candidate === REMOTE_PROVIDER ? REMOTE_PROVIDER : "local"
  }
  if (candidate === "openai_compatible" || candidate === "local" || candidate === "ollama") {
    return candidate
  }
  return candidate || "local"
}

function normalizeOptionalPath(rawValue: string): string {
  const candidate = rawValue.trim()
  if (!candidate) {
    return ""
  }
  return resolveAppPath(candidate)
}

function normalizeTrimmedString(rawValue: unknown, fallback: string): string {
  const candidate = String(rawValue || "").trim()
  return candidate || fallback
}

function normalizeApiModel(defaultItem: ModelDescriptor, rawValue: unknown): string {
  const candidate = String(rawValue || "").trim()
  if (!candidate) {
    return defaultItem.api_model
  }
  if (defaultItem.id === "embedding-default" && candidate === "qwen3-vl-embedding") {
    return defaultItem.api_model
  }
  if (defaultItem.id === "rerank-default" && candidate === "qwen3-vl-rerank") {
    return defaultItem.api_model
  }
  return candidate
}

function normalizeModelId(defaultItem: ModelDescriptor, rawValue: unknown): string {
  const candidate = String(rawValue || "").trim()
  if (!candidate) {
    return defaultItem.model_id
  }
  if (defaultItem.id === "whisper-default" && candidate.toLowerCase().endsWith(".bin")) {
    return defaultItem.model_id
  }
  return candidate
}

function normalizeModelName(defaultItem: ModelDescriptor, rawValue: unknown): string {
  const candidate = String(rawValue || "").trim()
  if (!candidate) {
    return defaultItem.name
  }
  if (defaultItem.id === "whisper-default" && candidate.includes("Whisper.cpp")) {
    return defaultItem.name
  }
  return candidate
}

function normalizeRuntimeStatus(
  rawValue: unknown,
  fallback: ModelDescriptor["status"],
): ModelDescriptor["status"] {
  const candidate = String(rawValue || "").trim()
  if (candidate === "ready" || candidate === "loading" || candidate === "not_ready" || candidate === "error") {
    return candidate
  }
  return fallback
}

function normalizeDownloadStatus(rawValue: unknown): ModelDownloadStatus | undefined {
  if (!rawValue || typeof rawValue !== "object") {
    return undefined
  }

  const candidate = rawValue as Partial<ModelDownloadStatus>
  const state = candidate.state
  return {
    state:
      state === "downloading" || state === "completed" || state === "cancelled" || state === "failed"
        ? state
        : "idle",
    message: normalizeTrimmedString(candidate.message, ""),
    current_file: normalizeTrimmedString(candidate.current_file, ""),
    downloaded_bytes: clampInteger(candidate.downloaded_bytes, 0, 0, Number.MAX_SAFE_INTEGER),
    total_bytes: clampInteger(candidate.total_bytes, 0, 0, Number.MAX_SAFE_INTEGER),
    percent: clampNumber(candidate.percent, 0, 0, 100),
    speed_bps: Math.max(0, Number(candidate.speed_bps) || 0),
    updated_at: normalizeTrimmedString(candidate.updated_at, ""),
  }
}

function createDefaultDownloadStatus(): ModelDownloadStatus {
  return {
    state: "idle",
    message: "",
    current_file: "",
    downloaded_bytes: 0,
    total_bytes: 0,
    percent: 0,
    speed_bps: 0,
    updated_at: "",
  }
}
