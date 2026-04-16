import path from "node:path"

import type {
  ModelDescriptor,
  ModelDownloadStatus,
  ModelListResponse,
  ModelReloadRequest,
  ModelUpdateRequest,
} from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"
import { clampInteger, clampNumber } from "../../core/number.js"
import type { OllamaRuntimeConfigRepository } from "./ollama-runtime-config-repository.js"

const DEFAULT_API_TIMEOUT_SECONDS = 120
const DEFAULT_IMAGE_MAX_BYTES = 512 * 1024
const DEFAULT_IMAGE_MAX_EDGE = 1280
const REMOTE_PROVIDER = "openai_compatible"

const DEFAULT_MODELS: ModelDescriptor[] = [
  {
    id: "whisper-default",
    component: "whisper",
    name: "Whisper.cpp Small",
    provider: "local",
    model_id: "ggml-small.bin",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "int8",
    load_profile: "balanced",
    max_batch_size: 1,
    rerank_top_n: 8,
    frame_interval_seconds: 10,
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
    api_image_max_bytes: DEFAULT_IMAGE_MAX_BYTES,
    api_image_max_edge: DEFAULT_IMAGE_MAX_EDGE,
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
    frame_interval_seconds: 10,
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
    api_image_max_bytes: DEFAULT_IMAGE_MAX_BYTES,
    api_image_max_edge: DEFAULT_IMAGE_MAX_EDGE,
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
    frame_interval_seconds: 10,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "qwen3-vl-embedding",
    api_protocol: "aliyun_bailian",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
    api_image_max_bytes: DEFAULT_IMAGE_MAX_BYTES,
    api_image_max_edge: DEFAULT_IMAGE_MAX_EDGE,
  },
  {
    id: "vlm-default",
    component: "vlm",
    name: "默认 VLM",
    provider: "ollama",
    model_id: "moondream",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "Q4_K_M",
    load_profile: "memory_first",
    max_batch_size: 1,
    rerank_top_n: 8,
    frame_interval_seconds: 10,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "qwen-image-2.0",
    api_protocol: "openai_compatible",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
    api_image_max_bytes: DEFAULT_IMAGE_MAX_BYTES,
    api_image_max_edge: DEFAULT_IMAGE_MAX_EDGE,
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
    frame_interval_seconds: 10,
    enabled: true,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "qwen3-vl-rerank",
    api_protocol: "aliyun_bailian",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
    api_image_max_bytes: DEFAULT_IMAGE_MAX_BYTES,
    api_image_max_edge: DEFAULT_IMAGE_MAX_EDGE,
  },
  {
    id: "mllm-default",
    component: "mllm",
    name: "OpenAI Compatible MLLM",
    provider: REMOTE_PROVIDER,
    model_id: "qwen3.5-omni-flash",
    path: "",
    default_path: "",
    status: "not_ready",
    quantization: "",
    load_profile: "balanced",
    max_batch_size: 1,
    rerank_top_n: 8,
    frame_interval_seconds: 10,
    enabled: false,
    size_bytes: 0,
    is_installed: false,
    supports_managed_download: false,
    last_check_at: "",
    api_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api_key: "",
    api_key_configured: false,
    api_model: "qwen3.5-omni-flash",
    api_protocol: "openai_compatible",
    api_timeout_seconds: DEFAULT_API_TIMEOUT_SECONDS,
    api_image_max_bytes: DEFAULT_IMAGE_MAX_BYTES,
    api_image_max_edge: DEFAULT_IMAGE_MAX_EDGE,
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
    if (payload.frame_interval_seconds !== undefined) {
      target.frame_interval_seconds = clampInteger(payload.frame_interval_seconds, target.frame_interval_seconds, 1, 600)
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
    if (payload.api_image_max_bytes !== undefined) {
      target.api_image_max_bytes = clampInteger(payload.api_image_max_bytes, target.api_image_max_bytes, 32 * 1024, 8 * 1024 * 1024)
    }
    if (payload.api_image_max_edge !== undefined) {
      target.api_image_max_edge = clampInteger(payload.api_image_max_edge, target.api_image_max_edge, 256, 4096)
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
    const models = await readJsonFile<ModelDescriptor[]>(
      this.#path,
      DEFAULT_MODELS.map((item) => ({ ...item })),
    )
    const byId = new Map(models.map((item) => [item.id, item]))
    return DEFAULT_MODELS.map((defaultItem) => ({
      ...defaultItem,
      ...(byId.get(defaultItem.id) || {}),
      id: defaultItem.id,
      component: defaultItem.component,
    }))
  }

  async #writeModels(models: ModelDescriptor[]): Promise<void> {
    await writeJsonFile(this.#path, models)
  }

  async #hydrate(models: ModelDescriptor[]): Promise<ModelDescriptor[]> {
    const ollamaRuntimeConfig = await this.#ollamaRuntimeConfigRepository.get()
    const hydrated: ModelDescriptor[] = []
    for (const item of models) {
      const defaultPath = resolveDefaultPath(item, this.#config.storageDir, ollamaRuntimeConfig.models_dir)
      const effectivePath = item.path.trim() || defaultPath
      const installed = item.provider === REMOTE_PROVIDER
        ? Boolean(item.api_base_url.trim() && item.api_model.trim() && item.api_key.trim())
        : Boolean(effectivePath && await pathExists(effectivePath))

      hydrated.push({
        ...item,
        path: effectivePath,
        default_path: defaultPath,
        is_installed: installed,
        supports_managed_download: false,
        api_key_configured: Boolean(item.api_key.trim()),
        status: installed ? "ready" : "not_ready",
      })
    }
    return hydrated
  }
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

function normalizeProvider(component: ModelDescriptor["component"], provider: string): string {
  const candidate = provider.trim().toLowerCase()
  if (component === "whisper") {
    return candidate === REMOTE_PROVIDER ? REMOTE_PROVIDER : "local"
  }
  if (component === "mllm") {
    return candidate === "ollama" ? "ollama" : REMOTE_PROVIDER
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
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(process.cwd(), candidate)
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
