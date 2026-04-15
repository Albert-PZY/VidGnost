import type { FastifyInstance } from "fastify"

import type { ApiErrorPayload } from "@vidgnost/contracts"

export class AppError extends Error {
  readonly code: string
  readonly detail: unknown
  readonly hint: string
  readonly retryable: boolean
  readonly statusCode: number

  constructor(
    message: string,
    options?: {
      code?: string
      detail?: unknown
      hint?: string
      retryable?: boolean
      statusCode?: number
    },
  ) {
    super(message)
    this.name = "AppError"
    this.code = options?.code || "APP_ERROR"
    this.detail = options?.detail
    this.hint = options?.hint || ""
    this.retryable = Boolean(options?.retryable)
    this.statusCode = options?.statusCode || 500
  }

  static badRequest(
    message: string,
    options?: { code?: string; detail?: unknown; hint?: string; retryable?: boolean },
  ): AppError {
    return new AppError(message, {
      ...options,
      statusCode: 400,
    })
  }

  static conflict(
    message: string,
    options?: { code?: string; detail?: unknown; hint?: string; retryable?: boolean },
  ): AppError {
    return new AppError(message, {
      ...options,
      statusCode: 409,
    })
  }

  static notFound(
    message: string,
    options?: { code?: string; detail?: unknown; hint?: string; retryable?: boolean },
  ): AppError {
    return new AppError(message, {
      ...options,
      statusCode: 404,
    })
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Unknown error"
}

export function toApiErrorPayload(error: AppError): ApiErrorPayload {
  return {
    code: error.code,
    message: error.message,
    hint: error.hint,
    retryable: error.retryable,
    detail: error.detail,
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ error }, "Handled application error")
      reply.status(error.statusCode).send(toApiErrorPayload(error))
      return
    }

    request.log.error({ error }, "Unhandled application error")
    reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      hint: "",
      retryable: false,
      detail: undefined,
    } satisfies ApiErrorPayload)
  })
}
