import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { BilibiliAuthRepository } from "../src/modules/bilibili-auth/bilibili-auth-repository.js"
import { BilibiliLoginService } from "../src/modules/bilibili-auth/bilibili-login-service.js"

describe("BilibiliLoginService", () => {
  let config: AppConfig
  let repository: BilibiliAuthRepository
  let service: BilibiliLoginService
  let storageDir = ""

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-bilibili-login-"))
    config = createTestConfig(storageDir)
    repository = new BilibiliAuthRepository(config)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
      storageDir = ""
    }
  })

  it("starts a qr login session and persists the pending metadata", async () => {
    service = new BilibiliLoginService(repository, {
      fetch: vi.fn(async () => buildJsonResponse({
        code: 0,
        data: {
          qrcode_key: "qr-key-1",
          url: "https://passport.bilibili.com/h5-app/passport/login/scan",
        },
      })),
    })

    const response = await service.startQrLogin()

    expect(response).toMatchObject({
      poll_interval_ms: 1500,
      qrcode_key: "qr-key-1",
      qrcode_url: "https://passport.bilibili.com/h5-app/passport/login/scan",
      status: "pending",
    })
    await expect(repository.get()).resolves.toMatchObject({
      pending_login: {
        qrcode_key: "qr-key-1",
      },
      status: "pending",
    })
  })

  it("polls a successful qr login, extracts whitelisted cookies, and stores the active account snapshot", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildJsonResponse({
        code: 0,
        data: {
          code: 0,
          message: "success",
          url: "https://www.bilibili.com",
        },
      }, {
        setCookies: [
          "SESSDATA=sess-token; Path=/; HttpOnly",
          "bili_jct=csrf-token; Path=/",
          "DedeUserID=123456; Path=/",
          "DedeUserID__ckMd5=ck-md5; Path=/",
          "sid=sid-token; Path=/",
          "ignore_me=1; Path=/",
        ],
      }))
      .mockResolvedValueOnce(buildJsonResponse({
        code: 0,
        data: {
          mid: 123456,
          uname: "扫码用户",
        },
      }))
    service = new BilibiliLoginService(repository, {
      fetch: fetchMock,
    })

    const response = await service.pollQrLogin({
      qrcode_key: "qr-key-1",
    })

    expect(response).toMatchObject({
      account: {
        mid: "123456",
        uname: "扫码用户",
      },
      status: "success",
    })
    await expect(repository.get()).resolves.toMatchObject({
      account: {
        mid: "123456",
        uname: "扫码用户",
      },
      cookies: {
        DedeUserID: "123456",
        DedeUserID__ckMd5: "ck-md5",
        SESSDATA: "sess-token",
        bili_jct: "csrf-token",
        sid: "sid-token",
      },
      status: "active",
    })
  })

  it("marks the login status expired when the qr code has expired", async () => {
    service = new BilibiliLoginService(repository, {
      fetch: vi.fn(async () => buildJsonResponse({
        code: 0,
        data: {
          code: 86038,
          message: "二维码已失效",
        },
      })),
    })

    const response = await service.pollQrLogin({
      qrcode_key: "qr-key-expired",
    })

    expect(response).toMatchObject({
      message: "二维码已失效",
      status: "expired",
    })
    await expect(repository.get()).resolves.toMatchObject({
      last_error: "二维码已失效",
      status: "expired",
    })
  })
})

function buildJsonResponse(
  payload: unknown,
  options: {
    ok?: boolean
    setCookies?: string[]
    status?: number
  } = {},
) {
  const headers = new Headers({ "content-type": "application/json" })
  const responseHeaders = headers as Headers & { getSetCookie?: () => string[] }
  responseHeaders.getSetCookie = () => options.setCookies ?? []
  return {
    headers: responseHeaders,
    json: async () => payload,
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: async () => JSON.stringify(payload),
  } satisfies Partial<Response> as Response
}

function createTestConfig(storageDir: string): AppConfig {
  const base = resolveConfig()
  return {
    ...base,
    eventLogDir: path.join(storageDir, "event-logs"),
    runtimeBinDir: path.join(storageDir, "runtime-bin"),
    storageDir,
    tempDir: path.join(storageDir, "tmp"),
    uploadDir: path.join(storageDir, "uploads"),
  }
}
