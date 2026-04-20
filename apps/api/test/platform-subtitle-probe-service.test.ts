import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { TaskRepository } from "../src/modules/tasks/task-repository.js"
import { PlatformSubtitleProbeService } from "../src/modules/subtitles/platform-subtitle-probe-service.js"

describe("PlatformSubtitleProbeService", () => {
  let config: AppConfig
  let storageDir = ""
  let taskRepository: TaskRepository

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-subtitle-probe-"))
    config = createTestConfig(storageDir)
    taskRepository = new TaskRepository(config)
  })

  afterEach(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
      storageDir = ""
    }
  })

  it("returns cached probe payload without invoking yt-dlp again", async () => {
    await taskRepository.writeTaskArtifactText(
      "task-probe-cache",
      "D/study/subtitle-probe.json",
      JSON.stringify({
        subtitles: {
          zh: [{ ext: "vtt", url: "https://cdn.example.com/source-zh.vtt" }],
        },
      }, null, 2),
    )
    const runCommand = vi.fn(async () => ({ stderr: "", stdout: "{}" }))
    const service = new PlatformSubtitleProbeService(config, taskRepository, {
      resolveYtDlpExecutable: async () => "yt-dlp.exe",
      runCommand,
    })

    const resolved = await service.resolveProbe({
      sourceInput: "https://www.youtube.com/watch?v=cached",
      taskId: "task-probe-cache",
    })

    expect(resolved).toEqual({
      payload: {
        automatic_captions: {},
        subtitles: {
          zh: [{ ext: "vtt", url: "https://cdn.example.com/source-zh.vtt" }],
        },
      },
      status: "available",
    })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it("re-probes when cached payload is corrupted and persists the normalized subtitle payload", async () => {
    await taskRepository.writeTaskArtifactText(
      "task-probe-refresh",
      "D/study/subtitle-probe.json",
      "{invalid json",
    )
    const runCommand = vi.fn(async () => ({
      stderr: "",
      stdout: JSON.stringify({
        automatic_captions: {
          en: [{ ext: "json3", name: "English", url: "https://cdn.example.com/auto-en.json3" }],
        },
        extractor: "youtube",
        subtitles: {
          zh: [{ ext: "vtt", name: "中文", url: "https://cdn.example.com/source-zh.vtt" }],
        },
        title: "ignored",
      }),
    }))
    const onLog = vi.fn()
    const service = new PlatformSubtitleProbeService(config, taskRepository, {
      resolveYtDlpExecutable: async () => "yt-dlp.exe",
      runCommand,
    })

    const resolved = await service.resolveProbe({
      onLog,
      sourceInput: "https://www.youtube.com/watch?v=refresh",
      taskId: "task-probe-refresh",
    })

    expect(resolved).toEqual({
      payload: {
        automatic_captions: {
          en: [{ ext: "json3", name: "English", url: "https://cdn.example.com/auto-en.json3" }],
        },
        subtitles: {
          zh: [{ ext: "vtt", name: "中文", url: "https://cdn.example.com/source-zh.vtt" }],
        },
      },
      status: "available",
    })
    expect(onLog).toHaveBeenCalledWith("已忽略损坏的 subtitle-probe 缓存，准备重新探测平台字幕")
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(
        (await taskRepository.readTaskArtifactText("task-probe-refresh", "D/study/subtitle-probe.json")) || "null",
      ),
    ).toEqual({
      automatic_captions: {
        en: [{ ext: "json3", name: "English", url: "https://cdn.example.com/auto-en.json3" }],
      },
      subtitles: {
        zh: [{ ext: "vtt", name: "中文", url: "https://cdn.example.com/source-zh.vtt" }],
      },
    })
  })

  it("returns missing when yt-dlp probe succeeds but no subtitle tracks are present", async () => {
    const service = new PlatformSubtitleProbeService(config, taskRepository, {
      resolveYtDlpExecutable: async () => "yt-dlp.exe",
      runCommand: async () => ({
        stderr: "",
        stdout: JSON.stringify({
          automatic_captions: {},
          subtitles: {},
        }),
      }),
    })

    const resolved = await service.resolveProbe({
      sourceInput: "https://www.bilibili.com/video/BV1missing",
      taskId: "task-probe-missing",
    })

    expect(resolved).toEqual({
      payload: {
        automatic_captions: {},
        subtitles: {},
      },
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
