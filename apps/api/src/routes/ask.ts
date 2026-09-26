import type { FastifyInstance } from "fastify"

import type { AskStreamEvent, OutlineDoc, ParagraphDoc, SummaryDoc } from "@vidgnost/contracts"
import { askRequestSchema } from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import { applySseCors } from "../server/sse-cors.js"
import type { AppContext } from "../server/app-context.js"

export async function registerAskRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post(`${context.config.apiPrefix}/tasks/:taskId/ask`, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const parsed = askRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      throw AppError.badRequest("提问参数不合法。", {
        code: "ASK_REQUEST_INVALID",
        detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      })
    }

    const task = await context.store.requireTask(taskId)
    const [outline, paragraphDoc, summary, snapshot] = await Promise.all([
      context.store.artifactJson<OutlineDoc>(taskId, "outline"),
      context.store.artifactJson<ParagraphDoc>(taskId, "paragraphs"),
      context.store.artifactJson<SummaryDoc>(taskId, "summary"),
      context.index.load(context.store.taskDir(taskId)),
    ])

    if (!outline && !paragraphDoc) {
      throw AppError.conflict("任务尚未生成可检索的产物，请先完成处理。", { code: "TASK_NOT_INDEXED" })
    }

    const chapterNotes = await context.runner.readChapterNotes(taskId)

    applySseCors(request, reply, context.config.allowOrigins)
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })

    const send = (event: AskStreamEvent) => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      } catch {
        // 客户端可能已断开
      }
    }

    try {
      for await (const event of context.qa.ask({
        question: parsed.data.question,
        history: parsed.data.history,
        topK: parsed.data.topK,
        title: task.title,
        chapters: outline?.chapters || [],
        chapterNotes,
        summary,
        snapshot,
        videoDuration: task.source.durationSeconds,
        signal: AbortSignal.timeout(180_000),
      })) {
        send(event)
      }
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) })
    } finally {
      reply.raw.write("event: close\ndata: {}\n\n")
      reply.raw.end()
    }

    return reply
  })
}
