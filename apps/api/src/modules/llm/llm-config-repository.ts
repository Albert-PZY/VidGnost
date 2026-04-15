import path from "node:path"

import type { LLMConfigResponse } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"

const LEGACY_MASK_PLACEHOLDERS = new Set(["__SECRET_MASKED__", "********"])

export class LlmConfigRepository {
  readonly #config: AppConfig
  readonly #path: string

  constructor(config: AppConfig) {
    this.#config = config
    this.#path = path.join(config.storageDir, "model_config.json")
  }

  async get(): Promise<LLMConfigResponse> {
    await this.#ensureFile()
    return this.#buildConfig(await readJsonFile<Record<string, unknown>>(this.#path, {}))
  }

  async isUserConfigured(): Promise<boolean> {
    if (!(await pathExists(this.#path))) {
      return false
    }
    const payload = await readJsonFile<Record<string, unknown>>(this.#path, {})
    return payload.user_configured === true
  }

  async save(payload: LLMConfigResponse): Promise<LLMConfigResponse> {
    const current = await this.get()
    const resolvedBaseUrl = normalizeBaseUrl(payload.base_url, this.#config.llmBaseUrl)
    const resolvedApiKey = resolveApiKey(payload.api_key, current.api_key, resolvedBaseUrl, this.#config.llmApiKey)

    const filePayload = {
      mode: "api",
      load_profile: payload.load_profile === "memory_first" ? "memory_first" : "balanced",
      local_model_id: payload.local_model_id.trim() || this.#config.llmLocalModelId,
      api_key: resolvedApiKey,
      base_url: resolvedBaseUrl,
      model: payload.model.trim() || this.#config.llmModel,
      correction_mode: normalizeCorrectionMode(payload.correction_mode, this.#config.llmCorrectionMode),
      correction_batch_size: clampInteger(payload.correction_batch_size, this.#config.llmCorrectionBatchSize, 6, 80),
      correction_overlap: clampInteger(payload.correction_overlap, this.#config.llmCorrectionOverlap, 0, 20),
      user_configured: true,
    }

    await writeJsonFile(this.#path, filePayload)
    return this.#buildConfig(filePayload)
  }

  async #ensureFile(): Promise<void> {
    if (await pathExists(this.#path)) {
      return
    }

    await writeJsonFile(this.#path, {
      mode: "api",
      load_profile: "balanced",
      local_model_id: this.#config.llmLocalModelId,
      api_key: normalizeApiKey("", this.#config.llmBaseUrl, this.#config.llmApiKey),
      base_url: this.#config.llmBaseUrl,
      model: this.#config.llmModel,
      correction_mode: this.#config.llmCorrectionMode,
      correction_batch_size: this.#config.llmCorrectionBatchSize,
      correction_overlap: this.#config.llmCorrectionOverlap,
      user_configured: false,
    })
  }

  #buildConfig(payload: Record<string, unknown>): LLMConfigResponse {
    const base_url = normalizeBaseUrl(payload.base_url, this.#config.llmBaseUrl)
    const api_key = normalizeApiKey(payload.api_key, base_url, this.#config.llmApiKey)

    return {
      mode: "api",
      load_profile: payload.load_profile === "memory_first" ? "memory_first" : "balanced",
      local_model_id: String(payload.local_model_id || "").trim() || this.#config.llmLocalModelId,
      api_key,
      api_key_configured: Boolean(api_key.trim()),
      base_url,
      model: String(payload.model || "").trim() || this.#config.llmModel,
      correction_mode: normalizeCorrectionMode(payload.correction_mode, this.#config.llmCorrectionMode),
      correction_batch_size: clampInteger(payload.correction_batch_size, this.#config.llmCorrectionBatchSize, 6, 80),
      correction_overlap: clampInteger(payload.correction_overlap, this.#config.llmCorrectionOverlap, 0, 20),
    }
  }
}

function resolveApiKey(rawValue: string, currentSecret: string, baseUrl: string, fallbackKey: string): string {
  if (LEGACY_MASK_PLACEHOLDERS.has(rawValue.trim())) {
    return currentSecret.trim()
  }
  return normalizeApiKey(rawValue, baseUrl, fallbackKey)
}

function normalizeApiKey(rawValue: unknown, baseUrl: string, fallbackKey: string): string {
  const candidate = String(rawValue || "").trim()
  if (candidate) {
    return candidate
  }

  const normalizedBaseUrl = baseUrl.toLowerCase()
  if (normalizedBaseUrl.startsWith("http://127.0.0.1:11434") || normalizedBaseUrl.startsWith("http://localhost:11434")) {
    return fallbackKey.trim() || "ollama"
  }

  return ""
}

function normalizeBaseUrl(rawValue: unknown, fallback: string): string {
  const candidate = String(rawValue || "").trim().replace(/\/+$/, "")
  return candidate || fallback.replace(/\/+$/, "")
}

function normalizeCorrectionMode(rawValue: unknown, fallback: "off" | "strict" | "rewrite"): "off" | "strict" | "rewrite" {
  const candidate = String(rawValue || "").trim().toLowerCase()
  if (candidate === "off" || candidate === "rewrite") {
    return candidate
  }
  return fallback === "off" || fallback === "rewrite" ? fallback : "strict"
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(candidate)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, candidate))
}
