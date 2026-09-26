import path from "node:path"
import { stat } from "node:fs/promises"

import { AppError } from "../core/errors.js"
import { ensureDirectory } from "../core/fs.js"
import { runCommand } from "../core/io.js"
import type { MediaService } from "./media-service.js"

export interface AudioArtifact {
  /** 归一化单声道 16k wav，供本地 Whisper 与波形使用。 */
  wavPath: string
  durationSeconds: number
}

export interface AudioChunk {
  index: number
  path: string
  /** 该分片在原视频中的起始秒。 */
  startSeconds: number
  durationSeconds: number
  bytes: number
}

export class AudioService {
  constructor(
    private readonly media: MediaService,
    private readonly config: { asrChunkMb: number; tmpDir: string; keepIntermediateMedia: boolean },
  ) {}

  /** 抽取 16k 单声道 wav。 */
  async extractWav(input: { mediaPath: string; signal?: AbortSignal; taskDir: string }): Promise<AudioArtifact> {
    const ffmpeg = await this.media.resolveFfmpeg()
    const outputDir = path.join(input.taskDir, "media")
    await ensureDirectory(outputDir)
    const wavPath = path.join(outputDir, "audio.wav")

    await runCommand({
      command: ffmpeg,
      args: [
        "-y",
        "-v",
        "error",
        "-i",
        input.mediaPath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        wavPath,
      ],
      signal: input.signal,
    })

    const probe = await this.media.probe(wavPath, input.signal)
    if (probe.durationSeconds <= 0) {
      throw AppError.unavailable("音频抽取结果为空，源文件可能没有音轨。", { code: "AUDIO_EMPTY" })
    }
    return { wavPath, durationSeconds: probe.durationSeconds }
  }

  /**
   * 为在线 ASR 生成 mp3 分片。
   * 分片时长取「20 分钟」与「单文件体积上限」的较小值，避免超限与过度冗长的异步任务。
   */
  async chunkForAsr(input: {
    durationSeconds: number
    signal?: AbortSignal
    taskDir: string
    wavPath: string
  }): Promise<AudioChunk[]> {
    const ffmpeg = await this.media.resolveFfmpeg()
    const outputDir = path.join(input.taskDir, "media", "chunks")
    await ensureDirectory(outputDir)

    const bitrateKbps = 64
    const maxBytes = this.config.asrChunkMb * 1024 * 1024
    const bySize = Math.floor((maxBytes * 8) / (bitrateKbps * 1000))
    const chunkSeconds = Math.max(120, Math.min(1200, bySize))
    const total = Math.ceil(input.durationSeconds / chunkSeconds)

    const chunks: AudioChunk[] = []
    for (let index = 0; index < total; index += 1) {
      const startSeconds = index * chunkSeconds
      const remaining = input.durationSeconds - startSeconds
      const duration = Math.min(chunkSeconds, remaining)
      const targetPath = path.join(outputDir, `chunk-${String(index).padStart(3, "0")}.mp3`)
      await runCommand({
        command: ffmpeg,
        args: [
          "-y",
          "-v",
          "error",
          "-ss",
          String(startSeconds),
          "-t",
          String(duration),
          "-i",
          input.wavPath,
          "-vn",
          "-acodec",
          "libmp3lame",
          "-b:a",
          `${bitrateKbps}k`,
          "-ac",
          "1",
          "-ar",
          "16000",
          targetPath,
        ],
        signal: input.signal,
      })
      const info = await stat(targetPath)
      chunks.push({ index, path: targetPath, startSeconds, durationSeconds: duration, bytes: info.size })
    }

    return chunks
  }
}
