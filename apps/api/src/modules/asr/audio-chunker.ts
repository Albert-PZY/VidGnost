import path from "node:path"

import type { AppConfig } from "../../core/config.js"
import { ensureDirectory } from "../../core/fs.js"
import { findCommand, runCommand } from "../../core/process.js"

export interface AudioChunkDescriptor {
  audioPath: string
  durationSeconds: number
  index: number
  startSeconds: number
}

export class AudioChunker {
  constructor(private readonly config: AppConfig) {}

  async split(input: {
    audioPath: string
    chunkSeconds: number
    signal?: AbortSignal
    taskId: string
  }): Promise<AudioChunkDescriptor[]> {
    const sourceAudioPath = path.normalize(input.audioPath)
    const chunkSeconds = Number(input.chunkSeconds)
    const durationSeconds = await probeAudioDuration(this.config, sourceAudioPath, input.signal)

    if (!Number.isFinite(chunkSeconds) || chunkSeconds <= 0 || durationSeconds <= 0 || durationSeconds <= chunkSeconds) {
      return [{
        audioPath: sourceAudioPath,
        durationSeconds: durationSeconds > 0 ? Number(durationSeconds.toFixed(3)) : 0,
        index: 0,
        startSeconds: 0,
      }]
    }

    const ffmpegPath = await resolveFfmpegExecutable(this.config)
    if (!ffmpegPath) {
      return [{
        audioPath: sourceAudioPath,
        durationSeconds: Number(durationSeconds.toFixed(3)),
        index: 0,
        startSeconds: 0,
      }]
    }

    const outputDir = path.join(this.config.tempDir, input.taskId, "chunks")
    await ensureDirectory(outputDir)

    const chunks: AudioChunkDescriptor[] = []
    const chunkCount = Math.max(1, Math.ceil(durationSeconds / chunkSeconds))
    for (let index = 0; index < chunkCount; index += 1) {
      const startSeconds = Number((index * chunkSeconds).toFixed(3))
      const remainingSeconds = Math.max(0, durationSeconds - startSeconds)
      const nextDuration = Number(Math.min(chunkSeconds, remainingSeconds).toFixed(3))
      if (nextDuration <= 0) {
        continue
      }

      const chunkPath = path.join(outputDir, `chunk-${String(index + 1).padStart(3, "0")}.wav`)
      await runCommand({
        command: ffmpegPath,
        args: [
          "-y",
          "-i",
          sourceAudioPath,
          "-ss",
          formatSeconds(startSeconds),
          "-t",
          formatSeconds(nextDuration),
          "-vn",
          "-c",
          "copy",
          chunkPath,
        ],
        signal: input.signal,
      })
      chunks.push({
        audioPath: chunkPath,
        durationSeconds: nextDuration,
        index,
        startSeconds,
      })
    }

    return chunks.length > 0 ? chunks : [{
      audioPath: sourceAudioPath,
      durationSeconds: Number(durationSeconds.toFixed(3)),
      index: 0,
      startSeconds: 0,
    }]
  }
}

async function probeAudioDuration(config: AppConfig, audioPath: string, signal?: AbortSignal): Promise<number> {
  const ffprobePath = await resolveFfprobeExecutable(config)
  if (!ffprobePath) {
    return 0
  }

  try {
    const result = await runCommand({
      command: ffprobePath,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        audioPath,
      ],
      signal,
    })
    const payload = JSON.parse(result.stdout) as {
      format?: { duration?: number | string | null }
    }
    const durationSeconds = Number(payload.format?.duration || 0)
    return Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Number(durationSeconds.toFixed(3))
      : 0
  } catch {
    return 0
  }
}

async function resolveFfmpegExecutable(config: AppConfig): Promise<string | null> {
  return findCommand([config.ffmpegExecutable, "ffmpeg", "ffmpeg.exe"])
}

async function resolveFfprobeExecutable(config: AppConfig): Promise<string | null> {
  return findCommand([config.ffprobeExecutable, "ffprobe", "ffprobe.exe"])
}

function formatSeconds(value: number): string {
  return Number(value || 0).toFixed(3)
}
