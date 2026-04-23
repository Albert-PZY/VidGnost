import os from "node:os"
import path from "node:path"
import { mkdtemp, readFile, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { BilibiliAuthRepository } from "../src/modules/bilibili-auth/bilibili-auth-repository.js"

describe("BilibiliAuthRepository", () => {
  let config: AppConfig
  let repository: BilibiliAuthRepository
  let storageDir = ""

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-bilibili-auth-"))
    config = createTestConfig(storageDir)
    repository = new BilibiliAuthRepository(config)
  })

  afterEach(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
      storageDir = ""
    }
  })

  it("returns a missing status snapshot when no persisted file exists", async () => {
    await expect(repository.get()).resolves.toMatchObject({
      account: null,
      cookies: {},
      last_error: null,
      pending_login: null,
      status: "missing",
    })
  })

  it("persists pending qr metadata and later stores an active whitelisted cookie session", async () => {
    await repository.savePendingLogin({
      expires_at: "2026-04-23T10:05:00.000Z",
      poll_interval_ms: 1500,
      qr_image_data_url: "data:image/png;base64,abc",
      qrcode_key: "qr-key-1",
      qrcode_url: "https://passport.bilibili.com/h5-app/passport/login/scan",
    })

    await expect(repository.get()).resolves.toMatchObject({
      pending_login: {
        qrcode_key: "qr-key-1",
        qrcode_url: "https://passport.bilibili.com/h5-app/passport/login/scan",
      },
      status: "pending",
    })

    await repository.saveActiveSession({
      account: {
        mid: "123456",
        uname: "测试用户",
      },
      cookies: {
        DedeUserID: "123456",
        DedeUserID__ckMd5: "ck-md5",
        SESSDATA: "sess-token",
        bili_jct: "csrf-token",
        sid: "sid-token",
        useless_cookie: "should-be-dropped",
      },
      last_validated_at: "2026-04-23T10:00:00.000Z",
    })

    const stored = await repository.get()
    expect(stored).toMatchObject({
      account: {
        mid: "123456",
        uname: "测试用户",
      },
      cookies: {
        DedeUserID: "123456",
        DedeUserID__ckMd5: "ck-md5",
        SESSDATA: "sess-token",
        bili_jct: "csrf-token",
        sid: "sid-token",
      },
      last_validated_at: "2026-04-23T10:00:00.000Z",
      pending_login: null,
      status: "active",
    })

    const persisted = JSON.parse(
      await readFile(path.join(storageDir, "config", "bilibili-auth.json"), "utf8"),
    ) as {
      cookies?: Record<string, string>
      status?: string
    }
    expect(persisted.status).toBe("active")
    expect(persisted.cookies).not.toHaveProperty("useless_cookie")
  })

  it("marks the stored session expired and deletes the persisted file on logout", async () => {
    await repository.saveActiveSession({
      account: {
        mid: "123456",
        uname: "测试用户",
      },
      cookies: {
        SESSDATA: "sess-token",
      },
      last_validated_at: "2026-04-23T10:00:00.000Z",
    })

    await repository.markExpired("SESSDATA 已失效")

    await expect(repository.get()).resolves.toMatchObject({
      account: {
        mid: "123456",
        uname: "测试用户",
      },
      cookies: {},
      last_error: "SESSDATA 已失效",
      status: "expired",
    })

    await repository.clearSession()

    await expect(repository.get()).resolves.toMatchObject({
      account: null,
      cookies: {},
      pending_login: null,
      status: "missing",
    })
  })
})

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
