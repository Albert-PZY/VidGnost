import path from "node:path"

import type { TranscriptSegment } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { WhisperRuntimeConfigRepository } from "../runtime/whisper-runtime-config-repository.js"
import { AudioChunker, type AudioChunkDescriptor } from "./audio-chunker.js"
import {
  buildTranscriptText,
  hasInvalidSegmentTimestamps,
  normalizeRemoteSegments,
  parseWhisperSrtSegments,
} from "./transcript-segment-normalizer.js"
import { resolveWhisperExecutable, resolveWhisperModelPath } from "./whisper-runtime-paths.js"
import { WhisperCliRunner } from "./whisper-cli-runner.js"

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
    private readonly whisperCliRunner: Pick<WhisperCliRunner, "run"> = new WhisperCliRunner(),
    private readonly audioChunker: Pick<AudioChunker, "split"> = new AudioChunker(config),
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

    const chunks = await this.audioChunker.split({
      audioPath: input.audioPath,
      chunkSeconds: whisperConfig.chunk_seconds,
      signal: input.signal,
      taskId: input.taskId,
    })
    await input.onReset?.()
    const isChunked = chunks.length > 1
    if (isChunked) {
      await input.onLog?.("Splitting audio into chunks ...")
      for (const chunk of chunks) {
        await input.onLog?.(buildChunkPreparedLog(chunk, chunks.length))
      }
    }

    const useRemoteTranscription =
      whisperModel.provider === "openai_compatible" &&
      whisperModel.api_base_url.trim() &&
      whisperModel.api_model.trim()
    const executablePath = !useRemoteTranscription ? await resolveWhisperExecutable(this.config) : ""
    const modelPath = !useRemoteTranscription
      ? await resolveWhisperModelPath(whisperModel.path, whisperConfig.model_default)
      : ""

    if (!useRemoteTranscription && !executablePath) {
      throw AppError.conflict("未检测到 whisper.cpp CLI。", {
        code: "WHISPER_EXECUTABLE_NOT_FOUND",
        hint: "请安装 whisper-cli，或通过 VIDGNOST_WHISPER_BIN 指定可执行文件路径。",
      })
    }

    if (!useRemoteTranscription && !modelPath) {
      throw AppError.conflict("未找到可用的 whisper.cpp 模型文件。", {
        code: "WHISPER_MODEL_NOT_FOUND",
        hint: "请在设置中为 Whisper 模型配置本地 ggml 模型文件。",
      })
    }
    const localExecutablePath = executablePath || ""
    const localModelPath = modelPath || ""

    let detectedLanguage = whisperConfig.language
    const mergedSegments: TranscriptSegment[] = []
    const chunkResults: AsrChunkResult[] = []
    for (const chunk of chunks) {
      if (isChunked) {
        await input.onLog?.(`Transcribing chunk ${chunk.index + 1}/${chunks.length}: ${path.basename(chunk.audioPath)}`)
      }
      const chunkTranscription = useRemoteTranscription
        ? await this.transcribeRemoteChunk({
          apiBaseUrl: whisperModel.api_base_url,
          apiKey: whisperModel.api_key,
          audioPath: chunk.audioPath,
          language: whisperConfig.language,
          model: whisperModel.api_model,
          timeoutSeconds: whisperModel.api_timeout_seconds,
        })
        : await this.transcribeLocalChunk({
          audioPath: chunk.audioPath,
          executablePath: localExecutablePath,
          language: whisperConfig.language,
          modelPath: localModelPath,
          outputDir: path.join(this.config.tempDir, input.taskId, "whisper-output", `chunk-${String(chunk.index + 1).padStart(3, "0")}`),
          signal: input.signal,
        })
      detectedLanguage = String(chunkTranscription.language || "").trim() || detectedLanguage
      const rawSegments = chunkTranscription.segments
      const absoluteSegments = rawSegments.map((segment) => offsetTranscriptSegment(segment, chunk.startSeconds))
      chunkResults.push({
        durationSeconds: chunk.durationSeconds,
        index: chunk.index,
        segments: absoluteSegments,
        startSeconds: chunk.startSeconds,
      })
      mergedSegments.push(...absoluteSegments)
      for (const segment of absoluteSegments) {
        await input.onSegment?.(segment)
      }
      if (isChunked) {
        await input.onLog?.(`Chunk ${chunk.index + 1}/${chunks.length} transcription completed`)
      }
      await input.onChunkComplete?.({
        chunkIndex: chunk.index,
        chunkTotal: chunks.length,
      })
    }

    const text = buildTranscriptText(mergedSegments)
    if (!text) {
      throw AppError.conflict("whisper.cpp 未返回有效转写结果。", {
        code: "WHISPER_EMPTY_RESULT",
      })
    }

    return {
      chunks: chunkResults,
      language: detectedLanguage,
      segments: mergedSegments,
      text,
    }
  }

  private async transcribeRemoteChunk(input: {
    apiBaseUrl: string
    apiKey: string
    audioPath: string
    language: string
    model: string
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
    return {
      language: String(remote.language || input.language || "").trim(),
      segments: normalizedSegments,
    }
  }

  private async transcribeLocalChunk(input: {
    audioPath: string
    executablePath: string
    language: string
    modelPath: string
    outputDir: string
    signal?: AbortSignal
  }): Promise<{ language: string; segments: TranscriptSegment[] }> {
    const cliResult = await this.whisperCliRunner.run({
      executablePath: input.executablePath,
      modelPath: input.modelPath,
      audioPath: input.audioPath,
      language: input.language,
      outputDir: input.outputDir,
      signal: input.signal,
    })
    return {
      language: input.language,
      segments: parseWhisperSrtSegments(cliResult.rawSrt),
    }
  }
}

function buildChunkPreparedLog(chunk: AudioChunkDescriptor, totalChunks: number): string {
  return `Chunk ${chunk.index + 1}/${totalChunks}: ${path.basename(chunk.audioPath)}, start ${chunk.startSeconds.toFixed(3)}s, duration ${chunk.durationSeconds.toFixed(3)}s`
}

function offsetTranscriptSegment(segment: TranscriptSegment, offsetSeconds: number): TranscriptSegment {
  return {
    ...segment,
    start: Number((segment.start + offsetSeconds).toFixed(3)),
    end: Number((segment.end + offsetSeconds).toFixed(3)),
  }
}
