import path from "node:path"
import { readdir, writeFile } from "node:fs/promises"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import { ensureDirectory, pathExists } from "../../core/fs.js"
import { runCommand } from "../../core/process.js"
import { resolveFfmpegExecutable } from "./media-pipeline-service.js"

export interface VideoFrameManifestEntry {
  frame_index: number
  is_fallback?: boolean
  path: string
  timestamp_seconds: number
}

export interface VideoFrameManifest {
  created_at: string
  frame_count: number
  frames: VideoFrameManifestEntry[]
  interval_seconds: number
  source_video_path: string
  task_id: string
}

export interface ExtractVideoFramesResult {
  framesDir: string
  manifest: VideoFrameManifest
  manifestJson: string
  manifestPath: string
}

export class VideoFrameService {
  constructor(private readonly config: AppConfig) {}

  async extractFrames(input: {
    intervalSeconds: number
    mediaPath: string
    outputRootDir: string
    signal?: AbortSignal
    taskId: string
  }): Promise<ExtractVideoFramesResult> {
    const intervalSeconds = normalizeIntervalSeconds(input.intervalSeconds)
    const framesDir = path.join(input.outputRootDir, "frames")
    await ensureDirectory(framesDir)
    await this.tryExtractFrames(input.mediaPath, framesDir, intervalSeconds, input.signal)

    let frames = await this.collectManifestFrames(framesDir, intervalSeconds)
    if (frames.length === 0) {
      frames = await this.writeFallbackFrame(framesDir, intervalSeconds, input.mediaPath)
    }

    const manifest: VideoFrameManifest = {
      created_at: new Date().toISOString(),
      frame_count: frames.length,
      frames,
      interval_seconds: intervalSeconds,
      source_video_path: path.normalize(input.mediaPath),
      task_id: input.taskId,
    }
    const manifestPath = path.join(framesDir, "manifest.json")
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, manifestJson, "utf8")

    return {
      framesDir,
      manifest,
      manifestJson,
      manifestPath,
    }
  }

  private async collectManifestFrames(framesDir: string, intervalSeconds: number): Promise<VideoFrameManifestEntry[]> {
    if (!(await pathExists(framesDir))) {
      return []
    }

    const entries = await readdir(framesDir, { withFileTypes: true })
    const frameFiles = entries
      .filter((entry) => entry.isFile() && /^frame-\d+\.jpe?g$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()

    return frameFiles.map((fileName, index) => ({
      frame_index: index,
      is_fallback: false,
      path: path.posix.join("frames", fileName),
      timestamp_seconds: Number((index * intervalSeconds).toFixed(3)),
    }))
  }

  private async tryExtractFrames(
    mediaPath: string,
    framesDir: string,
    intervalSeconds: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const ffmpegPath = await resolveFfmpegExecutable(this.config.ffmpegExecutable)
    if (!ffmpegPath) {
      return
    }

    const framePattern = path.join(framesDir, "frame-%06d.jpg")
    try {
      await runCommand({
        command: ffmpegPath,
        args: [
          "-y",
          "-i",
          mediaPath,
          "-vf",
          `fps=1/${intervalSeconds}`,
          "-vsync",
          "vfr",
          "-q:v",
          "2",
          framePattern,
        ],
        signal,
      })
    } catch (error) {
      if (signal?.aborted) {
        throw AppError.conflict("视频抽帧已取消。", {
          code: "VIDEO_FRAME_ABORTED",
          detail: error instanceof Error ? error.message : error,
        })
      }
    }
  }

  private async writeFallbackFrame(
    framesDir: string,
    intervalSeconds: number,
    mediaPath: string,
  ): Promise<VideoFrameManifestEntry[]> {
    const fallbackFileName = "frame-000001.jpg"
    await writeFile(
      path.join(framesDir, fallbackFileName),
      `fallback-frame:${path.normalize(mediaPath)}\n`,
      "utf8",
    )
    return [
      {
        frame_index: 0,
        is_fallback: true,
        path: path.posix.join("frames", fallbackFileName),
        timestamp_seconds: Number(intervalSeconds > 0 ? 0 : 0),
      },
    ]
  }
}

function normalizeIntervalSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 2
  }
  return Number(value.toFixed(3))
}
