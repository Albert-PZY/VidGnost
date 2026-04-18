import { existsSync } from "node:fs"
import path from "node:path"

import { API_VERSION, DEFAULT_API_HOST, DEFAULT_API_PORT, DEFAULT_API_PREFIX, DEFAULT_APP_NAME } from "@vidgnost/shared"

const DEFAULT_ALLOW_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:6221",
  "http://127.0.0.1:6221",
]
const PATH_RESOLUTION_BASE_DIR = resolvePathBaseDir()

export interface AppConfig {
  appName: string
  apiPrefix: string
  allowOrigins: string[]
  eventLogDir: string
  ffmpegExecutable: string
  ffprobeExecutable: string
  host: string
  llmApiKey: string
  llmBaseUrl: string
  llmCorrectionBatchSize: number
  llmCorrectionMode: "off" | "strict" | "rewrite"
  llmCorrectionOverlap: number
  llmLocalModelId: string
  llmModel: string
  maxUploadMb: number
  ollamaBaseUrl: string
  port: number
  runtimeBinDir: string
  storageDir: string
  tempDir: string
  uploadDir: string
  version: string
  whisperPythonExecutable: string
  ytdlpExecutable: string
}

export function resolveConfig(): AppConfig {
  return {
    appName: process.env.VIDGNOST_APP_NAME?.trim() || DEFAULT_APP_NAME,
    apiPrefix: process.env.VIDGNOST_API_PREFIX?.trim() || DEFAULT_API_PREFIX,
    allowOrigins: parseOrigins(process.env.VIDGNOST_ALLOW_ORIGINS),
    eventLogDir: resolveAppPath(process.env.VIDGNOST_EVENT_LOG_DIR, ["storage", "event-logs"]),
    ffmpegExecutable: String(process.env.VIDGNOST_FFMPEG_BIN || "").trim(),
    ffprobeExecutable: String(process.env.VIDGNOST_FFPROBE_BIN || "").trim(),
    host: process.env.VIDGNOST_API_HOST?.trim() || DEFAULT_API_HOST,
    llmApiKey: process.env.VIDGNOST_LLM_API_KEY?.trim() || "ollama",
    llmBaseUrl: process.env.VIDGNOST_LLM_BASE_URL?.trim() || "http://127.0.0.1:11434/v1",
    llmCorrectionBatchSize: parseBoundedInt(process.env.VIDGNOST_LLM_CORRECTION_BATCH_SIZE, 24, 6, 80),
    llmCorrectionMode: parseCorrectionMode(process.env.VIDGNOST_LLM_CORRECTION_MODE),
    llmCorrectionOverlap: parseBoundedInt(process.env.VIDGNOST_LLM_CORRECTION_OVERLAP, 3, 0, 20),
    llmLocalModelId: process.env.VIDGNOST_LLM_LOCAL_MODEL_ID?.trim() || "qwen2.5:3b",
    llmModel: process.env.VIDGNOST_LLM_MODEL?.trim() || "qwen2.5:3b",
    maxUploadMb: parseBoundedInt(process.env.VIDGNOST_MAX_UPLOAD_MB, 2048, 1, 10240),
    ollamaBaseUrl: process.env.VIDGNOST_OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434",
    port: parsePort(process.env.VIDGNOST_API_PORT, DEFAULT_API_PORT),
    runtimeBinDir: resolveAppPath(process.env.VIDGNOST_RUNTIME_BIN_DIR, ["storage", "runtime-bin"]),
    storageDir: resolveAppPath(process.env.VIDGNOST_STORAGE_DIR, ["storage"]),
    tempDir: resolveAppPath(process.env.VIDGNOST_TEMP_DIR, ["storage", "tmp"]),
    uploadDir: resolveAppPath(process.env.VIDGNOST_UPLOAD_DIR, ["storage", "uploads"]),
    version: process.env.VIDGNOST_APP_VERSION?.trim() || API_VERSION,
    whisperPythonExecutable: String(process.env.VIDGNOST_WHISPER_PYTHON || "").trim(),
    ytdlpExecutable: String(process.env.VIDGNOST_YTDLP_BIN || "").trim(),
  }
}

function parsePort(rawValue: string | undefined, fallback: number): number {
  const candidate = Number.parseInt(String(rawValue || "").trim(), 10)
  if (!Number.isFinite(candidate) || candidate <= 0 || candidate > 65535) {
    return fallback
  }
  return candidate
}

function parseBoundedInt(rawValue: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.parseInt(String(rawValue || "").trim(), 10)
  if (!Number.isFinite(candidate)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, candidate))
}

function parseCorrectionMode(rawValue: string | undefined): "off" | "strict" | "rewrite" {
  const candidate = String(rawValue || "").trim().toLowerCase()
  if (candidate === "off" || candidate === "rewrite") {
    return candidate
  }
  return "strict"
}

function parseOrigins(rawValue: string | undefined): string[] {
  const entries = String(rawValue || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return entries.length > 0 ? entries : [...DEFAULT_ALLOW_ORIGINS]
}

export function resolveAppPath(rawValue: string | undefined, fallbackSegments: string[] = []): string {
  const candidate = String(rawValue || "").trim()
  if (!candidate) {
    return path.resolve(PATH_RESOLUTION_BASE_DIR, ...fallbackSegments)
  }
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(PATH_RESOLUTION_BASE_DIR, candidate)
}

function resolvePathBaseDir(startDir = process.cwd()): string {
  let currentDir = path.resolve(startDir)
  while (true) {
    if (hasWorkspaceMarker(currentDir)) {
      return currentDir
    }
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return path.resolve(startDir)
    }
    currentDir = parentDir
  }
}

function hasWorkspaceMarker(targetDir: string): boolean {
  return ["pnpm-workspace.yaml", ".git"].some((marker) => existsSync(path.join(targetDir, marker)))
}
