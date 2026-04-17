import path from "node:path"

import type { FastifyInstance } from "fastify"

import type {
  TaskArtifactsUpdateRequest,
  TaskBatchCreateResponse,
  TaskCreateFromPathRequest,
  TaskCreateFromUrlRequest,
  TaskCreateResponse,
  TaskDetailResponse,
  TaskTitleUpdateRequest,
  TaskSummaryItem,
} from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { AppError } from "../core/errors.js"
import { TaskOrchestrator } from "../modules/tasks/task-orchestrator.js"
import { TaskRepository } from "../modules/tasks/task-repository.js"
import { buildTaskCreateResponse, normalizeDate, normalizeSourceType, sanitizeFilename } from "../modules/tasks/task-support.js"
import {
  assertLocalVideoPath,
  assertVideoExtension,
  buildQueuedTaskRecord,
  createTaskFromMultipartFile,
  createTaskId,
  normalizePublicStatus,
  normalizeTaskId,
  normalizeWorkflow,
  persistUploadedFile,
  type TaskIdParams,
} from "./task-route-support.js"

export async function registerTaskMutationRoutes(
  app: FastifyInstance,
  config: AppConfig,
  apiPrefix: string,
  taskRepository: TaskRepository,
  taskOrchestrator: TaskOrchestrator,
): Promise<void> {
  app.post(`${apiPrefix}/tasks/url`, async (request): Promise<TaskCreateResponse> => {
    const payload = request.body as TaskCreateFromUrlRequest
    const workflow = normalizeWorkflow(payload.workflow)
    const taskId = createTaskId()
    const createdAt = new Date().toISOString()

    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt,
        language: String(payload.language || "zh"),
        modelSize: String(payload.model_size || "small"),
        sourceInput: String(payload.url || "").trim(),
        sourceType: "bilibili",
        taskId,
        workflow,
      }),
    )

    await taskOrchestrator.submit({
      taskId,
      sourceInput: String(payload.url || "").trim(),
      workflow,
    })

    return buildTaskCreateResponse({
      taskId,
      status: "queued",
      workflow,
    })
  })

  app.post(`${apiPrefix}/tasks/path`, async (request): Promise<TaskCreateResponse> => {
    const payload = request.body as TaskCreateFromPathRequest
    const localPath = path.resolve(String(payload.local_path || "").trim())
    const fileStat = await assertLocalVideoPath(localPath)
    const workflow = normalizeWorkflow(payload.workflow)
    const taskId = createTaskId()
    const createdAt = new Date().toISOString()

    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt,
        fileSizeBytes: fileStat.size,
        language: String(payload.language || "zh"),
        modelSize: String(payload.model_size || "small"),
        sourceInput: localPath,
        sourceLocalPath: localPath,
        sourceType: "local_path",
        taskId,
        title: path.parse(localPath).name,
        workflow,
      }),
    )

    await taskOrchestrator.submit({
      taskId,
      sourceInput: localPath,
      sourceLocalPath: localPath,
      workflow,
    })

    return buildTaskCreateResponse({
      taskId,
      status: "queued",
      workflow,
    })
  })

  app.post(`${apiPrefix}/tasks/upload`, async (request): Promise<TaskCreateResponse> => {
    const uploaded = await request.file()
    if (!uploaded) {
      throw AppError.badRequest("No file uploaded", {
        code: "UPLOAD_FILES_EMPTY",
      })
    }

    const fields = collectMultipartFields(uploaded.fields)
    return createTaskFromMultipartFile({
      config,
      file: uploaded,
      language: fields.language || "zh",
      taskOrchestrator,
      taskRepository,
      workflow: normalizeWorkflow(fields.workflow),
    })
  })

  app.post(`${apiPrefix}/tasks/upload/batch`, async (request): Promise<TaskBatchCreateResponse> => {
    const stagedUploads: Array<{
      fileName: string
      fileSizeBytes: number
      taskId: string
      targetPath: string
    }> = []
    const fields: Record<string, string> = {}

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const fileName = part.filename || "uploaded-video"
        assertVideoExtension(fileName)
        const taskId = createTaskId()
        const targetPath = path.join(config.uploadDir, `${taskId}_${sanitizeFilename(fileName)}`)
        const fileSizeBytes = await persistUploadedFile(part, targetPath, config.maxUploadMb * 1024 * 1024)
        stagedUploads.push({
          fileName,
          fileSizeBytes,
          targetPath,
          taskId,
        })
        continue
      }
      fields[part.fieldname] = String(part.value || "")
    }

    if (stagedUploads.length === 0) {
      throw AppError.badRequest("No files uploaded", {
        code: "UPLOAD_FILES_EMPTY",
        hint: "请至少上传一个视频文件。",
      })
    }

    if ((fields.strategy || "single_task_per_file") !== "single_task_per_file") {
      throw AppError.badRequest("Unsupported strategy", {
        code: "UPLOAD_STRATEGY_UNSUPPORTED",
        hint: "当前版本支持 single_task_per_file。",
      })
    }

    const workflow = normalizeWorkflow(fields.workflow)
    const tasks = []
    for (const upload of stagedUploads) {
      const createdAt = new Date().toISOString()
      await taskRepository.create(
        buildQueuedTaskRecord({
          createdAt,
          fileSizeBytes: upload.fileSizeBytes,
          language: fields.language || "zh",
          sourceInput: upload.fileName,
          sourceLocalPath: upload.targetPath,
          sourceType: "local_file",
          taskId: upload.taskId,
          title: path.parse(upload.fileName).name,
          workflow,
        }),
      )

      await taskOrchestrator.submit({
        taskId: upload.taskId,
        sourceInput: upload.fileName,
        sourceLocalPath: upload.targetPath,
        workflow,
      })

      tasks.push(buildTaskCreateResponse({
        taskId: upload.taskId,
        status: "queued",
        workflow,
      }))
    }

    return {
      strategy: "single_task_per_file",
      tasks,
    }
  })

  app.patch(`${apiPrefix}/tasks/:taskId/title`, async (request): Promise<TaskSummaryItem> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const payload = request.body as TaskTitleUpdateRequest
    const nextTitle = String(payload.title || "").trim()
    if (!nextTitle) {
      throw AppError.badRequest("title cannot be empty", {
        code: "EMPTY_TASK_TITLE",
      })
    }

    const record = await requireTask(taskRepository, taskId)
    const updated = await taskRepository.update(taskId, {
      title: nextTitle,
    })

    return {
      id: String(updated.id || taskId),
      title: updated.title || null,
      workflow: normalizeWorkflow(updated.workflow),
      source_type: normalizeSourceType(updated.source_type),
      source_input: String(updated.source_input || ""),
      status: normalizePublicStatus(updated.status),
      progress: clampProgress(updated.progress),
      file_size_bytes: Number(updated.file_size_bytes) || 0,
      duration_seconds: normalizeNullableNumber(updated.duration_seconds),
      created_at: normalizeDate(updated.created_at),
      updated_at: normalizeDate(updated.updated_at),
    }
  })

  app.patch(`${apiPrefix}/tasks/:taskId/artifacts`, async (request): Promise<TaskDetailResponse> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const payload = request.body as TaskArtifactsUpdateRequest
    const record = await requireTask(taskRepository, taskId)
    const publicStatus = normalizePublicStatus(record.status)
    if (!["completed", "failed", "cancelled"].includes(publicStatus)) {
      throw AppError.conflict("Task artifacts can only be edited after task finished", {
        code: "TASK_ARTIFACT_EDIT_FORBIDDEN",
      })
    }

    if (
      payload.summary_markdown === undefined &&
      payload.notes_markdown === undefined &&
      payload.mindmap_markdown === undefined
    ) {
      return (await taskRepository.getDetail(taskId)) as TaskDetailResponse
    }

    await taskRepository.update(taskId, {
      ...(payload.summary_markdown !== undefined ? { summary_markdown: payload.summary_markdown } : {}),
      ...(payload.notes_markdown !== undefined ? { notes_markdown: payload.notes_markdown } : {}),
      ...(payload.mindmap_markdown !== undefined ? { mindmap_markdown: payload.mindmap_markdown } : {}),
    })

    if (payload.summary_markdown !== undefined) {
      await taskRepository.writeTaskArtifactText(taskId, "D/fusion/summary.md", payload.summary_markdown || "")
    }
    if (payload.notes_markdown !== undefined) {
      await taskRepository.writeTaskArtifactText(taskId, "D/fusion/notes.md", payload.notes_markdown || "")
    }
    if (payload.mindmap_markdown !== undefined) {
      await taskRepository.writeTaskArtifactText(taskId, "D/fusion/mindmap.md", payload.mindmap_markdown || "")
    }

    await taskRepository.syncArtifactIndex(taskId)
    return (await taskRepository.getDetail(taskId)) as TaskDetailResponse
  })

  app.delete(`${apiPrefix}/tasks/:taskId`, async (request, reply) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    await requireTask(taskRepository, taskId)
    await taskOrchestrator.cancelAndWait(taskId)
    await taskRepository.delete(taskId)
    reply.code(204)
    return reply.send()
  })

  app.post(`${apiPrefix}/tasks/:taskId/cancel`, async (request): Promise<TaskCreateResponse> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const record = await requireTask(taskRepository, taskId)
    const publicStatus = normalizePublicStatus(record.status)
    if (["completed", "failed", "cancelled"].includes(publicStatus)) {
      throw AppError.conflict("Task is already finished", {
        code: "TASK_ALREADY_FINISHED",
      })
    }

    const cancelled = await taskOrchestrator.cancel(taskId)
    if (!cancelled) {
      throw AppError.conflict("Task is already finished", {
        code: "TASK_ALREADY_FINISHED",
      })
    }

    return buildTaskCreateResponse({
      taskId,
      status: "cancelled",
      workflow: normalizeWorkflow(record.workflow),
    })
  })

  app.post(`${apiPrefix}/tasks/:taskId/pause`, async (request): Promise<TaskCreateResponse> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const record = await requireTask(taskRepository, taskId)
    const publicStatus = normalizePublicStatus(record.status)
    if (["completed", "failed", "cancelled"].includes(publicStatus)) {
      throw AppError.conflict("Task is already finished", {
        code: "TASK_ALREADY_FINISHED",
      })
    }
    if (publicStatus === "paused") {
      throw AppError.conflict("Task is already paused", {
        code: "TASK_ALREADY_PAUSED",
      })
    }

    const paused = await taskOrchestrator.pause(taskId)
    if (!paused) {
      throw AppError.conflict("Task cannot be paused", {
        code: "TASK_PAUSE_FORBIDDEN",
      })
    }

    return buildTaskCreateResponse({
      taskId,
      status: "paused",
      workflow: normalizeWorkflow(record.workflow),
    })
  })

  app.post(`${apiPrefix}/tasks/:taskId/resume`, async (request): Promise<TaskCreateResponse> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const record = await requireTask(taskRepository, taskId)
    if (normalizePublicStatus(record.status) !== "paused") {
      throw AppError.conflict("Only paused tasks can resume", {
        code: "TASK_NOT_PAUSED",
      })
    }

    const resumed = await taskOrchestrator.resume(taskId)
    if (!resumed) {
      throw AppError.conflict("Task is already running", {
        code: "TASK_ALREADY_RUNNING",
      })
    }

    return buildTaskCreateResponse({
      taskId,
      status: "queued",
      workflow: normalizeWorkflow(record.workflow),
    })
  })

  app.post(`${apiPrefix}/tasks/:taskId/rerun-stage-d`, async (request): Promise<TaskCreateResponse> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const record = await requireTask(taskRepository, taskId)
    const publicStatus = normalizePublicStatus(record.status)
    if (!["completed", "failed", "cancelled"].includes(publicStatus)) {
      throw AppError.conflict("Only terminal tasks can rerun stage D", {
        code: "TASK_NOT_TERMINAL",
      })
    }
    if (!String(record.transcript_text || "").trim() && !String(record.transcript_segments_json || "").trim()) {
      throw AppError.badRequest("Task has no persisted transcript artifacts", {
        code: "TASK_TRANSCRIPT_MISSING",
      })
    }

    const started = await taskOrchestrator.rerunStageD(taskId)
    if (!started) {
      throw AppError.conflict("Task is already running", {
        code: "TASK_ALREADY_RUNNING",
      })
    }

    return buildTaskCreateResponse({
      taskId,
      status: "summarizing",
      workflow: normalizeWorkflow(record.workflow),
    })
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

function collectMultipartFields(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields || {}).map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, String(value[0]?.value || "")]
      }
      return [key, String((value as { value?: unknown } | undefined)?.value || "")]
    }),
  )
}

function clampProgress(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function normalizeNullableNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
