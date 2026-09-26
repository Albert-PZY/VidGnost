import path from "node:path"
import { statSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"

import type { MediaProbe, MediaSource, SourceKind, SourcePlatform } from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { AppError } from "../core/errors.js"
import { ensureDirectory, pathExists, sanitizeFilename } from "../core/fs.js"
import { fingerprintBuffer } from "../core/id.js"
import { downloadToFile, findCommand, runCommand } from "../core/io.js"

const DIRECT_MEDIA_PATTERN = /\.(mp4|mov|mkv|webm|m4v|avi|flv|mp3|m4a|wav|aac|flac|ogg)(?:$|[?#])/i
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"])

export class MediaService {
  constructor(private readonly config: AppConfig) {}

  async resolveSource(input: { signal?: AbortSignal; source: string; taskId: string }): Promise<MediaSource> {
    const raw = String(input.source || "").trim()
    if (!raw) {
      throw AppError.badRequest("来源为空。", { code: "SOURCE_EMPTY" })
    }

    const localPath = await resolveLocalPath(raw)
    if (localPath) {
      const probe = await this.probe(localPath, input.signal)
      const info = await stat(localPath)
      return {
        kind: classifyLocalKind(raw),
        uri: raw,
        platform: "local",
        title: path.parse(localPath).name || input.taskId,
        mediaPath: path.normalize(localPath),
        audioOnly: AUDIO_EXTENSIONS.has(path.extname(localPath).toLowerCase()),
        durationSeconds: probe.durationSeconds,
        sizeBytes: info.size,
        fingerprint: await this.fingerprint(localPath, probe.durationSeconds),
        createdAt: new Date().toISOString(),
      }
    }

    if (!isHttpUrl(raw)) {
      throw AppError.badRequest(`来源既不是可读的本地路径，也不是合法 URL：${raw}`, { code: "SOURCE_INVALID" })
    }

    const downloaded = await this.downloadRemote(raw, input.taskId, input.signal)
    const probe = await this.probe(downloaded, input.signal)
    const info = await stat(downloaded)
    return {
      kind: "url",
      uri: raw,
      platform: detectPlatform(raw),
      title: path.parse(downloaded).name || input.taskId,
      mediaPath: downloaded,
      audioOnly: AUDIO_EXTENSIONS.has(path.extname(downloaded).toLowerCase()),
      durationSeconds: probe.durationSeconds,
      sizeBytes: info.size,
      fingerprint: await this.fingerprint(downloaded, probe.durationSeconds),
      createdAt: new Date().toISOString(),
    }
  }

  async probe(targetPath: string, signal?: AbortSignal): Promise<MediaProbe> {
    const ffprobe = await this.resolveFfprobe()
    const result = await runCommand({
      command: ffprobe,
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height",
        "-of",
        "json",
        targetPath,
      ],
      signal,
    })
    const payload = JSON.parse(result.stdout) as {
      format?: { duration?: string | number | null }
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>
    }
    const streams = payload.streams || []
    const audio = streams.find((item) => item.codec_type === "audio")
    const video = streams.find((item) => item.codec_type === "video")
    const duration = Number(payload.format?.duration || 0)
    return {
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(3)) : 0,
      audioCodec: audio?.codec_name || null,
      videoCodec: video?.codec_name || null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      hasAudio: Boolean(audio),
    }
  }

  async resolveFfmpeg(): Promise<string> {
    const found = await findCommand([this.config.ffmpegPath, "ffmpeg", "ffmpeg.exe"])
    if (!found) {
      throw AppError.unavailable("未检测到 ffmpeg。", {
        code: "FFMPEG_NOT_FOUND",
        hint: "请安装 ffmpeg 并加入 PATH，或设置环境变量 VIDGNOST_FFMPEG_BIN。",
      })
    }
    return found
  }

  async resolveFfprobe(): Promise<string> {
    const found = await findCommand([this.config.ffprobePath, "ffprobe", "ffprobe.exe"])
    if (!found) {
      throw AppError.unavailable("未检测到 ffprobe。", {
        code: "FFPROBE_NOT_FOUND",
        hint: "请安装 ffprobe 并加入 PATH，或设置环境变量 VIDGNOST_FFPROBE_BIN。",
      })
    }
    return found
  }

  async resolveYtDlp(): Promise<string | null> {
    return findCommand([this.config.ytdlpPath, "yt-dlp", "yt-dlp.exe"])
  }

  /** 内容指纹：前 1MB 摘要 + 文件大小 + 时长。 */
  private async fingerprint(filePath: string, durationSeconds: number): Promise<string> {
    const head = await readHead(filePath, 1024 * 1024)
    const size = statSync(filePath).size
    return fingerprintBuffer(head, `|${size}|${durationSeconds.toFixed(3)}`)
  }

  private async downloadRemote(sourceUrl: string, taskId: string, signal?: AbortSignal): Promise<string> {
    await ensureDirectory(this.config.uploadDir)

    if (DIRECT_MEDIA_PATTERN.test(sourceUrl)) {
      const fileName = sanitizeFilename(path.basename(new URL(sourceUrl).pathname) || `${taskId}.mp4`)
      const targetPath = path.join(this.config.uploadDir, `${taskId}__${fileName}`)
      await ensureDirectory(path.dirname(targetPath))
      return downloadToFile({ url: sourceUrl, targetPath, signal })
    }

    const ytdlp = await this.resolveYtDlp()
    if (!ytdlp) {
      throw AppError.unavailable("该链接需要 yt-dlp 才能下载。", {
        code: "YTDLP_NOT_FOUND",
        hint: "请安装 yt-dlp 并加入 PATH，或设置环境变量 VIDGNOST_YTDLP_BIN。",
      })
    }

    const outputDir = path.join(this.config.uploadDir, `${taskId}__remote`)
    await ensureDirectory(outputDir)
    const outputTemplate = path.join(outputDir, "source.%(ext)s")
    await runCommand({
      command: ytdlp,
      args: [
        "--no-playlist",
        "--no-warnings",
        "--restrict-filenames",
        "--windows-filenames",
        "--merge-output-format",
        "mp4",
        "-f",
        "bv*+ba/b",
        "-o",
        outputTemplate,
        sourceUrl,
      ],
      signal,
    })

    const entries = await readdir(outputDir, { withFileTypes: true })
    const candidate = entries.find((entry) => entry.isFile() && !entry.name.endsWith(".part"))
    if (!candidate) {
      throw AppError.unavailable("yt-dlp 已执行，但未生成媒体文件。", { code: "YTDLP_OUTPUT_MISSING" })
    }
    return path.join(outputDir, candidate.name)
  }
}

async function resolveLocalPath(raw: string): Promise<string | null> {
  if (raw.startsWith("file://")) {
    try {
      const { fileURLToPath } = await import("node:url")
      const resolved = fileURLToPath(raw)
      return (await pathExists(resolved)) ? resolved : null
    } catch {
      return null
    }
  }
  if (isHttpUrl(raw)) {
    return null
  }
  if (await pathExists(raw)) {
    return path.resolve(raw)
  }
  const quoted = raw.replace(/^["']|["']$/g, "")
  if (quoted !== raw && (await pathExists(quoted))) {
    return path.resolve(quoted)
  }
  return null
}

function classifyLocalKind(raw: string): SourceKind {
  return /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(raw) || raw.startsWith("file://") ? "local_path" : "local_file"
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function detectPlatform(raw: string): SourcePlatform {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      return "youtube"
    }
    if (host.includes("bilibili.com") || host.includes("b23.tv")) {
      return "bilibili"
    }
    if (DIRECT_MEDIA_PATTERN.test(raw)) {
      return "direct"
    }
    return "other"
  } catch {
    return "other"
  }
}

async function readHead(filePath: string, bytes: number): Promise<Buffer> {
  const fs = await import("node:fs/promises")
  const handle = await fs.open(filePath, "r")
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
