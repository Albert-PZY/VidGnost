import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../core/config.js"
import { AppError } from "../core/errors.js"
import { LlmConfigRepository } from "../modules/llm/llm-config-repository.js"
import { OpenAiCompatibleClient } from "../modules/llm/openai-compatible-client.js"
import { StudyService } from "../modules/study/study-service.js"
import { TaskRepository } from "../modules/tasks/task-repository.js"
import { buildContentDisposition, renderMarkmapHtml } from "../modules/tasks/task-support.js"
import {
  buildBundleFiles,
  buildNotesExportFiles,
  buildZipPayload,
  normalizeExportKind,
  normalizePublicStatus,
  normalizeTaskId,
  type ExportParams,
  type TaskIdParams,
} from "./task-route-support.js"

interface ExportQuery {
  archive?: string
}

export async function registerTaskExportRoutes(
  app: FastifyInstance,
  config: AppConfig,
  apiPrefix: string,
  taskRepository: TaskRepository,
): Promise<void> {
  app.get(`${apiPrefix}/tasks/:taskId/export/:kind`, async (request, reply) => {
    const { taskId } = request.params as ExportParams
    const { kind } = request.params as ExportParams
    const query = request.query as ExportQuery
    const normalizedTaskId = normalizeTaskId({ taskId })
    const exportKind = normalizeExportKind(kind)
    const archive = String(query.archive || "zip").trim().toLowerCase()
    const record = await requireTask(taskRepository, normalizedTaskId)

    if (normalizePublicStatus(record.status) !== "completed") {
      throw AppError.conflict("Task is not completed", {
        code: "TASK_NOT_COMPLETED",
      })
    }
    if (archive !== "zip") {
      throw AppError.badRequest("Unsupported archive format", {
        code: "TASK_EXPORT_ARCHIVE_UNSUPPORTED",
      })
    }

    const downloadTitle = String(record.title || normalizedTaskId).trim().replace(/\s+/g, " ") || normalizedTaskId

    if (
      exportKind === "study_pack" ||
      exportKind === "subtitle_tracks" ||
      exportKind === "translation_records" ||
      exportKind === "knowledge_notes"
    ) {
      const studyService = new StudyService(config, taskRepository, {
        llmClient: new OpenAiCompatibleClient(),
        llmConfigRepository: new LlmConfigRepository(config),
      })
      try {
        const formatted = await studyService.formatTaskExport(normalizedTaskId, exportKind)
        reply.header("Content-Type", formatted.content_type)
        reply.header("Content-Disposition", buildContentDisposition(formatted.file_name))
        return reply.send(formatted.content)
      } finally {
        await studyService.close()
      }
    }

    if (exportKind === "transcript") {
      reply.header("Content-Type", "text/plain; charset=utf-8")
      reply.header("Content-Disposition", buildContentDisposition(`${downloadTitle}-transcript.txt`))
      return reply.send(String(record.transcript_text || ""))
    }

    if (exportKind === "notes") {
      const files = await buildNotesExportFiles(taskRepository, normalizedTaskId, downloadTitle, String(record.notes_markdown || ""))
      if (Object.keys(files).length === 1) {
        reply.header("Content-Type", "text/markdown; charset=utf-8")
        reply.header("Content-Disposition", buildContentDisposition(`${downloadTitle}-notes.md`))
        return reply.send(String(record.notes_markdown || ""))
      }

      const payload = await buildZipPayload(files)
      reply.header("Content-Type", "application/zip")
      reply.header("Content-Disposition", buildContentDisposition(`${downloadTitle}-notes.zip`))
      return reply.send(payload)
    }

    if (exportKind === "mindmap") {
      const html = renderMarkmapHtml(String(record.mindmap_markdown || "# Empty"), String(record.title || normalizedTaskId))
      reply.header("Content-Type", "text/html; charset=utf-8")
      reply.header("Content-Disposition", buildContentDisposition(`${downloadTitle}-mindmap.html`))
      return reply.send(html)
    }

    if (exportKind === "srt") {
      const files = await buildBundleFiles(taskRepository, normalizedTaskId, downloadTitle, record)
      reply.header("Content-Type", "text/plain; charset=utf-8")
      reply.header("Content-Disposition", buildContentDisposition(`${downloadTitle}-subtitles.srt`))
      return reply.send(files[`${downloadTitle}-subtitles.srt`])
    }

    if (exportKind === "vtt") {
      const files = await buildBundleFiles(taskRepository, normalizedTaskId, downloadTitle, record)
      reply.header("Content-Type", "text/vtt; charset=utf-8")
      reply.header("Content-Disposition", buildContentDisposition(`${downloadTitle}-subtitles.vtt`))
      return reply.send(files[`${downloadTitle}-subtitles.vtt`])
    }

    const bundleFiles = await buildBundleFiles(taskRepository, normalizedTaskId, downloadTitle, record)
    const payload = await buildZipPayload(bundleFiles)
    reply.header("Content-Type", "application/zip")
    reply.header("Content-Disposition", buildContentDisposition(`${downloadTitle}-artifacts.zip`))
    return reply.send(payload)
  })
}

async function requireTask(taskRepository: TaskRepository, taskId: string) {
  const record = await taskRepository.getStoredRecord(taskId)
  if (!record) {
    throw AppError.notFound("Task not found", {
      code: "TASK_NOT_FOUND",
    })
  }
  return record
}
