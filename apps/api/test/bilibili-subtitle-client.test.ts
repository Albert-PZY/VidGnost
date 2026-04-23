import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { BilibiliAuthRepository } from "../src/modules/bilibili-auth/bilibili-auth-repository.js"
import { BilibiliSubtitleClient } from "../src/modules/bilibili-auth/bilibili-subtitle-client.js"

describe("BilibiliSubtitleClient", () => {
  let config: AppConfig
  let repository: BilibiliAuthRepository
  let storageDir = ""

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-bilibili-subtitle-"))
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

  it("resolves bilibili ai subtitles through view -> player -> subtitle json", async () => {
    await repository.saveActiveSession({
      account: {
        mid: "123456",
        uname: "字幕用户",
      },
      cookies: {
        SESSDATA: "sess-token",
        bili_jct: "csrf-token",
      },
      last_validated_at: "2026-04-23T10:00:00.000Z",
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildJsonResponse({
        code: 0,
        data: {
          aid: 98765,
          cid: 54321,
        },
      }))
      .mockResolvedValueOnce(buildJsonResponse({
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              {
                lan: "zh-CN",
                lan_doc: "中文 AI 字幕",
                subtitle_url: "//i0.hdslb.com/bfs/subtitle/test.json",
              },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(buildJsonResponse({
        body: [
          {
            content: "第一句",
            from: 0,
            to: 1.2,
          },
          {
            content: "第二句",
            from: 1.2,
            to: 2.4,
          },
        ],
      }))

    const client = new BilibiliSubtitleClient(repository, {
      fetch: fetchMock,
    })

    const result = await client.fetchBestSubtitle({
      preferredLanguage: "zh",
      sourceInput: "https://www.bilibili.com/video/BV1darmBcE4A",
    })

    expect(result).toMatchObject({
      language: "zh-cn",
      raw_subtitle_json: expect.stringContaining("\"第一句\""),
      source: "bilibili-auth",
      subtitle_url: "https://i0.hdslb.com/bfs/subtitle/test.json",
      text: "第一句\n第二句",
      track: {
        label: "中文 AI 字幕",
        language: "zh-cn",
      },
    })
    expect(result?.segments).toEqual([
      { start: 0, end: 1.2, text: "第一句" },
      { start: 1.2, end: 2.4, text: "第二句" },
    ])

    const [, playerInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(new Headers(playerInit?.headers).get("cookie")).toContain("SESSDATA=sess-token")
  })

  it("marks the stored session expired when the player api reports an unauthorized state", async () => {
    await repository.saveActiveSession({
      account: {
        mid: "123456",
        uname: "字幕用户",
      },
      cookies: {
        SESSDATA: "expired-token",
      },
      last_validated_at: "2026-04-23T10:00:00.000Z",
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildJsonResponse({
        code: 0,
        data: {
          aid: 98765,
          cid: 54321,
        },
      }))
      .mockResolvedValueOnce(buildJsonResponse({
        code: -101,
        message: "账号未登录",
      }))

    const client = new BilibiliSubtitleClient(repository, {
      fetch: fetchMock,
    })

    await expect(client.fetchBestSubtitle({
      preferredLanguage: "zh",
      sourceInput: "https://www.bilibili.com/video/BV1darmBcE4A",
    })).resolves.toBeNull()

    await expect(repository.get()).resolves.toMatchObject({
      last_error: "账号未登录",
      status: "expired",
    })
  })

  it("marks the stored session expired when the player api returns a non-json 403 response", async () => {
    await repository.saveActiveSession({
      account: {
        mid: "123456",
        uname: "字幕用户",
      },
      cookies: {
        SESSDATA: "expired-token",
      },
      last_validated_at: "2026-04-23T10:00:00.000Z",
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(buildJsonResponse({
        code: 0,
        data: {
          aid: 98765,
          cid: 54321,
        },
      }))
      .mockResolvedValueOnce(buildTextResponse(403, "<html>forbidden</html>", "text/html"))

    const client = new BilibiliSubtitleClient(repository, {
      fetch: fetchMock,
    })

    await expect(client.fetchBestSubtitle({
      preferredLanguage: "zh",
      sourceInput: "https://www.bilibili.com/video/BV1darmBcE4A",
    })).resolves.toBeNull()

    await expect(repository.get()).resolves.toMatchObject({
      last_error: "Bilibili 登录态已失效",
      status: "expired",
    })
  })
})

function buildJsonResponse(payload: unknown) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  } satisfies Partial<Response> as Response
}

function buildTextResponse(status: number, body: string, contentType: string) {
  return {
    headers: new Headers({ "content-type": contentType }),
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
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
