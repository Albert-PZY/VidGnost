import type { FastifyInstance } from "fastify"

import type { AppContext } from "../server/app-context.js"
import { runCommand, findCommand } from "../core/io.js"
import { catalogFor } from "../providers/gateway.js"
import { MODEL_CATALOG, MODEL_ROLES } from "../providers/catalog.js"
import { probeProviders } from "../providers/health.js"

export async function registerHealthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get(`${context.config.apiPrefix}/health`, async () => ({
    ok: true,
    app: context.config.appName,
    version: context.config.version,
    storageDir: context.config.storageDir,
    workspaceRoot: context.config.workspaceRoot,
    models: MODEL_CATALOG.length,
    roles: MODEL_ROLES.length,
  }))

  app.get(`${context.config.apiPrefix}/health/runtime`, async () => probeProviders(context.gateway, context.config))

  app.get(`${context.config.apiPrefix}/health/toolchain`, async () => {
    const checks = await Promise.all([
      probeBinary("ffmpeg", [context.config.ffmpegPath, "ffmpeg", "ffmpeg.exe"], ["-version"]),
      probeBinary("ffprobe", [context.config.ffprobePath, "ffprobe", "ffprobe.exe"], ["-version"]),
      probeBinary("yt-dlp", [context.config.ytdlpPath, "yt-dlp", "yt-dlp.exe"], ["--version"]),
      probeBinary("python", [context.config.whisperPython, "python", "python3"], ["--version"]),
    ])
    return { checkedAt: new Date().toISOString(), checks }
  })

  app.get(`${context.config.apiPrefix}/catalog`, async () => ({
    providers: {
      dashscope: catalogFor("dashscope"),
      openrouter: catalogFor("openrouter"),
      local: catalogFor("local"),
    },
    roles: MODEL_ROLES,
  }))
}

async function probeBinary(
  name: string,
  candidates: string[],
  args: string[],
): Promise<{ name: string; ok: boolean; detail: string; latencyMs: number }> {
  const started = Date.now()
  const resolved = await findCommand(candidates)
  if (!resolved) {
    return { name, ok: false, detail: "未在 PATH 中找到可执行文件", latencyMs: Date.now() - started }
  }
  try {
    const result = await runCommand({ command: resolved, args })
    const firstLine = `${result.stdout}${result.stderr}`.split(/\r?\n/).find((line) => line.trim()) || resolved
    return { name, ok: true, detail: firstLine.trim().slice(0, 160), latencyMs: Date.now() - started }
  } catch (error) {
    return {
      name,
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 200) : String(error),
      latencyMs: Date.now() - started,
    }
  }
}
