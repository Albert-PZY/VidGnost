import { PassThrough } from "node:stream"

import type { FastifyInstance, FastifyRequest } from "fastify"

import {
  vqaAnalyzeRequestSchema,
  vqaChatRequestSchema,
  vqaSearchRequestSchema,
  type VqaTraceResponse,
} from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import type { VqaRuntimeService } from "../modules/vqa/vqa-runtime-service.js"

interface TraceParams {
  traceId?: string
}

export async function registerVqaRoutes(
  app: FastifyInstance,
  apiPrefix: string,
  vqaRuntimeService: VqaRuntimeService,
): Promise<void> {
  app.post(`${apiPrefix}/search`, async (request) => {
    const body = parseBody(request, vqaSearchRequestSchema, "VQA_SEARCH_REQUEST_INVALID", "Invalid VQA search payload")
    const queryText = resolveQueryText(body.query_text, body.question)
    const bundle = await vqaRuntimeService.search({
      queryText,
      taskId: body.task_id,
      videoPaths: body.video_paths,
      topK: body.top_k,
    })
    return vqaRuntimeService.buildSearchPayload(bundle)
  })

  app.post(`${apiPrefix}/analyze`, async (request) => {
    const body = parseBody(request, vqaAnalyzeRequestSchema, "VQA_ANALYZE_REQUEST_INVALID", "Invalid VQA analyze payload")
    const queryText = resolveQueryText(body.query_text, body.question)
    const bundle = await vqaRuntimeService.analyze({
      queryText,
      taskId: body.task_id,
      videoPaths: body.video_paths,
      topK: body.top_k,
    })
    return vqaRuntimeService.buildAnalyzePayload(bundle)
  })

  app.post(`${apiPrefix}/chat`, async (request) => {
    const body = parseBody(request, vqaChatRequestSchema, "VQA_CHAT_REQUEST_INVALID", "Invalid VQA chat payload")
    const queryText = resolveQueryText(body.query_text, body.question)
    const bundle = await vqaRuntimeService.analyze({
      queryText,
      taskId: body.task_id,
      videoPaths: body.video_paths,
      topK: body.top_k,
    })
    return vqaRuntimeService.buildChatPayload(bundle)
  })

  app.post(`${apiPrefix}/chat/stream`, async (request, reply) => {
    const body = parseBody(request, vqaChatRequestSchema, "VQA_CHAT_REQUEST_INVALID", "Invalid VQA chat payload")
    const queryText = resolveQueryText(body.query_text, body.question)
    const stream = new PassThrough()

    reply.header("Cache-Control", "no-cache")
    reply.header("Connection", "keep-alive")
    reply.header("Content-Type", "text/event-stream; charset=utf-8")
    reply.header("X-Accel-Buffering", "no")
    const sentReply = reply.send(stream)

    void (async () => {
      try {
        for await (const event of vqaRuntimeService.streamChat({
          queryText,
          taskId: body.task_id,
          videoPaths: body.video_paths,
          topK: body.top_k,
        })) {
          stream.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch (error) {
        stream.write(`data: ${JSON.stringify({
          type: "error",
          error: {
            code: "VQA_STREAM_TRANSPORT_ERROR",
            message: error instanceof Error ? error.message : "流式连接意外中断，请稍后重试。",
          },
        })}\n\n`)
      } finally {
        stream.end()
      }
    })()
    return sentReply
  })

  app.get(`${apiPrefix}/traces/:traceId`, async (request): Promise<VqaTraceResponse> => {
    const traceId = normalizeTraceId(request.params as TraceParams)
    return vqaRuntimeService.readTrace(traceId)
  })
}

function parseBody<T>(
  request: FastifyRequest,
  schema: { parse: (value: unknown) => T },
  code: string,
  message: string,
): T {
  try {
    return schema.parse(request.body)
  } catch (error) {
    throw AppError.badRequest(message, {
      code,
      detail: error instanceof Error ? error.message : error,
    })
  }
}

function resolveQueryText(queryText: string | undefined, question: string | undefined): string {
  const resolved = String(queryText || question || "").trim()
  if (resolved) {
    return resolved
  }
  throw AppError.badRequest("query_text or question is required", {
    code: "VQA_QUERY_REQUIRED",
    hint: "请传入 query_text（兼容字段 question）。",
  })
}

function normalizeTraceId(params: TraceParams): string {
  const traceId = String(params.traceId || "").trim()
  if (!traceId) {
    throw AppError.badRequest("Trace id is required", {
      code: "VQA_TRACE_ID_INVALID",
    })
  }
  return traceId
}
