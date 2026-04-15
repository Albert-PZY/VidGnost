import type { FastifyServerOptions } from "fastify"

export function createLoggerOptions(): FastifyServerOptions["logger"] {
  const level = process.env.LOG_LEVEL?.trim() || "info"
  return {
    level,
  }
}
