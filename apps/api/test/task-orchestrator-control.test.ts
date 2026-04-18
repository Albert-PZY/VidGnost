import os from "node:os"
import path from "node:path"
import { mkdtemp, readFile, rm } from "node:fs/promises"

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

  it("publishes streamed transcript and correction preview events with timestamp-aligned artifacts", async () => {
    activeTaskId = "task-control-streaming"
    const sourcePath = path.join(storageDir, "stream-source.mp4")
    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt: new Date().toISOString(),
        language: "zh",
        modelSize: "small",
        sourceInput: sourcePath,
        sourceLocalPath: sourcePath,
        sourceType: "local_path",
        taskId: activeTaskId,
        title: "流式事件测试",
        workflow: "notes",
      }),
    )

    taskOrchestrator = new TaskOrchestrator(taskRepository, eventBus, {
      asrService: {
        transcribe: async ({
          onLog,
          onReset,
          onSegment,
        }: {
          onLog?: (message: string) => Promise<void> | void
          onReset?: () => Promise<void> | void
          onSegment?: (segment: TranscriptSegment) => Promise<void> | void
        }) => {
          await onReset?.()
          await onLog?.("Streaming transcription started")
          await onSegment?.({ start: 0, end: 1.2, text: "第一段 原始" })
          await onSegment?.({ start: 30, end: 31.8, text: "第二段 原始" })
          await onLog?.("Streaming transcription completed")
          return {
            language: "zh",
            chunks: [
              {
                durationSeconds: 31.8,
                index: 0,
                segments: [
                  { start: 0, end: 1.2, text: "第一段 原始" },
                  { start: 30, end: 31.8, text: "第二段 原始" },
                ],
                startSeconds: 0,
              },
            ],
            segments: [
              { start: 0, end: 1.2, text: "第一段 原始" },
              { start: 30, end: 31.8, text: "第二段 原始" },
            ],
            text: "第一段 原始\n第二段 原始",
          }
        },
      } as never,
      mediaPipelineService: {
        prepareSource: async ({ sourceLocalPath, taskId }: { sourceLocalPath?: string | null; taskId: string }) => ({
          durationSeconds: 120,
          fileSizeBytes: 128,
          mediaPath: sourceLocalPath || path.join(storageDir, `${taskId}.mp4`),
          sourceLabel: sourceLocalPath || `${taskId}.mp4`,
          title: "流式事件测试",
        }),
        extractAudio: async ({ taskId }: { taskId: string }) => ({
          audioPath: path.join(storageDir, `${taskId}.wav`),
          durationSeconds: 120,
        }),
      } as never,
      summaryService: {
        buildArtifacts: async ({
          onCorrectionPreviewEvent,
          transcriptSegments,
        }: {
          onCorrectionPreviewEvent?: (payload: {
            done?: boolean
            fallbackUsed?: boolean
            mode: "rewrite" | "strict"
            reset?: boolean
            segment?: TranscriptSegment
          }) => Promise<void> | void
          transcriptSegments: TranscriptSegment[]
          transcriptText: string
        }) => {
          await onCorrectionPreviewEvent?.({
            mode: "rewrite",
            reset: true,
          })
          await onCorrectionPreviewEvent?.({
            mode: "rewrite",
            segment: { start: 0, end: 1.2, text: "第一段 修正" },
          })
          await onCorrectionPreviewEvent?.({
            mode: "rewrite",
            segment: { start: 30, end: 31.8, text: "第二段 修正" },
          })
          await onCorrectionPreviewEvent?.({
            done: true,
            fallbackUsed: false,
            mode: "rewrite",
          })
          return {
            artifactManifestJson: JSON.stringify({}),
            correctedSegments: [
              { start: 0, end: 1.2, text: "第一段 修正" },
              { start: 30, end: 31.8, text: "第二段 修正" },
            ],
            correctedText: "第一段 修正\n第二段 修正",
            correctionFullText: "第一段 修正\n第二段 修正",
            correctionIndexJson: JSON.stringify({ mode: "rewrite", status: "completed", fallback_used: false }),
            correctionRewriteText: "第一段 修正\n第二段 修正",
            correctionStrictSegmentsJson: null,
            fallbackArtifactChannels: [],
            fusionPromptMarkdown: "# prompt",
            mindmapMarkdown: "# mindmap",
            notesMarkdown: "## notes",
            summaryMarkdown: "## summary",
          }
        },
        isLlmGenerationEnabled: async () => false,
      } as never,
    })

    await taskOrchestrator.submit({
      taskId: activeTaskId,
      sourceInput: sourcePath,
      sourceLocalPath: sourcePath,
      workflow: "notes",
    })

    await waitFor(async () => {
      const detail = await taskRepository.getDetail(activeTaskId)
      return detail?.status === "completed"
    }, 5_000)

    const eventLogPath = path.join(storageDir, "event-logs", `${activeTaskId}.jsonl`)
    const transcriptChunkIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      activeTaskId,
      "C",
      "transcript",
      "index.json",
    )
    const transcriptChunkOnePath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      activeTaskId,
      "C",
      "transcript",
      "chunks",
      "chunk-001.json",
    )

    const eventLog = await readFile(eventLogPath, "utf8")
    const events = eventLog
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const transcriptEvents = events.filter((event) => event.type === "transcript_delta")
    const correctionEvents = events.filter((event) => event.type === "transcript_optimized_preview")
    const transcriptProgressEvents = events.filter((event) =>
      event.type === "progress" &&
      event.stage === "C" &&
      typeof event.stage_progress === "number" &&
      Number(event.stage_progress) > 0 &&
      Number(event.stage_progress) < 100
    )

    expect(transcriptEvents).toEqual([
      expect.objectContaining({ reset: true, task_id: activeTaskId, type: "transcript_delta" }),
      expect.objectContaining({ start: 0, end: 1.2, text: "第一段 原始", type: "transcript_delta" }),
      expect.objectContaining({ start: 30, end: 31.8, text: "第二段 原始", type: "transcript_delta" }),
    ])
    expect(correctionEvents).toEqual([
      expect.objectContaining({ mode: "rewrite", reset: true, type: "transcript_optimized_preview" }),
      expect.objectContaining({ mode: "rewrite", start: 0, end: 1.2, text: "第一段 修正", type: "transcript_optimized_preview" }),
      expect.objectContaining({ mode: "rewrite", start: 30, end: 31.8, text: "第二段 修正", type: "transcript_optimized_preview" }),
      expect.objectContaining({ done: true, fallback_used: false, mode: "rewrite", type: "transcript_optimized_preview" }),
    ])
    expect(transcriptProgressEvents.length).toBeGreaterThan(0)

    const transcriptChunkIndex = JSON.parse(await readFile(transcriptChunkIndexPath, "utf8")) as {
      chunks?: Array<{ relative_path?: string }>
      mode?: string
    }
    const transcriptChunkOne = JSON.parse(await readFile(transcriptChunkOnePath, "utf8")) as {
      segments?: TranscriptSegment[]
    }

    expect(transcriptChunkIndex.chunks).toEqual([
      { relative_path: "C/transcript/chunks/chunk-001.json" },
    ])
    expect(transcriptChunkIndex.mode).toBe("single")
    expect(transcriptChunkOne.segments).toEqual([
      { start: 0, end: 1.2, text: "第一段 原始" },
      { start: 30, end: 31.8, text: "第二段 原始" },
    ])
  })

  it("publishes granular VQA substages for transcript vectorization, frame extraction, semantics, and fusion", async () => {
    activeTaskId = "task-control-vqa-stages"
    const sourcePath = path.join(storageDir, "vqa-source.mp4")
    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt: new Date().toISOString(),
        language: "zh",
        modelSize: "small",
        sourceInput: sourcePath,
        sourceLocalPath: sourcePath,
        sourceType: "local_path",
        taskId: activeTaskId,
        title: "VQA 阶段事件测试",
        workflow: "vqa",
      }),
    )

    taskOrchestrator = new TaskOrchestrator(taskRepository, eventBus, {
      asrService: {
        transcribe: async ({
          onReset,
          onSegment,
        }: {
          onReset?: () => Promise<void> | void
          onSegment?: (segment: TranscriptSegment) => Promise<void> | void
        }) => {
          await onReset?.()
          await onSegment?.({ start: 0, end: 1.5, text: "VQA 原始转写" })
          return {
            language: "zh",
            chunks: [
              {
                durationSeconds: 90,
                index: 0,
                segments: [{ start: 0, end: 1.5, text: "VQA 原始转写" }],
                startSeconds: 0,
              },
            ],
            segments: [{ start: 0, end: 1.5, text: "VQA 原始转写" }],
            text: "VQA 原始转写",
          }
        },
      } as never,
      mediaPipelineService: {
        prepareSource: async ({ sourceLocalPath, taskId }: { sourceLocalPath?: string | null; taskId: string }) => ({
          durationSeconds: 90,
          fileSizeBytes: 128,
          mediaPath: sourceLocalPath || path.join(storageDir, `${taskId}.mp4`),
          sourceLabel: sourceLocalPath || `${taskId}.mp4`,
          title: "VQA 阶段事件测试",
        }),
        extractAudio: async ({ taskId }: { taskId: string }) => ({
          audioPath: path.join(storageDir, `${taskId}.wav`),
          durationSeconds: 90,
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
      videoFrameService: {
        extractFrames: async () => ({
          manifest: {
            frames: [
              {
                frame_index: 0,
                path: "frames/frame-0001.jpg",
                timestamp_seconds: 4,
              },
            ],
          },
          manifestJson: JSON.stringify({
            task_id: activeTaskId,
            frame_count: 1,
            frames: [
              {
                frame_index: 0,
                path: "frames/frame-0001.jpg",
                timestamp_seconds: 4,
              },
            ],
          }),
        }),
      } as never,
      vlmRuntimeService: {
        describeFrame: async () => ({
          content: "画面里有人在讲解白板内容",
        }),
      } as never,
    })

    await taskOrchestrator.submit({
      taskId: activeTaskId,
      sourceInput: sourcePath,
      sourceLocalPath: sourcePath,
      workflow: "vqa",
    })

    await waitFor(async () => {
      const detail = await taskRepository.getDetail(activeTaskId)
      return detail?.status === "completed"
    }, 5_000)

    const eventLogPath = path.join(storageDir, "event-logs", `${activeTaskId}.jsonl`)
    const eventLog = await readFile(eventLogPath, "utf8")
    const events = eventLog
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    const substageStarts = events
      .filter((event) => event.type === "substage_start")
      .map((event) => String(event.substage || ""))
    const substageCompletions = events
      .filter((event) => event.type === "substage_complete")
      .map((event) => String(event.substage || ""))

    expect(substageStarts).toEqual(expect.arrayContaining([
      "transcript_vectorize",
      "frame_extract",
      "frame_semantic",
      "multimodal_index_fusion",
      "fusion_delivery",
    ]))
    expect(substageCompletions).toEqual(expect.arrayContaining([
      "transcript_vectorize",
      "frame_extract",
      "frame_semantic",
      "multimodal_index_fusion",
      "fusion_delivery",
    ]))
  })

  it("skips VLM enrichment for fallback frames and writes template semantic evidence immediately", async () => {
    activeTaskId = "task-control-vqa-fallback-frame"
    const sourcePath = path.join(storageDir, "vqa-fallback-frame-source.mp4")
    let describeFrameCallCount = 0

    await taskRepository.create(
      buildQueuedTaskRecord({
        createdAt: new Date().toISOString(),
        language: "zh",
        modelSize: "small",
        sourceInput: sourcePath,
        sourceLocalPath: sourcePath,
        sourceType: "local_path",
        taskId: activeTaskId,
        title: "VQA 回退帧测试",
        workflow: "vqa",
      }),
    )

    taskOrchestrator = new TaskOrchestrator(taskRepository, eventBus, {
      asrService: {
        transcribe: async () => ({
          language: "zh",
          segments: [
            {
              start: 0,
              end: 3,
              text: "回退帧也要能继续构建检索索引",
            },
          ],
          text: "回退帧也要能继续构建检索索引",
        }),
      } as never,
      mediaPipelineService: {
        prepareSource: async ({ sourceLocalPath, taskId }: { sourceLocalPath?: string | null; taskId: string }) => ({
          durationSeconds: 32,
          fileSizeBytes: 128,
          mediaPath: sourceLocalPath || path.join(storageDir, `${taskId}.mp4`),
          sourceLabel: sourceLocalPath || `${taskId}.mp4`,
          title: "VQA 回退帧测试",
        }),
        extractAudio: async ({ taskId }: { taskId: string }) => ({
          audioPath: path.join(storageDir, `${taskId}.wav`),
          durationSeconds: 32,
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
      videoFrameService: {
        extractFrames: async () => ({
          manifest: {
            frames: [
              {
                frame_index: 0,
                is_fallback: true,
                path: "frames/frame-0001.jpg",
                timestamp_seconds: 0,
              },
            ],
          },
          manifestJson: JSON.stringify({
            task_id: activeTaskId,
            frame_count: 1,
            frames: [
              {
                frame_index: 0,
                is_fallback: true,
                path: "frames/frame-0001.jpg",
                timestamp_seconds: 0,
              },
            ],
          }),
        }),
      } as never,
      vlmRuntimeService: {
        describeFrame: async () => {
          describeFrameCallCount += 1
          return {
            content: "这条内容不应该被使用",
          }
        },
      } as never,
    })

    await taskOrchestrator.submit({
      taskId: activeTaskId,
      sourceInput: sourcePath,
      sourceLocalPath: sourcePath,
      workflow: "vqa",
    })

    await waitFor(async () => {
      const detail = await taskRepository.getDetail(activeTaskId)
      return detail?.status === "completed"
    }, 5_000)

    expect(describeFrameCallCount).toBe(0)

    const frameSemanticIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      activeTaskId,
      "D",
      "vqa-prewarm",
      "frame-semantic",
      "index.json",
    )
    const frameSemanticIndex = JSON.parse(await readFile(frameSemanticIndexPath, "utf8")) as {
      item_count: number
      items: Array<{ visual_text?: string }>
    }

    expect(frameSemanticIndex.item_count).toBe(1)
    expect(frameSemanticIndex.items[0]?.visual_text).toContain("等待视觉语义补全")
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
