import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"

import type { FastifyInstance } from "fastify"

import { AppError } from "../core/errors.js"
import type { AppContext } from "../server/app-context.js"

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
}

/**
 * 媒体与关键帧的本地回放通道。
 * 支持 Range 请求，播放器可以精确 seek 到引用时间码，实现「点击引用跳转播放」。
 */
export async function registerMediaRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const base = `${context.config.apiPrefix}/tasks/:taskId`

  app.get(`${base}/media`, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const task = await context.store.requireTask(taskId)
    const mediaPath = task.source.mediaPath
    if (!mediaPath) {
      throw AppError.notFound("任务尚未准备好媒体文件。", { code: "MEDIA_NOT_READY" })
    }
    return streamFile(request, reply, mediaPath)
  })

  app.get(`${base}/frames/:frameId`, async (request, reply) => {
    const { frameId, taskId } = request.params as { frameId: string; taskId: string }
    const framesDoc = await context.store.artifactJson<{ frames: Array<{ id: string; path: string }> }>(taskId, "frames")
    const frame = framesDoc?.frames.find((item) => item.id === frameId)
    if (!frame) {
      throw AppError.notFound(`关键帧不存在：${frameId}`, { code: "FRAME_NOT_FOUND" })
    }
    const absolute = `${context.store.taskDir(taskId)}/${frame.path}`.replace(/\\/g, "/")
    return streamFile(request, reply, absolute)
  })
}

async function streamFile(
  request: { headers: Record<string, unknown> },
  reply: {
    header: (name: string, value: string) => unknown
    code: (status: number) => unknown
    send: (payload: unknown) => unknown
  },
  filePath: string,
) {
  const info = await stat(filePath).catch(() => null)
  if (!info || !info.isFile()) {
    throw AppError.notFound(`文件不存在：${filePath}`, { code: "MEDIA_FILE_MISSING" })
  }

  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream"
  const rangeHeader = String(request.headers.range || "")
  const range = parseRange(rangeHeader, info.size)

  reply.header("Accept-Ranges", "bytes")
  reply.header("Content-Type", contentType)
  reply.header("Cache-Control", "private, max-age=3600")

  if (!range) {
    reply.header("Content-Length", String(info.size))
    reply.code(200)
    return reply.send(createReadStream(filePath))
  }

  const { end, start } = range
  reply.header("Content-Length", String(end - start + 1))
  reply.header("Content-Range", `bytes ${start}-${end}/${info.size}`)
  reply.code(206)
  return reply.send(createReadStream(filePath, { start, end }))
}

function parseRange(header: string, size: number): { end: number; start: number } | null {
  const match = header.match(/bytes=(\d*)-(\d*)/)
  if (!match) {
    return null
  }
  const start = match[1] ? Number(match[1]) : 0
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isFinite(start) || start >= size || start > end) {
    return null
  }
  return { start, end }
}
