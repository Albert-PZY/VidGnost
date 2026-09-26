import type { FastifyInstance } from "fastify"

import { createTaskRequestSchema } from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import type { AppContext } from "../server/app-context.js"

export async function registerTaskRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const base = `${context.config.apiPrefix}/tasks`

  app.get(base, async (request) => {
    const query = (request.query || {}) as { limit?: string; query?: string; status?: string }
    return context.tasks.list({
      limit: query.limit ? Number(query.limit) : undefined,
      query: query.query,
      status: query.status as never,
    })
  })

  app.post(base, async (request, reply) => {
    const parsed = createTaskRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw AppError.badRequest("任务参数不合法。", {
        code: "TASK_REQUEST_INVALID",
        detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      })
    }
    const task = await context.tasks.create(parsed.data)
    reply.code(201)
    return { task }
  })

  app.get(`${base}/:taskId`, async (request) => {
    const { taskId } = request.params as { taskId: string }
    return { task: await context.store.requireTask(taskId) }
  })

  app.get(`${base}/:taskId/events`, async (request) => {
    const { taskId } = request.params as { taskId: string }
    const task = await context.store.requireTask(taskId)
    return { taskId, events: await context.store.readEvents(taskId, 300), status: task.status }
  })

  app.get(`${base}/:taskId/artifacts/:key`, async (request) => {
    const { key, taskId } = request.params as { key: string; taskId: string }
    return context.store.readArtifact(taskId, key)
  })

  app.post(`${base}/:taskId/cancel`, async (request) => {
    const { taskId } = request.params as { taskId: string }
    return { task: await context.tasks.cancel(taskId) }
  })

  app.post(`${base}/:taskId/rerun`, async (request) => {
    const { taskId } = request.params as { taskId: string }
    const body = (request.body || {}) as { stages?: string[] }
    return { task: await context.tasks.rerun(taskId, body.stages) }
  })

  app.delete(`${base}/:taskId`, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    await context.tasks.remove(taskId)
    reply.code(204)
    return null
  })
}
