import path from "node:path"

import type { TranscriptSegment } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { WhisperRuntimeConfigRepository } from "../runtime/whisper-runtime-config-repository.js"
import {
  buildTranscriptText,
  hasInvalidSegmentTimestamps,
  normalizeRemoteSegments,
} from "./transcript-segment-normalizer.js"
import { FasterWhisperRunner } from "./faster-whisper-runner.js"
import { resolveWhisperModelPath } from "./whisper-runtime-paths.js"

export interface AsrResult {
  chunks: AsrChunkResult[]
  language: string
  segments: TranscriptSegment[]
  text: string
}

export interface AsrChunkResult {
  durationSeconds: number
  index: number
  segments: TranscriptSegment[]
  startSeconds: number
}

export class AsrService {
  constructor(
    private readonly config: AppConfig,
    private readonly modelCatalogRepository: ModelCatalogRepository,
    private readonly whisperRuntimeConfigRepository: WhisperRuntimeConfigRepository,
    private readonly llmClient: OpenAiCompatibleClient,
    private readonly fasterWhisperRunner: Pick<FasterWhisperRunner, "run" | "shutdown"> = new FasterWhisperRunner(config),
  ) {}

  async transcribe(input: {
    audioPath: string
    onChunkComplete?: (payload: { chunkIndex: number; chunkTotal: number }) => Promise<void> | void
    onLog?: (message: string) => Promise<void> | void
    onReset?: () => Promise<void> | void
    onSegment?: (segment: TranscriptSegment) => Promise<void> | void
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

    await input.onReset?.()

    const useRemoteTranscription =
      whisperModel.provider === "openai_compatible" &&
      whisperModel.api_base_url.trim() &&
      whisperModel.api_model.trim()
    const modelPath = !useRemoteTranscription
      ? await resolveWhisperModelPath(whisperModel.path, whisperConfig.model_default)
      : ""

    if (!useRemoteTranscription && !modelPath) {
      throw AppError.conflict("未找到可用的 faster-whisper 模型目录。", {
        code: "WHISPER_MODEL_NOT_FOUND",
        hint: "请在设置中为 Whisper 模型配置本地 faster-whisper 模型目录。",
      })
    }

    const transcription = useRemoteTranscription
      ? await this.transcribeRemote({
        apiBaseUrl: whisperModel.api_base_url,
        apiKey: whisperModel.api_key,
        audioPath: input.audioPath,
        language: whisperConfig.language,
        model: whisperModel.api_model,
        onSegment: input.onSegment,
        timeoutSeconds: whisperModel.api_timeout_seconds,
      })
      : await this.transcribeLocal({
        audioPath: input.audioPath,
        beamSize: whisperConfig.beam_size,
        computeType: whisperConfig.compute_type,
        device: whisperConfig.device,
        language: whisperConfig.language,
        modelPath: modelPath || "",
        onLog: input.onLog,
        onSegment: input.onSegment,
        outputDir: path.join(this.config.tempDir, input.taskId, "whisper-output"),
        signal: input.signal,
        vadFilter: true,
      })

    const text = buildTranscriptText(transcription.segments)
    if (!text) {
      throw AppError.conflict("faster-whisper 未返回有效转写结果。", {
        code: "WHISPER_EMPTY_RESULT",
      })
    }

    return {
      chunks: [buildSyntheticChunk(transcription.segments)],
      language: transcription.language,
      segments: transcription.segments,
      text,
    }
  }

  async shutdown(): Promise<void> {
    await this.fasterWhisperRunner.shutdown?.()
  }

  private async transcribeRemote(input: {
    apiBaseUrl: string
    apiKey: string
    audioPath: string
    language: string
    model: string
    onSegment?: (segment: TranscriptSegment) => Promise<void> | void
    timeoutSeconds: number
  }): Promise<{ language: string; segments: TranscriptSegment[] }> {
    const remote = await this.llmClient.transcribeAudio({
      apiBaseUrl: input.apiBaseUrl,
      apiKey: input.apiKey,
      audioPath: input.audioPath,
      language: input.language,
      model: input.model,
      timeoutSeconds: input.timeoutSeconds,
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

    for (const segment of normalizedSegments) {
      await input.onSegment?.(segment)
    }

    return {
      language: String(remote.language || input.language || "").trim(),
      segments: normalizedSegments,
    }
  }

  private async transcribeLocal(input: {
    audioPath: string
    beamSize: number
    computeType: string
    device: string
    language: string
    modelPath: string
    onLog?: (message: string) => Promise<void> | void
    onSegment?: (segment: TranscriptSegment) => Promise<void> | void
    outputDir: string
    signal?: AbortSignal
    vadFilter: boolean
  }): Promise<{ language: string; segments: TranscriptSegment[] }> {
    const streamedSegments: TranscriptSegment[] = []
    try {
      await input.onLog?.("Streaming transcription started")
      const runtimeResult = await this.fasterWhisperRunner.run({
        audioPath: input.audioPath,
        beamSize: input.beamSize,
        computeType: input.computeType,
        device: input.device,
        language: input.language,
        modelPath: input.modelPath,
        onSegment: async (segment) => {
          const normalizedSegment = normalizeRemoteSegments([segment])[0]
          if (!normalizedSegment) {
            return
          }
          streamedSegments.push(normalizedSegment)
          await input.onSegment?.(normalizedSegment)
        },
        outputDir: input.outputDir,
        signal: input.signal,
        vadFilter: input.vadFilter,
      })
      const normalizedSegments = streamedSegments.length > 0
        ? streamedSegments
        : normalizeRemoteSegments(runtimeResult.segments)
      await input.onLog?.("Streaming transcription completed")
      return {
        language: runtimeResult.language || input.language,
        segments: normalizedSegments,
      }
    } catch (error) {
      throw AppError.conflict("faster-whisper 本地转写执行失败。", {
        code: "WHISPER_LOCAL_EXECUTION_FAILED",
        detail: error instanceof Error ? error.message : String(error),
        hint: "请确认 Python 运行时、faster-whisper 依赖以及 CUDA/cuDNN 运行库均可用。",
      })
    }
  }
}

function buildSyntheticChunk(segments: TranscriptSegment[]): AsrChunkResult {
  const durationSeconds = Math.max(0, ...segments.map((segment) => Number(segment.end) || 0))
  return {
    durationSeconds,
    index: 0,
    segments,
    startSeconds: 0,
  }
}
