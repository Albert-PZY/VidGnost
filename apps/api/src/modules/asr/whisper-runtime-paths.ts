import path from "node:path"

import { resolveAppPath, type AppConfig } from "../../core/config.js"
import { pathExists } from "../../core/fs.js"
import { findCommand } from "../../core/process.js"

const MODEL_CONFIG_FILE = "config.json"
const MODEL_BINARY_FILE = "model.bin"

export async function resolveWhisperPythonExecutable(
  config: Pick<AppConfig, "runtimeBinDir" | "whisperPythonExecutable">,
): Promise<string | null> {
  return findCommand(buildWhisperPythonCandidates(config))
}

export async function resolveWhisperModelPath(modelPath: string, modelSize: string): Promise<string | null> {
  const normalized = String(modelPath || "").trim()
  if (!normalized) {
    return null
  }

  const candidates = buildWhisperModelCandidates(normalized, modelSize)
  for (const candidate of candidates) {
    if (await isFasterWhisperModelDirectory(candidate)) {
      return path.normalize(candidate)
    }
  }
  return null
}

export async function buildWhisperLibraryPaths(): Promise<string[]> {
  const candidates = [
    process.env.VIDGNOST_OLLAMA_LIB_DIR,
    process.env.OLLAMA_LIB_DIR,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "lib", "ollama") : "",
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)

  const discovered = new Set<string>()
  for (const root of candidates) {
    for (const candidate of [
      root,
      path.join(root, "cuda_v12"),
      path.join(root, "cuda_v13"),
      path.join(root, "mlx_cuda_v13"),
      path.join(root, "vulkan"),
      path.join(root, "rocm"),
    ]) {
      if (await pathExists(candidate)) {
        discovered.add(path.normalize(candidate))
      }
    }
  }

  return [...discovered]
}

export function resolveWhisperWorkerScriptPath(): string {
  return resolveAppPath(undefined, ["apps", "api", "python", "transcribe_faster_whisper.py"])
}

async function isFasterWhisperModelDirectory(candidate: string): Promise<boolean> {
  return (await pathExists(path.join(candidate, MODEL_CONFIG_FILE))) &&
    (await pathExists(path.join(candidate, MODEL_BINARY_FILE)))
}

function buildWhisperModelCandidates(normalizedPath: string, modelSize: string): string[] {
  const candidates = new Set<string>()
  const normalized = path.normalize(normalizedPath)
  candidates.add(normalized)

  if (!path.extname(normalized)) {
    for (const suffix of [
      "whisper-default",
      modelSize,
      `faster-whisper-${modelSize}`,
      `faster_whisper_${modelSize}`,
      `faster-whisper-${modelSize}-v3`,
    ]) {
      candidates.add(path.join(normalized, suffix))
    }
  }

  return [...candidates]
}

function buildWhisperPythonCandidates(
  config: Pick<AppConfig, "runtimeBinDir" | "whisperPythonExecutable">,
): string[] {
  const workspacePython = resolveAppPath(undefined, [
    "apps",
    "api",
    "python",
    ".venv",
    process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"),
  ])
  const runtimeBinDir = String(config.runtimeBinDir || "").trim()
  const bundledCandidates = runtimeBinDir
    ? [
        path.join(
          runtimeBinDir,
          "python",
          process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"),
        ),
      ]
    : []

  return [
    String(config.whisperPythonExecutable || "").trim(),
    workspacePython,
    ...bundledCandidates,
    "python",
    process.platform === "win32" ? "py" : "python3",
  ]
}
