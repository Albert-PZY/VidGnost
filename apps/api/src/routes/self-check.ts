import { PassThrough } from "node:stream"

import type { FastifyInstance } from "fastify"

import type {
  SelfCheckAutoFixResponse,
  SelfCheckReportResponse,
  SelfCheckStartResponse,
} from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import type { EventBus } from "../modules/events/event-bus.js"
import type { SelfCheckService } from "../modules/runtime/self-check-service.js"

interface SessionParams {
  sessionId?: string
}

export async function registerSelfCheckRoutes(
  app: FastifyInstance,
  apiPrefix: string,
  selfCheckService: SelfCheckService,
  eventBus: EventBus,
): Promise<void> {
  app.post(`${apiPrefix}/self-check/start`, async (): Promise<SelfCheckStartResponse> => {
    const sessionId = await selfCheckService.startCheck()
    return {
      session_id: sessionId,
      status: "running",
    }
  })

  app.get(`${apiPrefix}/self-check/:sessionId/report`, async (request): Promise<SelfCheckReportResponse> => {
    const sessionId = normalizeSessionId(request.params as SessionParams)
    const report = selfCheckService.getReport(sessionId)
    if (!report) {
      throw AppError.notFound(`Self-check session not found: ${sessionId}`, {
        code: "SELF_CHECK_SESSION_NOT_FOUND",
      })
    }
    return report
  })

  app.post(`${apiPrefix}/self-check/:sessionId/auto-fix`, async (request): Promise<SelfCheckAutoFixResponse> => {
    const sessionId = normalizeSessionId(request.params as SessionParams)
    const report = selfCheckService.getReport(sessionId)
    if (!report) {
      throw AppError.notFound(`Self-check session not found: ${sessionId}`, {
        code: "SELF_CHECK_SESSION_NOT_FOUND",
      })
    }
    if (report.status === "running" || report.status === "fixing") {
      throw AppError.conflict("Self-check is still running for this session.", {
        code: "SELF_CHECK_AUTO_FIX_CONFLICT",
      })
    }
    await selfCheckService.startAutoFix(sessionId)
    return {
      session_id: sessionId,
      status: "fixing",
    }
  })

  app.get(`${apiPrefix}/self-check/:sessionId/events`, async (request, reply) => {
    const sessionId = normalizeSessionId(request.params as SessionParams)
    const report = selfCheckService.getReport(sessionId)
    if (!report) {
      throw AppError.notFound(`Self-check session not found: ${sessionId}`, {
        code: "SELF_CHECK_SESSION_NOT_FOUND",
      })
    }

    const topic = `self-check:${sessionId}`
    const subscription = await eventBus.subscribe(topic)
    const stream = new PassThrough()

    let closed = false
    const close = () => {
      if (closed) {
        return
      }
      closed = true
      eventBus.unsubscribe(topic, subscription.queue)
      stream.end()
    }
    const writeEvent = (event: Record<string, unknown>) => {
      if (closed) {
        return
      }
      stream.write(`data: ${JSON.stringify(event)}\n\n`)
      if (isTerminalSelfCheckEvent(event)) {
        close()
      }
    }

    request.raw.on("close", close)
    reply.header("Cache-Control", "no-cache")
    reply.header("Connection", "keep-alive")
    reply.header("Content-Type", "text/event-stream; charset=utf-8")
    reply.header("X-Accel-Buffering", "no")
    const sentReply = reply.send(stream)

    subscription.history.forEach((event) => writeEvent(event))
    if (closed) {
      return sentReply
    }

    const keepalive = setInterval(() => {
      if (!closed) {
        stream.push(": keepalive\n\n")
      }
    }, 10_000)

    void (async () => {
      try {
        while (!closed) {
          const event = await subscription.queue.dequeue()
          if (closed || Object.keys(event).length === 0) {
            break
          }
          writeEvent(event)
        }
      } finally {
        clearInterval(keepalive)
        close()
      }
    })()
    return sentReply
  })
}

function normalizeSessionId(params: SessionParams): string {
  const sessionId = String(params.sessionId || "").trim()
  if (!sessionId) {
    throw AppError.badRequest("Self-check session id is required", {
      code: "SELF_CHECK_SESSION_ID_INVALID",
    })
  }
  return sessionId
}

function isTerminalSelfCheckEvent(event: Record<string, unknown>): boolean {
  const type = String(event.type || "").trim()
  return type === "self_check_complete" || type === "self_check_failed"
}
