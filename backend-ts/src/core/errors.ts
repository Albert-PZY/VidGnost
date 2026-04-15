export class AppError extends Error {
  readonly code: string
  readonly statusCode: number

  constructor(message: string, options?: { code?: string; statusCode?: number }) {
    super(message)
    this.name = "AppError"
    this.code = options?.code || "APP_ERROR"
    this.statusCode = options?.statusCode || 500
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Unknown error"
}
