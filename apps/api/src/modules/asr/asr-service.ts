import path from "node:path"

import type { TranscriptSegment } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import { pathExists } from "../../core/fs.js"
import { findCommand } from "../../core/process.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { WhisperRuntimeConfigRepository } from "../runtime/whisper-runtime-config-repository.js"
import {
  buildTranscriptText,
  hasInvalidSegmentTimestamps,
  normalizeRemoteSegments,
  parseWhisperSrtSegments,
} from "./transcript-segment-normalizer.js"
import { WhisperCliRunner } from "./whisper-cli-runner.js"

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
    private readonly whisperCliRunner: Pick<WhisperCliRunner, "run"> = new WhisperCliRunner(),
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
      if (hasInvalidSegmentTimestamps(remote.segments)) {
        throw AppError.conflict("远程转写返回了异常时间戳。", {
          code: "ASR_REMOTE_TIMESTAMPS_INVALID",
          detail: remote.raw,
        })
      }
      const normalizedSegments = normalizeRemoteSegments(remote.segments)
      if (normalizedSegments.length === 0 && String(remote.text || "").trim()) {
        throw AppError.conflict("远程转写返回了全文，但没有可用的 segments。", {
          code: "ASR_REMOTE_SEGMENTS_EMPTY",
          detail: remote.raw,
        })
      }
      const normalizedText = buildTranscriptText(normalizedSegments) || String(remote.text || "").trim()
      if (!normalizedText) {
        throw AppError.conflict("远程转写返回了空结果。", {
          code: "ASR_EMPTY_RESPONSE",
          detail: remote.raw,
        })
      }
      return {
        language: remote.language || whisperConfig.language,
        segments: normalizedSegments,
        text: normalizedText,
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
    const cliResult = await this.whisperCliRunner.run({
      executablePath,
      modelPath,
      audioPath: input.audioPath,
      language: whisperConfig.language,
      outputDir,
      signal: input.signal,
    })
    const segments = parseWhisperSrtSegments(cliResult.rawSrt)
    const text = buildTranscriptText(segments)
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
