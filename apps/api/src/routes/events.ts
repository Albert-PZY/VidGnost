import type { FastifyInstance } from "fastify"

import type { TaskEvent } from "@vidgnost/contracts"

import type { AppContext } from "../server/app-context.js"
import { applySseCors } from "../server/sse-cors.js"

/** SSE 事件流：任务创建后立即连接即可收到 snapshot + 后续阶段事件。 */
export async function registerEventRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get(`${context.config.apiPrefix}/tasks/:taskId/stream`, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const task = await context.store.requireTask(taskId)

    applySseCors(request, reply, context.config.allowOrigins)
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })

    const send = (event: TaskEvent) => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      } catch {
        // 客户端可能已断开
      }
    }

    send({ type: "snapshot", task })
    for (const event of await context.store.readEvents(taskId, 60)) {
      send(event)
    }
    send({ type: "status", taskId, status: task.status, error: task.error })

    const unsubscribe = context.bus.subscribe(taskId, send)
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`)
      } catch {
        // 忽略
      }
    }, 15_000)

    request.raw.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
      reply.raw.end()
    })

    return reply
  })

  /** 全局事件流：资产库页面用它做「有任务完成」的实时刷新。 */
  app.get(`${context.config.apiPrefix}/stream`, async (request, reply) => {
    applySseCors(request, reply, context.config.allowOrigins)
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    })

    const unsubscribe = context.bus.subscribeAll((event) => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      } catch {
        // 忽略
      }
    })
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`)
      } catch {
        // 忽略
      }
    }, 15_000)

    request.raw.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
      reply.raw.end()
    })
    return reply
  })
}
