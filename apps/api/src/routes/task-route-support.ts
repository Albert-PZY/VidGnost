import path from "node:path"
import { Buffer } from "node:buffer"
import { createWriteStream } from "node:fs"
import { readdir, readFile, stat, unlink } from "node:fs/promises"
import { pipeline } from "node:stream/promises"

import type { MultipartFile } from "@fastify/multipart"
import JSZip from "jszip"

import type { TaskCreateResponse, TaskExportKind, WorkflowType } from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { AppError } from "../core/errors.js"
import { ensureDirectory } from "../core/fs.js"
import type { TaskOrchestrator } from "../modules/tasks/task-orchestrator.js"
import type { StoredTaskRecord, TaskRepository } from "../modules/tasks/task-repository.js"
import {
  buildSrt,
  buildTaskCreateResponse,
  buildVtt,
  createEmptyStageLogs,
  createEmptyStageMetrics,
  parseTranscriptSegments,
  renderMarkmapHtml,
  sanitizeFilename,
} from "../modules/tasks/task-support.js"

export interface TaskIdParams {
  taskId?: string
}

export interface ExportParams extends TaskIdParams {
  kind?: string
}

export const ALLOWED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"])

export function normalizeTaskId(params: TaskIdParams): string {
  const taskId = String(params.taskId || "").trim()
  if (!taskId) {
    throw AppError.badRequest("Task id is required", {
      code: "TASK_ID_INVALID",
    })
  }
  return taskId
}

export function normalizeWorkflow(value: unknown): WorkflowType {
  return String(value || "").trim().toLowerCase() === "vqa" ? "vqa" : "notes"
}

export function normalizePublicStatus(value: unknown): TaskCreateResponse["status"] {
  const status = String(value || "").trim().toLowerCase()
  if (["queued", "running", "preparing", "transcribing", "summarizing", "paused", "completed", "failed", "cancelled"].includes(status)) {
    return status as TaskCreateResponse["status"]
  }
  return "queued"
}

export function createTaskId(): string {
  const now = new Date()
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    "-",
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
    "-",
    Math.random().toString(36).slice(2, 6),
  ].join("")
  return `task-${stamp}`
}

export function inferContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".mp4":
      return "video/mp4"
    case ".webm":
      return "video/webm"
    case ".mov":
      return "video/quicktime"
    case ".m4v":
      return "video/x-m4v"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".svg":
      return "image/svg+xml"
    case ".md":
      return "text/markdown; charset=utf-8"
    case ".txt":
    case ".srt":
      return "text/plain; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".html":
      return "text/html; charset=utf-8"
    case ".vtt":
      return "text/vtt; charset=utf-8"
    default:
      return "application/octet-stream"
  }
}

export function parseByteRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader || "").trim())
  if (!match) {
    return null
  }
  const startText = match[1]
  const endText = match[2]
  if (!startText && !endText) {
    return null
  }
  if (!startText) {
    const suffixLength = Number.parseInt(endText, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null
    }
    const start = Math.max(0, fileSize - suffixLength)
    return { start, end: fileSize - 1 }
  }
  const start = Number.parseInt(startText, 10)
  if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
    return null
  }
  const end = endText ? Number.parseInt(endText, 10) : fileSize - 1
  if (!Number.isFinite(end) || end < start) {
    return null
  }
  return {
    start,
    end: Math.min(end, fileSize - 1),
  }
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

export async function assertLocalVideoPath(localPath: string) {
  if (!localPath) {
    throw AppError.badRequest("Local path is required", {
      code: "LOCAL_PATH_INVALID",
    })
  }
  assertVideoExtension(localPath)
  try {
    const fileStat = await stat(localPath)
    if (!fileStat.isFile()) {
      throw new Error("Local path is not a file")
    }
    return fileStat
  } catch {
    throw AppError.badRequest(`Local path not found: ${localPath}`, {
      code: "LOCAL_PATH_NOT_FOUND",
    })
  }
}

export function assertVideoExtension(filePath: string): void {
  const extension = path.extname(String(filePath || "")).toLowerCase()
  if (!ALLOWED_VIDEO_EXTENSIONS.has(extension)) {
    throw AppError.badRequest(`Unsupported extension ${extension}`, {
      code: "UNSUPPORTED_VIDEO_EXTENSION",
      hint: `支持的格式：${[...ALLOWED_VIDEO_EXTENSIONS].sort().join(", ")}`,
    })
  }
}

export async function persistUploadedFile(file: MultipartFile, targetPath: string, maxBytes: number): Promise<number> {
  await ensureDirectory(path.dirname(targetPath))
  const output = createWriteStream(targetPath)
  let size = 0

  file.file.on("data", (chunk: Buffer) => {
    size += chunk.length
    if (size > maxBytes) {
      file.file.destroy(new Error("UPLOAD_FILE_TOO_LARGE"))
      output.destroy(new Error("UPLOAD_FILE_TOO_LARGE"))
    }
  })

  try {
    await pipeline(file.file, output)
    return size
  } catch (error) {
    await unlink(targetPath).catch(() => undefined)
    if (error instanceof Error && error.message === "UPLOAD_FILE_TOO_LARGE") {
      throw AppError.badRequest("File too large", {
        code: "UPLOAD_FILE_TOO_LARGE",
        hint: "请压缩视频或分片上传。",
      })
    }
    throw error
  }
}

export function buildQueuedTaskRecord(input: {
  createdAt: string
  fileSizeBytes?: number
  language: string
  modelSize?: string
  sourceInput: string
  sourceLocalPath?: string | null
  sourceType: "bilibili" | "local_file" | "local_path"
  taskId: string
  title?: string | null
  workflow: WorkflowType
}): StoredTaskRecord {
  return {
    id: input.taskId,
    source_type: input.sourceType,
    source_input: input.sourceInput,
    source_local_path: input.sourceLocalPath ?? null,
    title: input.title ?? null,
    status: "queued",
    progress: 0,
    model_size: input.modelSize || "small",
    language: input.language || "zh",
    workflow: input.workflow,
    file_size_bytes: input.fileSizeBytes,
    stage_logs_json: JSON.stringify(createEmptyStageLogs()),
    stage_metrics_json: JSON.stringify(createEmptyStageMetrics()),
    created_at: input.createdAt,
    updated_at: input.createdAt,
  }
}

export async function createTaskFromMultipartFile(input: {
  config: AppConfig
  file: MultipartFile
  language: string
  taskOrchestrator: TaskOrchestrator
  taskRepository: TaskRepository
  workflow: WorkflowType
}): Promise<TaskCreateResponse> {
  const fileName = input.file.filename || "uploaded-video"
  assertVideoExtension(fileName)
  const taskId = createTaskId()
  const createdAt = new Date().toISOString()
  const targetPath = path.join(input.config.uploadDir, `${taskId}_${sanitizeFilename(fileName)}`)
  const fileSizeBytes = await persistUploadedFile(input.file, targetPath, input.config.maxUploadMb * 1024 * 1024)

  await input.taskRepository.create(
    buildQueuedTaskRecord({
      createdAt,
      fileSizeBytes,
      language: input.language,
      sourceInput: fileName,
      sourceLocalPath: targetPath,
      sourceType: "local_file",
      taskId,
      title: path.parse(fileName).name,
      workflow: input.workflow,
    }),
  )

  await input.taskOrchestrator.submit({
    taskId,
    sourceInput: fileName,
    sourceLocalPath: targetPath,
    workflow: input.workflow,
  })

  return buildTaskCreateResponse({
    taskId,
    status: "queued",
    workflow: input.workflow,
  })
}

export async function buildNotesExportFiles(
  taskRepository: TaskRepository,
  taskId: string,
  title: string,
  notesMarkdown: string,
): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {
    [`${title}-notes.md`]: Buffer.from(notesMarkdown || "", "utf8"),
  }
  const notesImagesDir = taskRepository.resolveArtifactPath(taskId, "notes-images")
  if (!(await fileExists(notesImagesDir))) {
    return files
  }
  const imagePaths = await collectFilesRecursively(notesImagesDir)
  await Promise.all(
    imagePaths.map(async (imagePath) => {
      const relativePath = path.relative(notesImagesDir, imagePath).replace(/\\/g, "/")
      files[`notes-images/${relativePath}`] = await readFile(imagePath)
    }),
  )
  return files
}

export async function buildBundleFiles(
  taskRepository: TaskRepository,
  taskId: string,
  title: string,
  record: StoredTaskRecord,
): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {
    [`${title}-transcript.txt`]: Buffer.from(String(record.transcript_text || ""), "utf8"),
    [`${title}-notes.md`]: Buffer.from(String(record.notes_markdown || ""), "utf8"),
    [`${title}-mindmap.md`]: Buffer.from(String(record.mindmap_markdown || ""), "utf8"),
    [`${title}-mindmap.html`]: Buffer.from(
      renderMarkmapHtml(String(record.mindmap_markdown || "# Empty"), String(record.title || taskId)),
      "utf8",
    ),
    [`${title}-subtitles.srt`]: Buffer.from(buildSrt(parseTranscriptSegments(record.transcript_segments_json)), "utf8"),
    [`${title}-subtitles.vtt`]: Buffer.from(buildVtt(parseTranscriptSegments(record.transcript_segments_json)), "utf8"),
  }
  const noteFiles = await buildNotesExportFiles(taskRepository, taskId, title, String(record.notes_markdown || ""))
  Object.entries(noteFiles).forEach(([fileName, content]) => {
    if (fileName !== `${title}-notes.md`) {
      files[fileName] = content
    }
  })
  return files
}

export async function buildZipPayload(files: Record<string, Buffer>): Promise<Buffer> {
  const archive = new JSZip()
  Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([name, content]) => {
      archive.file(name, content)
    })
  return archive.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  })
}

export function normalizeExportKind(kind: string | undefined): TaskExportKind {
  const normalized = String(kind || "").trim().toLowerCase()
  if (["transcript", "notes", "mindmap", "srt", "vtt", "bundle"].includes(normalized)) {
    return normalized as TaskExportKind
  }
  throw AppError.badRequest("Unsupported export kind", {
    code: "INVALID_EXPORT_KIND",
  })
}

async function collectFilesRecursively(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(absolutePath)))
      continue
    }
    files.push(absolutePath)
  }
  return files
}
