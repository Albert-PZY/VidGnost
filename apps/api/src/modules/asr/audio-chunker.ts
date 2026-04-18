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

const FAST_START_CHUNK_SECONDS = 8
const MAX_LIVE_CHUNK_SECONDS = 30

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
    const plan = planAudioChunks({
      durationSeconds,
      requestedChunkSeconds: chunkSeconds,
    })

    if (plan.length <= 1) {
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
    for (const chunkPlan of plan) {
      const chunkPath = path.join(outputDir, `chunk-${String(chunkPlan.index + 1).padStart(3, "0")}.wav`)
      await runCommand({
        command: ffmpegPath,
        args: [
          "-y",
          "-i",
          sourceAudioPath,
          "-ss",
          formatSeconds(chunkPlan.startSeconds),
          "-t",
          formatSeconds(chunkPlan.durationSeconds),
          "-vn",
          "-c",
          "copy",
          chunkPath,
        ],
        signal: input.signal,
      })
      chunks.push({
        audioPath: chunkPath,
        durationSeconds: chunkPlan.durationSeconds,
        index: chunkPlan.index,
        startSeconds: chunkPlan.startSeconds,
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

export function planAudioChunks(input: {
  durationSeconds: number
  requestedChunkSeconds: number
}): Array<Pick<AudioChunkDescriptor, "durationSeconds" | "index" | "startSeconds">> {
  const durationSeconds = Number(input.durationSeconds)
  const requestedChunkSeconds = Number(input.requestedChunkSeconds)

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [{
      durationSeconds: 0,
      index: 0,
      startSeconds: 0,
    }]
  }

  const effectiveChunkSeconds = resolveLiveChunkSeconds(requestedChunkSeconds)
  if (durationSeconds <= effectiveChunkSeconds) {
    return [{
      durationSeconds: Number(durationSeconds.toFixed(3)),
      index: 0,
      startSeconds: 0,
    }]
  }

  const firstChunkSeconds = Math.min(FAST_START_CHUNK_SECONDS, effectiveChunkSeconds)
  const chunks: Array<Pick<AudioChunkDescriptor, "durationSeconds" | "index" | "startSeconds">> = []
  let startSeconds = 0
  let index = 0

  while (startSeconds < durationSeconds) {
    const chunkLimitSeconds = index === 0 ? firstChunkSeconds : effectiveChunkSeconds
    const remainingSeconds = Math.max(0, durationSeconds - startSeconds)
    const nextDuration = Number(Math.min(chunkLimitSeconds, remainingSeconds).toFixed(3))
    if (nextDuration <= 0) {
      break
    }

    chunks.push({
      durationSeconds: nextDuration,
      index,
      startSeconds: Number(startSeconds.toFixed(3)),
    })

    startSeconds = Number((startSeconds + nextDuration).toFixed(3))
    index += 1
  }

  return chunks
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

function resolveLiveChunkSeconds(requestedChunkSeconds: number): number {
  if (!Number.isFinite(requestedChunkSeconds) || requestedChunkSeconds <= 0) {
    return MAX_LIVE_CHUNK_SECONDS
  }
  return Math.max(FAST_START_CHUNK_SECONDS, Math.min(MAX_LIVE_CHUNK_SECONDS, requestedChunkSeconds))
}
