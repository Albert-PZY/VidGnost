import { buildApp } from "./server/build-app.js"
import { resolveConfig } from "./core/config.js"
import { toErrorMessage } from "./core/errors.js"

async function main(): Promise<void> {
  const config = resolveConfig()
  const app = await buildApp(config)

  try {
    await app.listen({
      host: config.host,
      port: config.port,
    })
  } catch (error) {
    app.log.error({ error }, "Failed to start backend-ts server")
    throw error
  }
}

main().catch((error) => {
  console.error(`[backend-ts] ${toErrorMessage(error)}`)
  process.exitCode = 1
})
