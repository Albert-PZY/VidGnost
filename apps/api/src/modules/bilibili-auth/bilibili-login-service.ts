import { createRequire } from "node:module"

import type {
  BilibiliAccount,
  BilibiliAuthQrPollResponse,
  BilibiliAuthQrStartResponse,
  BilibiliAuthStatusResponse,
} from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import { BilibiliAuthRepository } from "./bilibili-auth-repository.js"
import {
  buildBilibiliCookieHeader,
  buildBilibiliRequestHeaders,
  collectSetCookieHeaders,
  extractWhitelistedCookies,
} from "./bilibili-source.js"

interface BilibiliLoginServiceDependencies {
  fetch?: typeof fetch
}

const QR_POLL_INTERVAL_MS = 1500
const QR_EXPIRE_MS = 180_000
const require = createRequire(import.meta.url)
const { toDataURL } = require("qrcode") as {
  toDataURL: (text: string, options?: Record<string, unknown>) => Promise<string>
}

export class BilibiliLoginService {
  private readonly fetchImpl?: typeof fetch

  constructor(
    private readonly repository: BilibiliAuthRepository,
    dependencies: BilibiliLoginServiceDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetch
  }

  async getStatus(): Promise<BilibiliAuthStatusResponse> {
    return toStatusResponse(await this.repository.get())
  }

  async startQrLogin(signal?: AbortSignal): Promise<BilibiliAuthQrStartResponse> {
    const response = await this.fetchJson<{
      code?: number
      data?: {
        qrcode_key?: string
        url?: string
      }
      message?: string
    }>("https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header", {
      method: "GET",
      signal,
    })
    const qrcodeKey = String(response.data?.qrcode_key || "").trim()
    const qrcodeUrl = String(response.data?.url || "").trim()
    if (!qrcodeKey || !qrcodeUrl) {
      throw AppError.conflict("Failed to generate Bilibili QR login session", {
        code: "BILIBILI_QR_GENERATE_FAILED",
      })
    }

    const qrImageDataUrl = await toDataURL(qrcodeUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    })
    const expiresAt = new Date(Date.now() + QR_EXPIRE_MS).toISOString()
    await this.repository.savePendingLogin({
      expires_at: expiresAt,
      poll_interval_ms: QR_POLL_INTERVAL_MS,
      qr_image_data_url: qrImageDataUrl,
      qrcode_key: qrcodeKey,
      qrcode_url: qrcodeUrl,
    })

    return {
      status: "pending",
      qrcode_key: qrcodeKey,
      qrcode_url: qrcodeUrl,
      qr_image_data_url: qrImageDataUrl,
      expires_at: expiresAt,
      poll_interval_ms: QR_POLL_INTERVAL_MS,
    }
  }

  async pollQrLogin(
    input: {
      qrcode_key: string
      signal?: AbortSignal
    },
  ): Promise<BilibiliAuthQrPollResponse> {
    const qrcodeKey = String(input.qrcode_key || "").trim()
    if (!qrcodeKey) {
      throw AppError.badRequest("Bilibili qrcode_key is required", {
        code: "BILIBILI_QR_KEY_INVALID",
      })
    }

    const response = await this.fetchResponse(
      `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}&source=main-fe-header`,
      {
        method: "GET",
        signal: input.signal,
      },
    )
    const payload = await parseJsonPayload<{
      code?: number
      data?: {
        code?: number
        message?: string
        url?: string
      }
      message?: string
    }>(response)
    const pollCode = Number(payload.data?.code ?? payload.code ?? -1)
    const message = String(payload.data?.message || payload.message || "").trim() || "unknown"

    if (pollCode === 0) {
      const cookies = extractWhitelistedCookies(collectSetCookieHeaders(response))
      if (Object.keys(cookies).length === 0) {
        throw AppError.conflict("Bilibili QR login succeeded without session cookies", {
          code: "BILIBILI_QR_COOKIES_MISSING",
        })
      }

      const account = await this.fetchAccountSummary(cookies, input.signal)
      await this.repository.saveActiveSession({
        account,
        cookies,
        last_validated_at: new Date().toISOString(),
      })

      return {
        status: "success",
        account,
        expires_at: null,
        last_error: null,
        message: message === "0" ? "登录成功" : message,
      }
    }

    if (pollCode === 86038) {
      const expiredMessage = message || "二维码已失效"
      await this.repository.markExpired(expiredMessage)
      return {
        status: "expired",
        account: null,
        expires_at: new Date().toISOString(),
        last_error: expiredMessage,
        message: expiredMessage,
      }
    }

    return {
      status: mapQrPollStatus(pollCode),
      account: null,
      expires_at: (await this.repository.get()).pending_login?.expires_at ?? null,
      last_error: null,
      message,
    }
  }

  async logout(): Promise<void> {
    await this.repository.clearSession()
  }

  private async fetchAccountSummary(
    cookies: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<BilibiliAccount | null> {
    const response = await this.fetchJson<{
      code?: number
      data?: {
        mid?: number | string
        uname?: string
      }
    }>("https://api.bilibili.com/x/web-interface/nav", {
      headers: buildBilibiliRequestHeaders(buildBilibiliCookieHeader(cookies)),
      method: "GET",
      signal,
    })
    const mid = String(response.data?.mid || "").trim()
    const uname = String(response.data?.uname || "").trim()
    return mid && uname ? { mid, uname } : null
  }

  private async fetchJson<T>(input: string, init: RequestInit): Promise<T> {
    const response = await this.fetchResponse(input, init)
    return parseJsonPayload<T>(response)
  }

  private async fetchResponse(input: string, init: RequestInit): Promise<Response> {
    const response = await (this.fetchImpl ? this.fetchImpl(input, init) : fetch(input, init))
    if (!response.ok) {
      throw AppError.conflict(`Bilibili request failed: ${response.status}`, {
        code: "BILIBILI_REQUEST_FAILED",
      })
    }
    return response
  }
}

function mapQrPollStatus(code: number): BilibiliAuthQrPollResponse["status"] {
  if (code === 86101) {
    return "pending"
  }
  if (code === 86090) {
    return "scanned"
  }
  if (code === 86100) {
    return "confirmed"
  }
  return "failed"
}

function toStatusResponse(snapshot: Awaited<ReturnType<BilibiliAuthRepository["get"]>>): BilibiliAuthStatusResponse {
  return {
    status: snapshot.status,
    account: snapshot.account,
    expires_at: snapshot.status === "pending" ? snapshot.pending_login?.expires_at ?? snapshot.expires_at : snapshot.expires_at,
    last_validated_at: snapshot.last_validated_at,
    last_error: snapshot.last_error,
    qrcode_key: snapshot.status === "pending" ? snapshot.pending_login?.qrcode_key ?? null : null,
    qrcode_url: snapshot.status === "pending" ? snapshot.pending_login?.qrcode_url ?? null : null,
    qr_image_data_url: snapshot.status === "pending" ? snapshot.pending_login?.qr_image_data_url ?? null : null,
    poll_interval_ms: snapshot.status === "pending" ? snapshot.pending_login?.poll_interval_ms ?? null : null,
  }
}

async function parseJsonPayload<T>(response: Response): Promise<T> {
  const text = await response.text()
  return JSON.parse(text) as T
}
