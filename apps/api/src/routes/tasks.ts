import path from "node:path"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"

import type { FastifyInstance } from "fastify"

import type { TaskDetailResponse, TaskListResponse, TaskRecentResponse, TaskStatsResponse } from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import { TaskRepository } from "../modules/tasks/task-repository.js"
import {
  fileExists,
  inferContentType,
  normalizeTaskId,
  parseByteRange,
  type TaskIdParams,
} from "./task-route-support.js"

interface TaskQuery {
  limit?: number | string
  offset?: number | string
  q?: string
  sort_by?: string
  status?: string
  workflow?: string
}

interface ArtifactQuery {
  path?: string
}

export async function registerTaskRoutes(
  app: FastifyInstance,
  apiPrefix: string,
  taskRepository: TaskRepository,
): Promise<void> {
  app.get(`${apiPrefix}/tasks/stats`, async (): Promise<TaskStatsResponse> => {
    return taskRepository.stats()
  })

  app.get(`${apiPrefix}/tasks/recent`, async (request): Promise<TaskRecentResponse> => {
    const query = request.query as TaskQuery
    return taskRepository.recent(parseBoundedInteger(query.limit, 3, 1, 20))
  })

  app.get(`${apiPrefix}/tasks`, async (request): Promise<TaskListResponse> => {
    const query = request.query as TaskQuery
    const workflow = String(query.workflow || "").trim().toLowerCase()
    const sortBy = String(query.sort_by || "date").trim().toLowerCase()

    return taskRepository.list({
      limit: parseBoundedInteger(query.limit, 50, 1, 200),
      offset: parseBoundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
      q: normalizeOptionalString(query.q),
      sortBy: sortBy === "name" || sortBy === "size" ? sortBy : "date",
      status: normalizeOptionalString(query.status),
      workflow: workflow === "notes" || workflow === "vqa" ? workflow : undefined,
    })
  })

  app.get(`${apiPrefix}/tasks/:taskId/source-media`, async (request, reply) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const mediaPath = await taskRepository.resolveSourceMediaPath(taskId)
    if (!mediaPath) {
      throw AppError.notFound("Task source media not found", {
        code: "TASK_SOURCE_MEDIA_NOT_FOUND",
      })
    }

    const fileStat = await stat(mediaPath)
    const rangeHeader = request.headers.range
    const contentType = inferContentType(mediaPath)
    reply.header("Accept-Ranges", "bytes")

    if (!rangeHeader) {
      reply.header("Content-Type", contentType)
      reply.header("Content-Length", String(fileStat.size))
      return reply.send(createReadStream(mediaPath))
    }

    const range = parseByteRange(rangeHeader, fileStat.size)
    if (!range) {
      reply.code(416)
      reply.header("Content-Range", `bytes */${fileStat.size}`)
      return reply.send()
    }

    reply.code(206)
    reply.header("Content-Type", contentType)
    reply.header("Content-Length", String(range.end - range.start + 1))
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${fileStat.size}`)
    return reply.send(createReadStream(mediaPath, { start: range.start, end: range.end }))
  })

  app.get(`${apiPrefix}/tasks/:taskId/artifacts/file`, async (request, reply) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const query = request.query as ArtifactQuery
    const relativePath = String(query.path || "").trim()
    if (!relativePath) {
      throw AppError.badRequest("Task artifact path is required", {
        code: "TASK_ARTIFACT_PATH_INVALID",
      })
    }

    let targetPath = ""
    try {
      targetPath = taskRepository.resolveArtifactPath(taskId, relativePath)
    } catch (error) {
      throw AppError.badRequest("Invalid artifact path", {
        code: "TASK_ARTIFACT_PATH_INVALID",
        detail: error instanceof Error ? error.message : error,
      })
    }

    if (!(await fileExists(targetPath))) {
      throw AppError.notFound("Task artifact not found", {
        code: "TASK_ARTIFACT_NOT_FOUND",
      })
    }

    reply.header("Content-Type", inferContentType(targetPath))
    return reply.send(createReadStream(targetPath))
  })

  app.get(`${apiPrefix}/tasks/:taskId/open-location`, async (request): Promise<{ task_id: string; path: string }> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const targetPath = await taskRepository.resolveOpenLocation(taskId)
    if (!targetPath) {
      throw AppError.badRequest("Task has no local path", {
        code: "TASK_LOCAL_PATH_MISSING",
      })
    }

    return {
      task_id: taskId,
      path: path.resolve(targetPath),
    }
  })

  app.get(`${apiPrefix}/tasks/:taskId`, async (request): Promise<TaskDetailResponse> => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const detail = await taskRepository.getDetail(taskId)
    if (!detail) {
      throw AppError.notFound("Task not found", {
        code: "TASK_NOT_FOUND",
      })
    }
    return detail
  })
}

function normalizeOptionalString(value: unknown): string | undefined {
  const candidate = String(value || "").trim()
  return candidate || undefined
}

function parseBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, parsed))
}

