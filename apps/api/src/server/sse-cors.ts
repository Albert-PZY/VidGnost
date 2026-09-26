import type { FastifyRequest } from "fastify"

/**
 * SSE 路由直接调用 `reply.raw.writeHead`，会绕过 Fastify 的响应头管线，
 * 因此 CORS 头必须显式补齐，否则浏览器端的 EventSource 会被同源策略拦截。
 * 必须在 `writeHead` 之前调用。
 */
export function applySseCors(
  request: FastifyRequest,
  reply: { raw: { setHeader: (name: string, value: string) => void } },
  allowOrigins: string[],
): void {
  const origin = String(request.headers.origin || "").trim()
  if (!origin) {
    return
  }
  if (!allowOrigins.includes(origin) && !allowOrigins.includes("*")) {
    return
  }
  reply.raw.setHeader("Access-Control-Allow-Origin", origin)
  reply.raw.setHeader("Vary", "Origin")
}
