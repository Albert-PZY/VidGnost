import Fastify, { type FastifyInstance } from "fastify"
import cors from "@fastify/cors"

import { AppError, toErrorShape } from "../core/errors.js"
import { logger } from "../core/logger.js"
import type { AppContext } from "./app-context.js"
import { registerAskRoutes } from "../routes/ask.js"
import { registerConfigRoutes } from "../routes/config.js"
import { registerEventRoutes } from "../routes/events.js"
import { registerExportRoutes } from "../routes/export.js"
import { registerHealthRoutes } from "../routes/health.js"
import { registerMediaRoutes } from "../routes/media.js"
import { registerTaskRoutes } from "../routes/tasks.js"

export async function buildApp(context: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    // 使用项目自带的 pino logger 输出业务日志，Fastify 自身的请求日志关闭以避免重复。
    logger: false,
    bodyLimit: 8 * 1024 * 1024,
    disableRequestLogging: true,
  })

  await app.register(cors, {
    origin: context.config.allowOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.status).send({ error: error.toShape() })
      return
    }
    const fastifyError = error as { statusCode?: number; message?: string; validation?: unknown }
    const status = fastifyError.statusCode && fastifyError.statusCode >= 400 ? fastifyError.statusCode : 500
    if (status >= 500) {
      logger.error({ url: request.url, error: fastifyError.message }, "request failed")
    }
    reply.code(status).send({ error: toErrorShape(error) })
  })

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: "ROUTE_NOT_FOUND", message: `没有匹配的接口：${request.method} ${request.url}` },
    })
  })

  await registerHealthRoutes(app, context)
  await registerTaskRoutes(app, context)
  await registerMediaRoutes(app, context)
  await registerEventRoutes(app, context)
  await registerAskRoutes(app, context)
  await registerConfigRoutes(app, context)
  await registerExportRoutes(app, context)

  return app
}
