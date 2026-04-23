import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { PlatformSubtitleTranscriptService } from "../src/modules/asr/platform-subtitle-transcript-service.js"
import { TaskRepository } from "../src/modules/tasks/task-repository.js"

describe("PlatformSubtitleTranscriptService", () => {
  let config: AppConfig
  let storageDir = ""
  let taskRepository: TaskRepository

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-platform-transcript-"))
    config = createTestConfig(storageDir)
    taskRepository = new TaskRepository(config)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
      storageDir = ""
    }
  })

  it("keeps public yt-dlp subtitles as the first choice when a usable track exists", async () => {
    const bilibiliSubtitleClient = {
      fetchBestSubtitle: vi.fn(async () => null),
    }
    const service = new PlatformSubtitleTranscriptService(config, taskRepository, {
      bilibiliSubtitleClient,
      fetch: vi.fn(async () => ({
        ok: true,
        text: async () => "WEBVTT\n\n00:00:00.000 --> 00:00:01.200\n公共字幕第一句\n",
      } satisfies Partial<Response> as Response)),
      probeService: {
        resolveProbe: async () => ({
          payload: {
            automatic_captions: {},
            subtitles: {
              zh: [{ ext: "vtt", name: "中文", url: "https://cdn.example.com/public.vtt" }],
            },
          },
          status: "available" as const,
        }),
      } as never,
    })

    const result = await service.transcribeFromPlatformSubtitles({
      preferredLanguage: "zh",
      sourceInput: "https://www.bilibili.com/video/BV1public",
      sourceType: "bilibili",
      taskId: "task-public-first",
    })

    expect(result).toMatchObject({
      source: "yt-dlp",
      text: "公共字幕第一句",
    })
    expect(bilibiliSubtitleClient.fetchBestSubtitle).not.toHaveBeenCalled()
    await expect(
      taskRepository.readTaskArtifactText("task-public-first", "C/platform-subtitles/selected-track.json"),
    ).resolves.toContain("\"source\": \"yt-dlp\"")
  })

  it("falls back to bilibili auth subtitles when public subtitle probing misses", async () => {
    const bilibiliSubtitleClient = {
      fetchBestSubtitle: vi.fn(async () => ({
        language: "zh-cn",
        raw_subtitle_json: JSON.stringify({
          body: [
            { content: "AI 字幕第一句", from: 0, to: 1.2 },
            { content: "AI 字幕第二句", from: 1.2, to: 2.8 },
          ],
        }),
        segments: [
          { start: 0, end: 1.2, text: "AI 字幕第一句" },
          { start: 1.2, end: 2.8, text: "AI 字幕第二句" },
        ],
        source: "bilibili-auth" as const,
        subtitle_url: "https://i0.hdslb.com/bfs/subtitle/ai.json",
        text: "AI 字幕第一句\nAI 字幕第二句",
        track: {
          ext: "json",
          label: "中文 AI 字幕",
          language: "zh-cn",
          subtitle_url: "https://i0.hdslb.com/bfs/subtitle/ai.json",
        },
      })),
    }
    const service = new PlatformSubtitleTranscriptService(config, taskRepository, {
      bilibiliSubtitleClient,
      probeService: {
        resolveProbe: async () => ({
          payload: {
            automatic_captions: {},
            subtitles: {},
          },
          status: "missing" as const,
        }),
      } as never,
    })

    const result = await service.transcribeFromPlatformSubtitles({
      preferredLanguage: "zh",
      sourceInput: "https://www.bilibili.com/video/BV1auth",
      sourceType: "bilibili",
      taskId: "task-bilibili-auth",
    })

    expect(result).toMatchObject({
      source: "bilibili-auth",
      text: "AI 字幕第一句\nAI 字幕第二句",
    })
    await expect(
      taskRepository.readTaskArtifactText("task-bilibili-auth", "C/platform-subtitles/selected-track.json"),
    ).resolves.toContain("\"source\": \"bilibili-auth\"")
    await expect(
      taskRepository.readTaskArtifactText("task-bilibili-auth", "D/study/subtitle-probe.json"),
    ).resolves.toContain("bilibili-auth")
  })

  it("returns null when both public subtitles and bilibili auth subtitles are unavailable", async () => {
    const bilibiliSubtitleClient = {
      fetchBestSubtitle: vi.fn(async () => null),
    }
    const onLog = vi.fn()
    const service = new PlatformSubtitleTranscriptService(config, taskRepository, {
      bilibiliSubtitleClient,
      probeService: {
        resolveProbe: async () => ({
          payload: {
            automatic_captions: {},
            subtitles: {},
          },
          status: "missing" as const,
        }),
      } as never,
    })

    await expect(service.transcribeFromPlatformSubtitles({
      onLog,
      preferredLanguage: "zh",
      sourceInput: "https://www.bilibili.com/video/BV1fallback",
      sourceType: "bilibili",
      taskId: "task-bilibili-fallback",
    })).resolves.toBeNull()

    expect(bilibiliSubtitleClient.fetchBestSubtitle).toHaveBeenCalledTimes(1)
    expect(onLog).toHaveBeenCalledWith("B 站登录态字幕不可用，已回退 ASR 转写")
  })

  it("logs bilibili auth fallback errors and continues toward whisper fallback", async () => {
    const bilibiliSubtitleClient = {
      fetchBestSubtitle: vi.fn(async () => {
        throw new Error("upstream auth failed")
      }),
    }
    const onLog = vi.fn()
    const service = new PlatformSubtitleTranscriptService(config, taskRepository, {
      bilibiliSubtitleClient,
      probeService: {
        resolveProbe: async () => ({
          payload: {
            automatic_captions: {},
            subtitles: {},
          },
          status: "missing" as const,
        }),
      } as never,
    })

    await expect(service.transcribeFromPlatformSubtitles({
      onLog,
      preferredLanguage: "zh",
      sourceInput: "https://www.bilibili.com/video/BV1fallback-error",
      sourceType: "bilibili",
      taskId: "task-bilibili-fallback-error",
    })).resolves.toBeNull()

    expect(bilibiliSubtitleClient.fetchBestSubtitle).toHaveBeenCalledTimes(1)
    expect(onLog).toHaveBeenCalledWith("B 站登录态 AI 字幕请求失败，已继续回退 ASR 转写: upstream auth failed")
    expect(onLog).toHaveBeenCalledWith("B 站登录态字幕不可用，已回退 ASR 转写")
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
