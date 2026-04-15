import path from "node:path"

import type { WhisperConfigResponse, WhisperConfigUpdateRequest } from "@vidgnost/contracts"

import { pathExists } from "../../core/fs.js"
import type { AppConfig } from "../../core/config.js"

interface StoredWhisperConfig {
  model_default: string
  language: string
  device: string
  compute_type: string
  model_load_profile: "balanced" | "memory_first"
  beam_size: number
  vad_filter: boolean
  chunk_seconds: number
  target_sample_rate: number
  target_channels: number
}

const DEFAULT_WHISPER_CONFIG: StoredWhisperConfig = {
  model_default: "small",
  language: "zh",
  device: "cpu",
  compute_type: "int8",
  model_load_profile: "balanced",
  beam_size: 5,
  vad_filter: true,
  chunk_seconds: 180,
  target_sample_rate: 16000,
  target_channels: 1,
}

export class WhisperRuntimeConfigRepository {
  readonly #path: string

  constructor(config: AppConfig) {
    this.#path = path.join(config.storageDir, "config.toml")
  }

  async get(): Promise<StoredWhisperConfig> {
    if (!(await pathExists(this.#path))) {
      return DEFAULT_WHISPER_CONFIG
    }
    return this.#parse(await this.#readRaw())
  }

  async save(payload: WhisperConfigUpdateRequest): Promise<StoredWhisperConfig> {
    const current = await this.get()
    const nextValue: StoredWhisperConfig = {
      model_default: normalizeModelSize(payload.model_default || current.model_default),
      language: String(payload.language || current.language).trim() || current.language,
      device: normalizeDevice(payload.device || current.device),
      compute_type: normalizeComputeType(payload.compute_type || current.compute_type),
      model_load_profile: payload.model_load_profile === "memory_first" ? "memory_first" : "balanced",
      beam_size: clampInteger(payload.beam_size, current.beam_size, 1, 12),
      vad_filter: typeof payload.vad_filter === "boolean" ? payload.vad_filter : current.vad_filter,
      chunk_seconds: clampInteger(payload.chunk_seconds, current.chunk_seconds, 30, 1200),
      target_sample_rate: clampInteger(payload.target_sample_rate, current.target_sample_rate, 8000, 48000),
      target_channels: clampInteger(payload.target_channels, current.target_channels, 1, 2),
    }

    await this.#writeRaw(nextValue)
    return nextValue
  }

  async #readRaw(): Promise<string> {
    const { readFile } = await import("node:fs/promises")
    try {
      return await readFile(this.#path, "utf8")
    } catch {
      return buildToml(DEFAULT_WHISPER_CONFIG)
    }
  }

  async #writeRaw(payload: StoredWhisperConfig): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(path.dirname(this.#path), { recursive: true })
    await writeFile(this.#path, buildToml(payload), "utf8")
  }

  #parse(rawToml: string): StoredWhisperConfig {
    const values = parseTomlSection(rawToml, "whisper")
    return {
      model_default: normalizeModelSize(values.model_default || DEFAULT_WHISPER_CONFIG.model_default),
      language: String(values.language || DEFAULT_WHISPER_CONFIG.language).trim() || DEFAULT_WHISPER_CONFIG.language,
      device: normalizeDevice(values.device || DEFAULT_WHISPER_CONFIG.device),
      compute_type: normalizeComputeType(values.compute_type || DEFAULT_WHISPER_CONFIG.compute_type),
      model_load_profile: values.model_load_profile === "memory_first" ? "memory_first" : "balanced",
      beam_size: clampInteger(values.beam_size, DEFAULT_WHISPER_CONFIG.beam_size, 1, 12),
      vad_filter: normalizeBoolean(values.vad_filter, DEFAULT_WHISPER_CONFIG.vad_filter),
      chunk_seconds: clampInteger(values.chunk_seconds, DEFAULT_WHISPER_CONFIG.chunk_seconds, 30, 1200),
      target_sample_rate: clampInteger(values.target_sample_rate, DEFAULT_WHISPER_CONFIG.target_sample_rate, 8000, 48000),
      target_channels: clampInteger(values.target_channels, DEFAULT_WHISPER_CONFIG.target_channels, 1, 2),
    }
  }
}

export function buildWhisperConfigResponse(
  config: StoredWhisperConfig,
  runtimeLibraries: WhisperConfigResponse["runtime_libraries"],
): WhisperConfigResponse {
  return {
    ...config,
    runtime_libraries: runtimeLibraries,
    warnings: [],
    rollback_applied: false,
  }
}

function buildToml(config: StoredWhisperConfig): string {
  return [
    "# VidGnost runtime config",
    "# This file is updated by the frontend config panel.",
    "",
    "[whisper]",
    `model_default = "${escapeToml(config.model_default)}"`,
    `language = "${escapeToml(config.language)}"`,
    `device = "${escapeToml(config.device)}"`,
    `compute_type = "${escapeToml(config.compute_type)}"`,
    `model_load_profile = "${escapeToml(config.model_load_profile)}"`,
    `beam_size = ${config.beam_size}`,
    `vad_filter = ${config.vad_filter ? "true" : "false"}`,
    `chunk_seconds = ${config.chunk_seconds}`,
    `target_sample_rate = ${config.target_sample_rate}`,
    `target_channels = ${config.target_channels}`,
    "",
  ].join("\n")
}

function parseTomlSection(rawToml: string, sectionName: string): Record<string, string> {
  const values: Record<string, string> = {}
  let activeSection = ""
  for (const line of rawToml.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      activeSection = sectionMatch[1] || ""
      continue
    }
    if (activeSection !== sectionName) {
      continue
    }
    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }
    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, "$1")
    values[key] = value
  }
  return values
}

function normalizeModelSize(rawValue: string): string {
  const candidate = rawValue.trim().toLowerCase()
  return candidate === "medium" ? "medium" : "small"
}

function normalizeDevice(rawValue: string): string {
  const candidate = rawValue.trim().toLowerCase()
  return candidate === "auto" || candidate === "cuda" ? candidate : "cpu"
}

function normalizeComputeType(rawValue: string): string {
  const candidate = rawValue.trim().toLowerCase()
  return candidate === "float32" ? "float32" : "int8"
}

function normalizeBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (rawValue === "true") {
    return true
  }
  if (rawValue === "false") {
    return false
  }
  return fallback
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(candidate)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, candidate))
}

function escapeToml(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")
}
