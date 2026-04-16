import path from "node:path"

import type { AppConfig } from "../../core/config.js"
import { pathExists } from "../../core/fs.js"
import { findCommand } from "../../core/process.js"

export async function resolveWhisperExecutable(
  config: Pick<AppConfig, "runtimeBinDir" | "whisperExecutable">,
): Promise<string | null> {
  return findCommand(buildWhisperExecutableCandidates(config))
}

export async function resolveWhisperModelPath(modelPath: string, modelSize: string): Promise<string | null> {
  const normalized = String(modelPath || "").trim()
  if (!normalized) {
    return null
  }

  const candidates: string[] = []
  if (path.extname(normalized)) {
    candidates.push(normalized)
  } else {
    candidates.push(path.join(normalized, `ggml-${modelSize}.bin`))
    candidates.push(path.join(normalized, `${modelSize}.bin`))
    candidates.push(path.join(normalized, `whisper-${modelSize}.bin`))
  }

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return path.normalize(candidate)
    }
  }
  return null
}

function buildWhisperExecutableCandidates(
  config: Pick<AppConfig, "runtimeBinDir" | "whisperExecutable">,
): string[] {
  const runtimeBinDir = String(config.runtimeBinDir || "").trim()
  const bundledCandidates = runtimeBinDir
    ? [
        path.join(runtimeBinDir, "whisper-cli"),
        path.join(runtimeBinDir, "whisper-cli.exe"),
      ]
    : []

  return [
    String(config.whisperExecutable || "").trim(),
    ...bundledCandidates,
    "whisper-cli",
    "whisper-cli.exe",
  ]
}
