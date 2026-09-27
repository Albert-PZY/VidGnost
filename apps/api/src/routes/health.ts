import type { FastifyInstance } from "fastify"

import type { AppContext } from "../server/app-context.js"
import { runCommand, findCommand } from "../core/io.js"
import { MODEL_ROLES } from "../providers/catalog.js"
import { probeProviders } from "../providers/health.js"

export async function registerHealthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get(`${context.config.apiPrefix}/health`, async () => ({
    ok: true,
    app: context.config.appName,
    version: context.config.version,
    storageDir: context.config.storageDir,
    workspaceRoot: context.config.workspaceRoot,
    models: (await context.gateway.catalogue()).length,
    roles: MODEL_ROLES.length,
  }))

  app.get(`${context.config.apiPrefix}/health/runtime`, async () => probeProviders(context.gateway))

  app.get(`${context.config.apiPrefix}/health/toolchain`, async () => {
    const checks = await Promise.all([
      probeBinary("ffmpeg", [context.config.ffmpegPath, "ffmpeg", "ffmpeg.exe"], ["-version"]),
      probeBinary("ffprobe", [context.config.ffprobePath, "ffprobe", "ffprobe.exe"], ["-version"]),
      probeBinary("yt-dlp", [context.config.ytdlpPath, "yt-dlp", "yt-dlp.exe"], ["--version"]),
      probeBinary("python", [context.config.whisperPython, "python", "python3"], ["--version"]),
    ])
    return { checkedAt: new Date().toISOString(), checks }
  })

  /** 按渠道分组的目录快照，供外部脚本查看当前接入了哪些模型。 */
  app.get(`${context.config.apiPrefix}/catalog`, async () => {
    const [models, providers] = await Promise.all([
      context.gateway.catalogue(),
      context.gateway.settings.getProviders(),
    ])
    const grouped: Record<string, typeof models> = {}
    for (const provider of providers) {
      grouped[provider.id] = models.filter((model) => model.provider === provider.id)
    }
    return { providers: grouped, roles: MODEL_ROLES }
  })
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
