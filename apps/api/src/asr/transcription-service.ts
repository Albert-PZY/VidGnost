import type { TranscriptDoc, TranscriptSegment, TaskOptions } from "@vidgnost/contracts"

import { AppError, describeError } from "../core/errors.js"
import { logger } from "../core/logger.js"
import type { AudioService } from "../media/audio-service.js"
import type { ModelGateway } from "../providers/gateway.js"
import type { AsrSentence } from "../providers/dashscope.js"

const log = logger.child({ scope: "asr" })

export interface TranscribeInput {
  audio: { wavPath: string; durationSeconds: number }
  language: string
  mediaPath: string
  onProgress?: (message: string) => void
  onSegment?: (segment: TranscriptSegment) => void
  options: TaskOptions
  signal?: AbortSignal
  taskDir: string
}

export interface TranscribeOutput {
  transcript: TranscriptDoc
  /** 是否发生了引擎回退。 */
  degraded: boolean
}

/**
 * 转写编排：在线文件级 ASR 优先，失败或显式选择本地时回退 `faster-whisper`。
 */
export class TranscriptionService {
  constructor(
    private readonly gateway: ModelGateway,
    private readonly audio: AudioService,
  ) {}

  async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
    const preference = input.options.asr
    const canOnline = await this.gateway.hasCredential("dashscope")

    if (preference === "local") {
      return { transcript: await this.runLocal(input), degraded: false }
    }

    if (!canOnline) {
      if (preference === "online") {
        throw AppError.unavailable("已指定在线转写，但百炼提供方缺少可用密钥。", {
          code: "ASR_ONLINE_UNAVAILABLE",
          hint: "请设置环境变量 DASHSCOPE_API_KEY，或把转写偏好改为本地。",
        })
      }
      input.onProgress?.("未检测到百炼密钥，回退到本地 Whisper。")
      return { transcript: await this.runLocal(input), degraded: true }
    }

    try {
      return { transcript: await this.runOnline(input), degraded: false }
    } catch (error) {
      if (preference === "online") {
        throw error
      }
      input.onProgress?.(`在线转写失败（${describeError(error)}），回退到本地 Whisper。`)
      log.warn({ error: describeError(error) }, "online asr failed, falling back to local whisper")
      return { transcript: await this.runLocal(input), degraded: true }
    }
  }

  private async runOnline(input: TranscribeInput): Promise<TranscriptDoc> {
    const chunks = await this.audio.chunkForAsr({
      wavPath: input.audio.wavPath,
      taskDir: input.taskDir,
      durationSeconds: input.audio.durationSeconds,
      signal: input.signal,
    })
    input.onProgress?.(`已切分 ${chunks.length} 个音频分片，开始在线转写。`)

    const segments: TranscriptSegment[] = []
    let language = input.language === "auto" ? "" : input.language
    let model = ""
    let engineDetail = ""
    let cursor = 0

    for (const chunk of chunks) {
      input.onProgress?.(`转写分片 ${chunk.index + 1}/${chunks.length}…`)
      const result = await this.gateway.transcribeOnline({
        filePath: chunk.path,
        language: input.language,
        signal: input.signal,
        onProgress: (message) => input.onProgress?.(`分片 ${chunk.index + 1}/${chunks.length} · ${message}`),
      })
      model = result.model
      language = language || result.language
      engineDetail = result.provider

      const offsetMs = Math.round(chunk.startSeconds * 1000)
      for (const sentence of result.sentences) {
        const segment = toSegment(sentence, offsetMs, cursor)
        cursor += 1
        segments.push(segment)
        input.onSegment?.(segment)
      }
    }

    if (segments.length === 0) {
      throw AppError.unavailable("在线转写未返回任何句子。", { code: "ASR_EMPTY_RESULT" })
    }

    return buildTranscriptDoc({
      segments,
      language: language || "zh",
      engine: "dashscope-filetrans",
      engineDetail: `${engineDetail} · ${chunks.length} 分片 · ${model}`,
      durationSeconds: input.audio.durationSeconds,
    })
  }

  private async runLocal(input: TranscribeInput): Promise<TranscriptDoc> {
    const settings = await this.gateway.settings.getSettings()
    const result = await this.gateway.localWhisper.transcribe({
      audioPath: input.audio.wavPath,
      pythonExecutable: settings.whisper.pythonExecutable,
      modelDir: settings.whisper.modelDir,
      device: settings.whisper.device,
      computeType: settings.whisper.computeType,
      language: input.language,
      signal: input.signal,
      onStatus: (message) => input.onProgress?.(message),
      onSegment: (segment) => {
        input.onSegment?.({
          id: `seg-local-${Math.round(segment.start * 1000)}`,
          start: segment.start,
          end: segment.end,
          text: segment.text,
        })
      },
    })

    const segments = result.sentences.map((sentence, index) =>
      toSegment(sentence, 0, index),
    )
    if (segments.length === 0) {
      throw AppError.unavailable("本地 Whisper 未返回任何片段。", { code: "ASR_EMPTY_RESULT" })
    }

    return buildTranscriptDoc({
      segments,
      language: result.language || input.language || "zh",
      engine: "faster-whisper",
      engineDetail: result.detail,
      durationSeconds: input.audio.durationSeconds,
    })
  }
}

function toSegment(sentence: AsrSentence, offsetMs: number, index: number): TranscriptSegment {
  const start = (sentence.beginTimeMs + offsetMs) / 1000
  const end = Math.max(start + 0.2, (sentence.endTimeMs + offsetMs) / 1000)
  return {
    id: `seg-${String(index).padStart(5, "0")}`,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    text: sentence.text,
    ...(sentence.words && sentence.words.length > 0
      ? {
          words: sentence.words.map((word) => ({
            start: Number(((word.beginTimeMs + offsetMs) / 1000).toFixed(3)),
            end: Number(((word.endTimeMs + offsetMs) / 1000).toFixed(3)),
            text: word.text,
          })),
        }
      : {}),
  }
}

export function buildTranscriptDoc(input: {
  durationSeconds: number
  engine: TranscriptDoc["engine"]
  engineDetail: string
  language: string
  segments: TranscriptSegment[]
}): TranscriptDoc {
  const speakers = [...new Set(input.segments.map((segment) => segment.speaker).filter(Boolean))] as string[]
  const normalized = normalizeSegments(input.segments)
  const text = normalized.map((segment) => segment.text).join("\n")
  return {
    language: input.language,
    engine: input.engine,
    engineDetail: input.engineDetail,
    durationSeconds: Number(input.durationSeconds.toFixed(3)),
    speakers,
    segments: normalized,
    text,
    createdAt: new Date().toISOString(),
  }
}

/** 合并重叠 / 空片段，并保证时间单调递增。 */
export function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const cleaned = segments
    .map((segment) => ({ ...segment, text: String(segment.text || "").replace(/\s+/g, " ").trim() }))
    .filter((segment) => segment.text.length > 0)
    .sort((a, b) => a.start - b.start)

  const merged: TranscriptSegment[] = []
  for (const segment of cleaned) {
    const previous = merged[merged.length - 1]
    if (
      previous &&
      previous.text === segment.text &&
      segment.start - previous.end < 1
    ) {
      previous.end = Math.max(previous.end, segment.end)
      continue
    }
    if (previous && segment.start < previous.start) {
      segment.start = previous.start
    }
    merged.push(segment)
  }
  return merged
}

export function transcriptToSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((segment, index) => {
      const body = segment.speaker ? `[${segment.speaker}] ${segment.text}` : segment.text
      return `${index + 1}\n${srtTime(segment.start)} --> ${srtTime(segment.end)}\n${body}\n`
    })
    .join("\n")
}

function srtTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`
}
