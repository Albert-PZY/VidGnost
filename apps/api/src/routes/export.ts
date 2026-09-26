import type { FastifyInstance } from "fastify"

import type { OutlineDoc, TranscriptDoc } from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import type { AppContext } from "../server/app-context.js"

const FORMATS = ["md", "json", "srt", "mmd", "txt"] as const
type ExportFormat = (typeof FORMATS)[number]

export async function registerExportRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get(`${context.config.apiPrefix}/tasks/:taskId/export`, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const query = (request.query || {}) as { format?: string }
    const format = (query.format || "md") as ExportFormat
    if (!FORMATS.includes(format)) {
      throw AppError.badRequest(`不支持的导出格式：${format}`, { code: "EXPORT_FORMAT_UNSUPPORTED" })
    }

    const task = await context.store.requireTask(taskId)
    const safeName = task.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || task.id

    if (format === "json") {
      const payload = await context.store.readArtifact(taskId, "pack")
      reply.header("Content-Type", "application/json; charset=utf-8")
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}.json"`)
      return payload.json ?? {}
    }

    if (format === "mmd") {
      const mindmap = await context.store.readArtifactText(taskId, "mindmap.mmd")
      reply.header("Content-Type", "text/plain; charset=utf-8")
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}.mindmap.mmd"`)
      return mindmap || "mindmap\n"
    }

    if (format === "srt") {
      const srt = await context.store.readArtifactText(taskId, "transcript.srt")
      reply.header("Content-Type", "application/x-subrip; charset=utf-8")
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}.srt"`)
      return srt
    }

    if (format === "txt") {
      const transcript = await context.store.artifactJson<TranscriptDoc>(taskId, "transcript")
      const outline = await context.store.artifactJson<OutlineDoc>(taskId, "outline")
      const lines: string[] = [`${task.title}`, ""]
      for (const chapter of outline?.chapters || []) {
        lines.push(`【${chapter.title}】`)
      }
      lines.push("", transcript?.text || "")
      reply.header("Content-Type", "text/plain; charset=utf-8")
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}.txt"`)
      return lines.join("\n")
    }

    const report = await context.store.readArtifactText(taskId, "report")
    reply.header("Content-Type", "text/markdown; charset=utf-8")
    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}.md"`)
    return report || `# ${task.title}\n\n导出内容尚未生成。\n`
  })
}
