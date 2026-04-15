import path from "node:path"
import { createWriteStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { pipeline } from "node:stream/promises"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import { ensureDirectory, pathExists } from "../../core/fs.js"
import { downloadFile, findCommand, runCommand } from "../../core/process.js"
import { sanitizeFilename } from "../tasks/task-support.js"

const DIRECT_MEDIA_PATTERN = /\.(mp4|mov|avi|mkv|webm|m4v)(?:$|[?#])/i

export interface PreparedSourceMedia {
  durationSeconds: number
  fileSizeBytes: number
  mediaPath: string
  sourceLabel: string
  title: string
}

export interface PreparedAudioArtifact {
  audioPath: string
  durationSeconds: number
}

export class MediaPipelineService {
  constructor(private readonly config: AppConfig) {}

  async prepareSource(input: {
    signal?: AbortSignal
    sourceInput: string
    sourceLocalPath?: string | null
    taskId: string
  }): Promise<PreparedSourceMedia> {
    const directPath = String(input.sourceLocalPath || "").trim()
    if (directPath && await pathExists(directPath)) {
      const metadata = await this.probeMedia(directPath, input.signal)
      const fileStat = await stat(directPath)
      return {
        durationSeconds: metadata.durationSeconds,
        fileSizeBytes: fileStat.size,
        mediaPath: path.normalize(directPath),
        sourceLabel: directPath,
        title: path.parse(directPath).name || input.taskId,
      }
    }

    const sourceInput = String(input.sourceInput || "").trim()
    if (!sourceInput) {
      throw AppError.badRequest("Task source is empty", {
        code: "TASK_SOURCE_INVALID",
      })
    }

    if (!looksLikeHttpUrl(sourceInput)) {
      throw AppError.badRequest("Task source path is invalid", {
        code: "TASK_SOURCE_INVALID",
      })
    }

    const downloadedPath = DIRECT_MEDIA_PATTERN.test(sourceInput)
      ? await this.downloadDirectMedia(input.taskId, sourceInput, input.signal)
      : await this.downloadWithYtDlp(input.taskId, sourceInput, input.signal)

    const metadata = await this.probeMedia(downloadedPath, input.signal)
    const fileStat = await stat(downloadedPath)
    return {
      durationSeconds: metadata.durationSeconds,
      fileSizeBytes: fileStat.size,
      mediaPath: downloadedPath,
      sourceLabel: sourceInput,
      title: path.parse(downloadedPath).name || input.taskId,
    }
  }

  async extractAudio(input: {
    mediaPath: string
    signal?: AbortSignal
    targetChannels: number
    targetSampleRate: number
    taskId: string
  }): Promise<PreparedAudioArtifact> {
    const ffmpegPath = await resolveFfmpegExecutable(this.config.ffmpegExecutable)
    if (!ffmpegPath) {
      throw AppError.conflict("未检测到 ffmpeg 可执行文件。", {
        code: "FFMPEG_NOT_FOUND",
        hint: "请安装 ffmpeg，或通过 VIDGNOST_FFMPEG_BIN 指定可执行文件路径。",
      })
    }

    const outputDir = path.join(this.config.tempDir, input.taskId)
    await ensureDirectory(outputDir)
    const audioPath = path.join(outputDir, "source-audio.wav")
    await runCommand({
      command: ffmpegPath,
      args: [
        "-y",
        "-i",
        input.mediaPath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        String(input.targetSampleRate),
        "-ac",
        String(input.targetChannels),
        audioPath,
      ],
      signal: input.signal,
    })

    const metadata = await this.probeMedia(audioPath, input.signal)
    return {
      audioPath,
      durationSeconds: metadata.durationSeconds,
    }
  }

  async probeMedia(targetPath: string, signal?: AbortSignal): Promise<{ durationSeconds: number }> {
    const ffprobePath = await resolveFfprobeExecutable(this.config.ffprobeExecutable)
    if (!ffprobePath) {
      throw AppError.conflict("未检测到 ffprobe 可执行文件。", {
        code: "FFPROBE_NOT_FOUND",
        hint: "请安装 ffprobe，或通过 VIDGNOST_FFPROBE_BIN 指定可执行文件路径。",
      })
    }

    const result = await runCommand({
      command: ffprobePath,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        targetPath,
      ],
      signal,
    })
    const payload = JSON.parse(result.stdout) as {
      format?: { duration?: string | number | null }
    }
    const duration = Number(payload.format?.duration || 0)
    if (!Number.isFinite(duration) || duration <= 0) {
      return { durationSeconds: 0 }
    }
    return {
      durationSeconds: Number(duration.toFixed(3)),
    }
  }

  private async downloadDirectMedia(taskId: string, sourceUrl: string, signal?: AbortSignal): Promise<string> {
    const fileName = sanitizeFilename(path.basename(new URL(sourceUrl).pathname || `${taskId}.mp4`))
    const targetPath = path.join(this.config.uploadDir, `${taskId}_${fileName}`)
    await ensureDirectory(path.dirname(targetPath))

    const response = await fetch(sourceUrl, {
      method: "GET",
      signal,
    })
    if (!response.ok || !response.body) {
      throw AppError.conflict("无法直接下载该视频地址。", {
        code: "REMOTE_MEDIA_DOWNLOAD_FAILED",
      })
    }

    const output = createWriteStream(targetPath)
    try {
      await pipeline(response.body, output)
      return targetPath
    } catch (error) {
      throw AppError.conflict("直接下载媒体文件失败。", {
        code: "REMOTE_MEDIA_DOWNLOAD_FAILED",
        detail: error instanceof Error ? error.message : error,
      })
    }
  }

  private async downloadWithYtDlp(taskId: string, sourceUrl: string, signal?: AbortSignal): Promise<string> {
    const ytdlpPath = await resolveYtDlpExecutable(this.config, signal)
    if (!ytdlpPath) {
      throw AppError.conflict("当前任务链接需要 yt-dlp，但未找到可用运行时。", {
        code: "YTDLP_NOT_FOUND",
        hint: "请安装 yt-dlp，或在运行环境允许自动下载 yt-dlp.exe。",
      })
    }

    const outputDir = path.join(this.config.uploadDir, `${taskId}-remote`)
    await ensureDirectory(outputDir)
    const outputTemplate = path.join(outputDir, "source.%(ext)s")
    await runCommand({
      command: ytdlpPath,
      args: [
        "--no-playlist",
        "--no-warnings",
        "--restrict-filenames",
        "--windows-filenames",
        "--merge-output-format",
        "mp4",
        "-o",
        outputTemplate,
        sourceUrl,
      ],
      signal,
    })

    const entries = await readdir(outputDir, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(outputDir, entry.name))
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return candidate
      }
    }

    throw AppError.conflict("yt-dlp 已执行，但未生成可用视频文件。", {
      code: "YTDLP_OUTPUT_MISSING",
    })
  }
}

async function resolveFfmpegExecutable(configuredPath: string): Promise<string | null> {
  return findCommand([configuredPath, "ffmpeg", "ffmpeg.exe"])
}

async function resolveFfprobeExecutable(configuredPath: string): Promise<string | null> {
  return findCommand([configuredPath, "ffprobe", "ffprobe.exe"])
}

async function resolveYtDlpExecutable(config: AppConfig, signal?: AbortSignal): Promise<string | null> {
  const discovered = await findCommand([config.ytdlpExecutable, "yt-dlp", "yt-dlp.exe"])
  if (discovered) {
    return discovered
  }

  if (process.platform !== "win32") {
    return null
  }

  const targetPath = path.join(config.runtimeBinDir, "yt-dlp.exe")
  if (await pathExists(targetPath)) {
    return targetPath
  }

  try {
    await downloadFile({
      url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
      targetPath,
      signal,
    })
    return targetPath
  } catch {
    return null
  }
}

function looksLikeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}
