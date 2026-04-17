import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { TranscriptSegment } from "@vidgnost/contracts"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { EventBus } from "../src/modules/events/event-bus.js"
import { TaskOrchestrator } from "../src/modules/tasks/task-orchestrator.js"
import { TaskRepository } from "../src/modules/tasks/task-repository.js"
import { buildQueuedTaskRecord } from "../src/routes/task-route-support.js"

describe("TaskOrchestrator control flow", () => {
  let config: AppConfig
  let eventBus: EventBus
  let storageDir = ""
  let taskOrchestrator: TaskOrchestrator
  let taskRepository: TaskRepository
  let activeTaskId = ""
  let transcribeRunCount = 0
  let activeTranscribeSignal: AbortSignal | null = null

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-task-control-"))
    config = createTestConfig(storageDir)
    taskRepository = new TaskRepository(config)
    eventBus = new EventBus(config.eventLogDir)
    activeTaskId = ""
    transcribeRunCount = 0
    activeTranscribeSignal = null

    taskOrchestrator = new TaskOrchestrator(taskRepository, eventBus, {
      asrService: {
        transcribe: async ({ signal }: { signal?: AbortSignal }) => {
          transcribeRunCount += 1
          activeTranscribeSignal = signal ?? null
          if (transcribeRunCount === 1 && signal) {
            await new Promise<never>((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("transcription aborted")), { once: true })
            })
          }
          return {
            language: "zh",
            segments: [
              {
                start: 0,
                end: 1,
                text: "测试转写",
              },
            ],
            text: "测试转写",
          }
        },
      } as never,
      mediaPipelineService: {
        prepareSource: async ({ sourceLocalPath, taskId }: { sourceLocalPath?: string | null; taskId: string }) => ({
          durationSeconds: 12,
          fileSizeBytes: 128,
          mediaPath: sourceLocalPath || path.join(storageDir, `${taskId}.mp4`),
          sourceLabel: sourceLocalPath || `${taskId}.mp4`,
          title: "控制流测试",
        }),
        extractAudio: async ({ taskId }: { taskId: string }) => ({
          audioPath: path.join(storageDir, `${taskId}.wav`),
          durationSeconds: 12,
        }),
      } as never,
      summaryService: {
        buildArtifacts: async ({
          transcriptSegments,
          transcriptText,
        }: {
          transcriptSegments: TranscriptSegment[]
          transcriptText: string
        }) => ({
          artifactManifestJson: JSON.stringify({}),
          correctedSegments: transcriptSegments,
          correctedText: transcriptText,
          correctionFullText: transcriptText,
          correctionIndexJson: JSON.stringify({ status: "skipped" }),
          correctionRewriteText: transcriptText,
          correctionStrictSegmentsJson: JSON.stringify(transcriptSegments),
          fallbackArtifactChannels: [],
          fusionPromptMarkdown: "# prompt",
          mindmapMarkdown: "# mindmap",
          notesMarkdown: "## notes",
          summaryMarkdown: "## summary",
        }),
        isLlmGenerationEnabled: async () => false,
      } as never,
    })
  })

  afterEach(async () => {
    if (activeTaskId) {
      await taskOrchestrator.cancelAndWait(activeTaskId).catch(() => undefined)
      await waitFor(async () => {
        const record = await taskRepository.getStoredRecord(activeTaskId)
        return !record || ["cancelled", "completed", "failed"].includes(String(record.status || ""))
      }, 2_000).catch(() => undefined)
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
      storageDir = ""
    }
  })

  it("aborts the active transcription on pause and resumes the paused stage instead of switching to stage D", async () => {
    activeTaskId = "task-control-pause"
    const sourcePath = path.join(storageDir, "pause-source.mp4")
    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt: new Date().toISOString(),
        language: "zh",
        modelSize: "small",
        sourceInput: sourcePath,
        sourceLocalPath: sourcePath,
        sourceType: "local_path",
        taskId: activeTaskId,
        title: "控制流测试",
        workflow: "notes",
      }),
    )

    await taskOrchestrator.submit({
      taskId: activeTaskId,
      sourceInput: sourcePath,
      sourceLocalPath: sourcePath,
      workflow: "notes",
    })

    await waitFor(() => transcribeRunCount === 1 && activeTranscribeSignal !== null, 2_000)

    expect(await taskOrchestrator.pause(activeTaskId)).toBe(true)
    await waitFor(() => activeTranscribeSignal?.aborted === true, 1_000)

    const pausedDetail = await taskRepository.getDetail(activeTaskId)
    expect(pausedDetail?.status).toBe("paused")
    expect(pausedDetail?.stage_metrics.C?.status).toBe("paused")

    expect(await taskOrchestrator.resume(activeTaskId)).toBe(true)

    await waitFor(async () => {
      const detail = await taskRepository.getDetail(activeTaskId)
      return (
        detail?.status === "running" &&
        detail?.stage_metrics.C?.status === "running" &&
        detail?.stage_metrics.D?.status === "pending"
      )
    }, 1_000)

    const resumedDetail = await taskRepository.getDetail(activeTaskId)
    expect(resumedDetail?.stage_metrics.C?.status).toBe("running")
    expect(resumedDetail?.stage_metrics.D?.status).toBe("pending")

    await waitFor(async () => {
      const detail = await taskRepository.getDetail(activeTaskId)
      return detail?.status === "completed"
    }, 5_000)

    expect(transcribeRunCount).toBe(2)
  })

  it("cancels a paused transcription without marking stage D as cancelled", async () => {
    activeTaskId = "task-control-cancel-paused"
    const sourcePath = path.join(storageDir, "cancel-source.mp4")
    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt: new Date().toISOString(),
        language: "zh",
        modelSize: "small",
        sourceInput: sourcePath,
        sourceLocalPath: sourcePath,
        sourceType: "local_path",
        taskId: activeTaskId,
        title: "控制流测试",
        workflow: "notes",
      }),
    )

    await taskOrchestrator.submit({
      taskId: activeTaskId,
      sourceInput: sourcePath,
      sourceLocalPath: sourcePath,
      workflow: "notes",
    })

    await waitFor(() => transcribeRunCount === 1 && activeTranscribeSignal !== null, 2_000)

    expect(await taskOrchestrator.pause(activeTaskId)).toBe(true)
    await waitFor(() => activeTranscribeSignal?.aborted === true, 1_000)

    const pausedDetail = await taskRepository.getDetail(activeTaskId)
    expect(pausedDetail?.status).toBe("paused")
    expect(pausedDetail?.stage_metrics.C?.status).toBe("paused")
    expect(pausedDetail?.stage_metrics.D?.status).toBe("pending")

    expect(await taskOrchestrator.cancel(activeTaskId)).toBe(true)

    await waitFor(async () => {
      const detail = await taskRepository.getDetail(activeTaskId)
      return (
        detail?.status === "cancelled" &&
        detail?.stage_metrics.C?.status === "cancelled" &&
        detail?.stage_metrics.D?.status === "pending"
      )
    }, 2_000)

    const cancelledDetail = await taskRepository.getDetail(activeTaskId)
    expect(cancelledDetail?.stage_metrics.C?.status).toBe("cancelled")
    expect(cancelledDetail?.stage_metrics.D?.status).toBe("pending")
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

async function waitFor(
  condition: (() => boolean) | (() => Promise<boolean>),
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error("Condition was not met in time")
}
