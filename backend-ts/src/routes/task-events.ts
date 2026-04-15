import type { FastifyInstance } from "fastify"

import { EventBus } from "../modules/events/event-bus.js"
import { TaskRepository } from "../modules/tasks/task-repository.js"
import { normalizeTaskId, normalizeWorkflow, type TaskIdParams } from "./task-route-support.js"

export async function registerTaskEventRoutes(
  app: FastifyInstance,
  apiPrefix: string,
  taskRepository: TaskRepository,
  eventBus: EventBus,
): Promise<void> {
  app.get(`${apiPrefix}/tasks/:taskId/events`, async (request, reply) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const record = await taskRepository.getStoredRecord(taskId)
    const workflow = record ? normalizeWorkflow(record.workflow) : "notes"
    const subscription = await eventBus.subscribe(taskId)

    reply.hijack()
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    })

    let closed = false
    const close = () => {
      if (closed) {
        return
      }
      closed = true
      eventBus.unsubscribe(taskId, subscription.queue)
      try {
        reply.raw.end()
      } catch {
        return
      }
    }

    request.raw.on("close", close)
    reply.raw.on("close", close)

    for (const item of subscription.history) {
      if (closed) {
        return
      }
      reply.raw.write(`data: ${JSON.stringify(normalizeStreamEvent(taskId, workflow, item))}\n\n`)
    }

    const keepalive = setInterval(() => {
      if (!closed) {
        reply.raw.write(": keepalive\n\n")
      }
    }, 10_000)

    try {
      while (!closed) {
        const event = await subscription.queue.dequeue()
        if (closed || Object.keys(event).length === 0) {
          break
        }
        reply.raw.write(`data: ${JSON.stringify(normalizeStreamEvent(taskId, workflow, event))}\n\n`)
      }
    } finally {
      clearInterval(keepalive)
      close()
    }
  })
}

function normalizeStreamEvent(taskId: string, workflow: "notes" | "vqa", event: Record<string, unknown>) {
  const normalized = { ...event }
  const rawType = String(event.type || "").trim()
  let mapped = rawType

  if (["progress", "stage_start", "stage_complete", "substage_start", "substage_complete", "log"].includes(rawType)) {
    mapped = "step_updated"
  } else if (rawType === "transcript_delta") {
    mapped = "transcript_chunk"
  } else if (["summary_delta", "mindmap_delta", "transcript_optimized_preview", "fusion_prompt_preview"].includes(rawType)) {
    mapped = "artifact_ready"
  } else if (rawType === "task_complete") {
    mapped = "task_completed"
  } else if (rawType === "task_cancelled") {
    mapped = "task_failed"
  }

  normalized.type = mapped
  normalized.task_id = taskId
  normalized.workflow = workflow
  normalized.timestamp = String(event.timestamp || event.ts || new Date().toISOString())
  if (rawType && rawType !== mapped) {
    normalized.original_type = rawType
  }
  return normalized
}
