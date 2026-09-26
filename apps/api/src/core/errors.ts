import type { ErrorShape, JsonValue } from "@vidgnost/contracts"

export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: JsonValue
  readonly hint?: string

  constructor(input: { message: string; code: string; status: number; detail?: JsonValue; hint?: string }) {
    super(input.message)
    this.name = "AppError"
    this.code = input.code
    this.status = input.status
    this.detail = input.detail
    this.hint = input.hint
  }

  static badRequest(message: string, extra: { code?: string; detail?: JsonValue; hint?: string } = {}): AppError {
    return new AppError({ message, code: extra.code || "BAD_REQUEST", status: 400, detail: extra.detail, hint: extra.hint })
  }

  static notFound(message: string, extra: { code?: string; detail?: JsonValue } = {}): AppError {
    return new AppError({ message, code: extra.code || "NOT_FOUND", status: 404, detail: extra.detail })
  }

  static conflict(message: string, extra: { code?: string; detail?: JsonValue; hint?: string } = {}): AppError {
    return new AppError({ message, code: extra.code || "CONFLICT", status: 409, detail: extra.detail, hint: extra.hint })
  }

  static unavailable(message: string, extra: { code?: string; detail?: JsonValue; hint?: string } = {}): AppError {
    return new AppError({
      message,
      code: extra.code || "SERVICE_UNAVAILABLE",
      status: 503,
      detail: extra.detail,
      hint: extra.hint,
    })
  }

  toShape(): ErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(this.hint ? { hint: this.hint } : {}),
    }
  }
}

export function toErrorShape(error: unknown): ErrorShape {
  if (error instanceof AppError) {
    return error.toShape()
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: error.message, detail: error.name }
  }
  return { code: "INTERNAL_ERROR", message: String(error) }
}

export function describeError(error: unknown): string {
  if (error instanceof AppError) {
    return `${error.code}: ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}
