import { existsSync } from "node:fs"
import path from "node:path"

import { DEFAULT_API_HOST, DEFAULT_API_PORT, DEFAULT_API_PREFIX, DEFAULT_APP_NAME, API_VERSION } from "@vidgnost/shared"

const DEFAULT_ALLOW_ORIGINS = [
  "http://localhost:6221",
  "http://127.0.0.1:6221",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]

export interface AppConfig {
  appName: string
  version: string
  host: string
  port: number
  apiPrefix: string
  allowOrigins: string[]
  /** 仓库根目录（`pnpm-workspace.yaml` 所在目录）。 */
  workspaceRoot: string
  storageDir: string
  uploadDir: string
  tmpDir: string
  /** 在线模型提供方。 */
  dashscopeBaseUrl: string
  dashscopeApiKey: string
  dashscopeApiKeyEnv: string
  openrouterBaseUrl: string
  openrouterApiKey: string
  openrouterApiKeyEnv: string
  /** 工具链覆盖路径，留空则走 PATH 探测。 */
  ffmpegPath: string
  ffprobePath: string
  ytdlpPath: string
  /** 本地 whisper。 */
  whisperPython: string
  whisperModelDir: string
  whisperDevice: "auto" | "cpu" | "cuda"
  whisperComputeType: string
  /** 并发与网络。 */
  maxConcurrentTasks: number
  /** 单次 ASR 上传分片上限（MB），百炼策略上限 1024。 */
  asrChunkMb: number
  requestTimeoutMs: number
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const workspaceRoot = resolveWorkspaceRoot()
  const storageDir = resolveAppPath(env.VIDGNOST_STORAGE_DIR, ["storage"], workspaceRoot)

  return {
    appName: env.VIDGNOST_APP_NAME?.trim() || DEFAULT_APP_NAME,
    version: env.VIDGNOST_APP_VERSION?.trim() || API_VERSION,
    host: env.VIDGNOST_API_HOST?.trim() || DEFAULT_API_HOST,
    port: parsePort(env.VIDGNOST_API_PORT, DEFAULT_API_PORT),
    apiPrefix: env.VIDGNOST_API_PREFIX?.trim() || DEFAULT_API_PREFIX,
    allowOrigins: parseOrigins(env.VIDGNOST_ALLOW_ORIGINS),

    workspaceRoot,
    storageDir,
    uploadDir: resolveAppPath(env.VIDGNOST_UPLOAD_DIR, ["storage", "media"], workspaceRoot),
    tmpDir: resolveAppPath(env.VIDGNOST_TEMP_DIR, ["storage", "tmp"], workspaceRoot),

    dashscopeBaseUrl: env.VIDGNOST_DASHSCOPE_BASE_URL?.trim() || "https://dashscope.aliyuncs.com",
    dashscopeApiKey: String(env.DASHSCOPE_API_KEY || "").trim(),
    dashscopeApiKeyEnv: "DASHSCOPE_API_KEY",
    openrouterBaseUrl: env.VIDGNOST_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    openrouterApiKey: String(env.OPENROUTER_API_KEY || "").trim(),
    openrouterApiKeyEnv: "OPENROUTER_API_KEY",

    ffmpegPath: String(env.VIDGNOST_FFMPEG_BIN || "").trim(),
    ffprobePath: String(env.VIDGNOST_FFPROBE_BIN || "").trim(),
    ytdlpPath: String(env.VIDGNOST_YTDLP_BIN || "").trim(),

    whisperPython: String(env.VIDGNOST_WHISPER_PYTHON || "").trim(),
    whisperModelDir: String(env.VIDGNOST_WHISPER_MODEL_DIR || "").trim(),
    whisperDevice: parseWhisperDevice(env.VIDGNOST_WHISPER_DEVICE),
    whisperComputeType: String(env.VIDGNOST_WHISPER_COMPUTE_TYPE || "int8").trim(),

    maxConcurrentTasks: parseBoundedInt(env.VIDGNOST_MAX_CONCURRENT_TASKS, 2, 1, 8),
    asrChunkMb: parseBoundedInt(env.VIDGNOST_ASR_CHUNK_MB, 220, 8, 1024),
    requestTimeoutMs: parseBoundedInt(env.VIDGNOST_REQUEST_TIMEOUT_MS, 300_000, 10_000, 1_800_000),
  }
}

export function resolveAppPath(rawValue: string | undefined, fallbackSegments: string[], baseDir: string): string {
  const candidate = String(rawValue || "").trim()
  if (!candidate) {
    return path.resolve(baseDir, ...fallbackSegments)
  }
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(baseDir, candidate)
}

export function resolveWorkspaceRoot(startDir = process.cwd()): string {
  let currentDir = path.resolve(startDir)
  while (true) {
    if (existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir
    }
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return path.resolve(startDir)
    }
    currentDir = parentDir
  }
}

function parsePort(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(String(raw || "").trim(), 10)
  return Number.isFinite(value) && value > 0 && value <= 65535 ? value : fallback
}

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(String(raw || "").trim(), 10)
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

function parseOrigins(raw: string | undefined): string[] {
  const entries = String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return entries.length > 0 ? entries : [...DEFAULT_ALLOW_ORIGINS]
}

function parseWhisperDevice(raw: string | undefined): "auto" | "cpu" | "cuda" {
  const value = String(raw || "").trim().toLowerCase()
  return value === "cpu" || value === "cuda" ? value : "auto"
}
