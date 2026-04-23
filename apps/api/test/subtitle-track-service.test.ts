import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { SubtitleTrackService } from "../src/modules/study/subtitle-track-service.js"
import { TaskRepository } from "../src/modules/tasks/task-repository.js"
import { buildQueuedTaskRecord } from "../src/routes/task-route-support.js"

describe("SubtitleTrackService", () => {
  let config: AppConfig
  let storageDir = ""
  let taskRepository: TaskRepository

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-subtitle-track-"))
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

  it("does not probe yt-dlp for bilibili when materializing subtitle tracks without cached probe", async () => {
    const taskId = "task-bilibili-study-materialize"
    const resolveProbe = vi.fn(async () => {
      throw new Error("should not probe bilibili subtitle tracks")
    })
    const readCachedProbe = vi.fn(async () => null)

    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt: new Date().toISOString(),
        language: "zh",
        modelSize: "small",
        sourceInput: "https://www.bilibili.com/video/BV1darmBcE4A",
        sourceType: "bilibili",
        taskId,
        title: "B站学习域字幕轨测试",
        workflow: "notes",
      }),
    )

    const service = new SubtitleTrackService(config, taskRepository, {
      probeService: {
        readCachedProbe,
        resolveProbe,
      },
    })

    const tracks = await service.buildTracks((await taskRepository.getStoredRecord(taskId)) as never, {
      probeMode: "materialize",
    })

    expect(readCachedProbe).toHaveBeenCalledTimes(1)
    expect(resolveProbe).not.toHaveBeenCalled()
    expect(tracks.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          availability: "missing",
          kind: "source",
          label: "Bilibili 原始字幕轨",
        }),
        expect.objectContaining({
          availability: "available",
          kind: "whisper",
          label: "Bilibili Whisper 转写轨",
        }),
      ]),
    )
    expect(tracks.default_track_id).toBe("track-whisper-primary")
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
