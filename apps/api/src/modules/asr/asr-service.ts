import path from "node:path"
import { readFile } from "node:fs/promises"

import type { TranscriptSegment } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import { ensureDirectory, pathExists } from "../../core/fs.js"
import { findCommand, runCommand } from "../../core/process.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { WhisperRuntimeConfigRepository } from "../runtime/whisper-runtime-config-repository.js"

export interface AsrResult {
  language: string
  segments: TranscriptSegment[]
  text: string
}

export class AsrService {
  constructor(
    private readonly config: AppConfig,
    private readonly modelCatalogRepository: ModelCatalogRepository,
    private readonly whisperRuntimeConfigRepository: WhisperRuntimeConfigRepository,
    private readonly llmClient: OpenAiCompatibleClient,
  ) {}

  async transcribe(input: {
    audioPath: string
    signal?: AbortSignal
    taskId: string
  }): Promise<AsrResult> {
    const whisperConfig = await this.whisperRuntimeConfigRepository.get()
    const catalog = await this.modelCatalogRepository.listModels()
    const whisperModel = catalog.items.find((item) => item.id === "whisper-default")
    if (!whisperModel) {
      throw AppError.conflict("未找到 Whisper 模型配置。", {
        code: "WHISPER_MODEL_CONFIG_MISSING",
      })
    }

    if (whisperModel.provider === "openai_compatible" && whisperModel.api_base_url.trim() && whisperModel.api_model.trim()) {
      const remote = await this.llmClient.transcribeAudio({
        apiBaseUrl: whisperModel.api_base_url,
        apiKey: whisperModel.api_key,
        audioPath: input.audioPath,
        language: whisperConfig.language,
        model: whisperModel.api_model,
        timeoutSeconds: whisperModel.api_timeout_seconds,
      })
      return {
        language: remote.language || whisperConfig.language,
        segments: remote.segments.map((segment) => ({
          ...segment,
          text: segment.text,
        })),
        text: remote.text,
      }
    }

    const executablePath = await resolveWhisperExecutable(this.config.whisperExecutable)
    if (!executablePath) {
      throw AppError.conflict("未检测到 whisper.cpp CLI。", {
        code: "WHISPER_EXECUTABLE_NOT_FOUND",
        hint: "请安装 whisper-cli，或通过 VIDGNOST_WHISPER_BIN 指定可执行文件路径。",
      })
    }

    const modelPath = await resolveWhisperModelPath(whisperModel.path, whisperConfig.model_default)
    if (!modelPath) {
      throw AppError.conflict("未找到可用的 whisper.cpp 模型文件。", {
        code: "WHISPER_MODEL_NOT_FOUND",
        hint: "请在设置中为 Whisper 模型配置本地 ggml 模型文件。",
      })
    }

    const outputDir = path.join(this.config.tempDir, input.taskId, "whisper-output")
    await ensureDirectory(outputDir)
    const outputBase = path.join(outputDir, "transcript")
    await runCommand({
      command: executablePath,
      args: [
        "-m",
        modelPath,
        "-f",
        input.audioPath,
        "-l",
        whisperConfig.language,
        "-osrt",
        "-of",
        outputBase,
      ],
      signal: input.signal,
    })

    const srtPath = `${outputBase}.srt`
    const rawSrt = await readFile(srtPath, "utf8").catch(() => "")
    const segments = parseSrtSegments(rawSrt)
    const text = segments.map((item) => item.text).join("\n").trim()
    if (!text) {
      throw AppError.conflict("whisper.cpp 未返回有效转写结果。", {
        code: "WHISPER_EMPTY_RESULT",
      })
    }

    return {
      language: whisperConfig.language,
      segments,
      text,
    }
  }
}

async function resolveWhisperExecutable(configuredPath: string): Promise<string | null> {
  return findCommand([configuredPath, "whisper-cli", "whisper-cli.exe"])
}

async function resolveWhisperModelPath(modelPath: string, modelSize: string): Promise<string | null> {
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

function parseSrtSegments(rawSrt: string): TranscriptSegment[] {
  return rawSrt
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const timestampLine = lines.find((line) => line.includes("-->")) || ""
      const textLines = lines.filter((line) => line !== timestampLine && !/^\d+$/.test(line))
      const [startText, endText] = timestampLine.split("-->").map((item) => item.trim())
      return {
        start: parseSrtTimestamp(startText),
        end: parseSrtTimestamp(endText),
        text: textLines.join(" ").trim(),
      }
    })
    .filter((item) => item.text.length > 0)
}

function parseSrtTimestamp(value: string | undefined): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(String(value || "").trim())
  if (!match) {
    return 0
  }
  const hours = Number(match[1]) || 0
  const minutes = Number(match[2]) || 0
  const seconds = Number(match[3]) || 0
  const milliseconds = Number(match[4]) || 0
  return Number((hours * 3600 + minutes * 60 + seconds + milliseconds / 1000).toFixed(3))
}
