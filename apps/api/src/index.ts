import { createAppContext } from "./server/app-context.js"
import { buildApp } from "./server/build-app.js"
import { ensureDirectory } from "./core/fs.js"
import { logger } from "./core/logger.js"

async function main(): Promise<void> {
  const context = createAppContext()
  await ensureDirectory(context.config.storageDir)
  await ensureDirectory(context.config.tmpDir)
  await ensureDirectory(context.config.uploadDir)

  const app = await buildApp(context)
  await app.listen({ host: context.config.host, port: context.config.port })

  const recovered = await context.tasks.recoverInterrupted()

  const dashscopeReady = Boolean(context.config.dashscopeApiKey)
  const openrouterReady = Boolean(context.config.openrouterApiKey)
  logger.info(
    {
      url: `http://${context.config.host}:${context.config.port}${context.config.apiPrefix}`,
      storage: context.config.storageDir,
      recoveredTasks: recovered,
      dashscope: dashscopeReady ? "已配置" : "缺少 DASHSCOPE_API_KEY",
      openrouter: openrouterReady ? "已配置" : "缺少 OPENROUTER_API_KEY",
    },
    "VidGnost API 已就绪",
  )
}

main().catch((error) => {
  logger.error({ error: error instanceof Error ? error.message : String(error) }, "启动失败")
  process.exitCode = 1
})
