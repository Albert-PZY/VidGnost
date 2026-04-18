import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { vqaTraceResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("vqa routes", () => {
  let app: FastifyInstance
  let baseUrl = ""
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-vqa-"))
    await seedVqaFixture(storageDir)
    app = await buildApp({
      apiPrefix: "/api",
      llmBaseUrl: "http://127.0.0.1:9/v1",
      storageDir,
    })
    baseUrl = await app.listen({
      host: "127.0.0.1",
      port: 0,
    })
  })

  afterAll(async () => {
    await app.close()
    if (storageDir) {
      await rm(storageDir, { force: true, recursive: true })
    }
  })

  it("searches transcript evidence, streams chat, and returns trace payload", async () => {
    const searchResponse = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: {
        task_id: "task-vqa-1",
        question: "用户体验设计核心是什么",
        top_k: 3,
      },
    })

    expect(searchResponse.statusCode).toBe(200)
    const searchPayload = searchResponse.json<{
      hits: Array<{ task_id: string; text: string; source_set?: string[] }>
      trace_id: string
    }>()
    expect(searchPayload.trace_id).toBeTruthy()
    expect(searchPayload.hits[0]?.task_id).toBe("task-vqa-1")
    expect(searchPayload.hits.length).toBeGreaterThan(0)
    expect(Array.isArray(searchPayload.hits[0]?.source_set)).toBe(true)
    expect(searchPayload.hits[0]?.source_set?.length || 0).toBeGreaterThan(0)
    expect("dense_hits" in (searchPayload as Record<string, unknown>)).toBe(false)
    expect("rerank_hits" in (searchPayload as Record<string, unknown>)).toBe(false)

    const streamResponse = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task_id: "task-vqa-1",
        question: "用户体验设计核心是什么",
        top_k: 3,
        stream: true,
      }),
    })

    expect(streamResponse.status).toBe(200)
    expect(streamResponse.headers.get("content-type") || "").toContain("text/event-stream")
    const streamBody = await streamResponse.text()
    expect(streamBody).toContain("\"type\":\"status\"")
    expect(streamBody).toContain("\"type\":\"citations\"")
    expect(streamBody).toContain("\"type\":\"chunk\"")
    expect(streamBody).toContain("\"type\":\"done\"")
    const streamTraceIds = [...streamBody.matchAll(/"trace_id":"([^"]+)"/g)].map((match) => match[1])
    expect(streamTraceIds.length).toBeGreaterThan(0)
    expect(new Set(streamTraceIds).size).toBe(1)
    const streamTraceId = streamTraceIds[0]

    const traceResponse = await app.inject({
      method: "GET",
      url: `/api/traces/${streamTraceId}`,
    })

    expect(traceResponse.statusCode).toBe(200)
    const tracePayload = vqaTraceResponseSchema.parse(traceResponse.json())
    expect(tracePayload.trace_id).toBe(streamTraceId)
    expect(tracePayload.records.some((item) => item.stage === "trace_started")).toBe(true)
    expect(tracePayload.records.some((item) => item.stage === "retrieval")).toBe(true)
    expect(tracePayload.records.some((item) => item.stage === "llm_request")).toBe(true)
    expect(tracePayload.records.some((item) => item.stage === "trace_finished")).toBe(true)

    const traceStarted = tracePayload.records.find((item) => item.stage === "trace_started")
    expect((traceStarted?.payload as { config_snapshot?: { retrieval?: { mode?: string } } } | undefined)?.config_snapshot?.retrieval?.mode).toBe(
      "vector-index",
    )
    const retrievalRecord = tracePayload.records.find((item) => item.stage === "retrieval")
    const retrievalPayload = (retrievalRecord?.payload || {}) as Record<string, unknown>
    expect(Array.isArray(retrievalPayload.hits)).toBe(true)
    expect("dense_hits" in retrievalPayload).toBe(false)
    expect("sparse_hits" in retrievalPayload).toBe(false)
    expect("rrf_hits" in retrievalPayload).toBe(false)
    expect("rerank_hits" in retrievalPayload).toBe(false)
    const llmRequestRecord = tracePayload.records.find((item) => item.stage === "llm_request")
    const llmRequestPayload = (llmRequestRecord?.payload || {}) as Record<string, unknown>
    expect(typeof llmRequestPayload.status).toBe("string")
    expect(typeof llmRequestPayload.prompt_preview).toBe("string")
    expect(Number(llmRequestPayload.hit_count || 0)).toBeGreaterThan(0)

    const prewarmIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-1",
      "D",
      "vqa-prewarm",
      "index.json",
    )
    const multimodalIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-1",
      "D",
      "vqa-prewarm",
      "multimodal",
      "index.json",
    )
    const frameSemanticIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-1",
      "D",
      "vqa-prewarm",
      "frame-semantic",
      "index.json",
    )
    const prewarmIndex = JSON.parse(await readFile(prewarmIndexPath, "utf8")) as {
      retrieval_mode: string
      item_count: number
      items?: Array<{ source?: string; source_set?: string[]; image_path?: string; visual_text?: string }>
    }
    const multimodalIndex = JSON.parse(await readFile(multimodalIndexPath, "utf8")) as {
      mode: string
      task_id: string
      entries: Array<{ artifact_path?: string; kind?: string; modality?: string }>
    }
    const frameSemanticIndex = JSON.parse(await readFile(frameSemanticIndexPath, "utf8")) as {
      task_id: string
      item_count: number
      items: Array<{ image_path?: string; visual_text?: string }>
    }
    expect(prewarmIndex.retrieval_mode).toBe("vector-index")
    expect(prewarmIndex.item_count).toBeGreaterThan(0)
    expect(multimodalIndex.task_id).toBe("task-vqa-1")
    expect(multimodalIndex.mode).toBe("multimodal")
    expect(Array.isArray(multimodalIndex.entries)).toBe(true)
    expect(multimodalIndex.entries.some((entry) => entry.kind === "frame_semantic")).toBe(true)
    expect(frameSemanticIndex.task_id).toBe("task-vqa-1")
    expect(frameSemanticIndex.item_count).toBeGreaterThan(0)
    expect(frameSemanticIndex.items[0]?.image_path).toMatch(/^frames\//)
    expect(frameSemanticIndex.items[0]?.visual_text).toBeTruthy()
    const sourceSet = new Set(
      (prewarmIndex.items || []).flatMap((item) => {
        const set = Array.isArray(item.source_set) ? item.source_set : []
        if (set.length > 0) {
          return set
        }
        return item.source ? [item.source] : []
      }),
    )
    expect(sourceSet.has("transcript")).toBe(true)
    expect(sourceSet.has("frame_semantic")).toBe(true)
    expect((prewarmIndex.items || []).some((item) => item.image_path && item.visual_text)).toBe(true)
  })

  it("exposes video frame service and keeps frame manifest fixture readable", async () => {
    const appWithVideoFrameService = app as FastifyInstance & {
      videoFrameService?: unknown
    }
    expect(appWithVideoFrameService.videoFrameService).toBeTruthy()

    const frameManifestPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-1",
      "D",
      "vqa-prewarm",
      "frames",
      "manifest.json",
    )
    const frameManifest = JSON.parse(await readFile(frameManifestPath, "utf8")) as {
      task_id: string
      interval_seconds: number
      frames: Array<{
        frame_index: number
        path: string
      }>
    }
    expect(frameManifest.task_id).toBe("task-vqa-1")
    expect(frameManifest.interval_seconds).toBeGreaterThan(0)
    expect(frameManifest.frames.length).toBeGreaterThan(0)
    expect(frameManifest.frames[0]?.path).toMatch(/^frames\//)

    const firstFramePath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-1",
      "D",
      "vqa-prewarm",
      frameManifest.frames[0]?.path || "",
    )
    const firstFrame = await readFile(firstFramePath, "utf8")
    expect(firstFrame.length).toBeGreaterThan(0)
  })
})

describe("vlm runtime stubs", () => {
  it.todo("calls openai-compatible image chat/completions for single-frame description")
  it.todo("calls openai-compatible image chat/completions for batch-frame description")
  it.todo("keeps compatibility with ollama openai-compatible vision model endpoint")
})

async function seedVqaFixture(storageDir: string): Promise<void> {
  const recordsDir = path.join(storageDir, "tasks", "records")
  const uploadsDir = path.join(storageDir, "uploads")
  const frameDir = path.join(
    storageDir,
    "tasks",
    "stage-artifacts",
    "task-vqa-1",
    "D",
    "vqa-prewarm",
    "frames",
  )
  await mkdir(recordsDir, { recursive: true })
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(frameDir, { recursive: true })

  const sourcePath = path.join(uploadsDir, "task-vqa-1_fixture.mp4")
  await writeFile(sourcePath, Buffer.from("fixture-video"), "utf8")

  const record = {
    id: "task-vqa-1",
    source_type: "local_file",
    source_input: "fixture-video.mp4",
    source_local_path: sourcePath,
    workflow: "vqa",
    title: "Fixture VQA Task",
    duration_seconds: 48.5,
    language: "zh",
    model_size: "small",
    file_size_bytes: 128,
    status: "completed",
    progress: 100,
    error_message: null,
    transcript_text: "用户体验设计要围绕真实用户目标展开，并结合场景完成交互设计。",
    transcript_segments_json: JSON.stringify([
      { start: 0, end: 8, text: "用户体验设计要围绕真实用户目标展开。" },
      { start: 8, end: 16, text: "交互设计需要结合具体的使用场景。" },
      { start: 16, end: 24, text: "核心目标是让用户更快完成关键任务。" },
    ]),
    summary_markdown: null,
    mindmap_markdown: null,
    notes_markdown: null,
    fusion_prompt_markdown: null,
    stage_logs_json: JSON.stringify({ A: [], B: [], C: [], D: [] }),
    stage_metrics_json: JSON.stringify({
      A: { status: "completed" },
      B: { status: "completed" },
      C: { status: "completed" },
      D: {
        status: "completed",
        substage_metrics: {
          transcript_optimize: { status: "completed", optional: true },
          fusion_delivery: { status: "completed", optional: false },
        },
      },
    }),
    artifact_index_json: "[]",
    artifact_total_bytes: 0,
    created_at: "2026-04-15T07:00:00.000Z",
    updated_at: "2026-04-15T08:00:00.000Z",
  }

  await writeFile(path.join(recordsDir, "task-vqa-1.json"), `${JSON.stringify(record)}\n`, "utf8")

  const frameManifest = {
    task_id: "task-vqa-1",
    source_video_path: sourcePath,
    interval_seconds: 2,
    frame_count: 1,
    created_at: "2026-04-15T08:00:00.000Z",
    frames: [
      {
        frame_index: 0,
        timestamp_seconds: 0,
        path: "frames/frame-000001.jpg",
      },
    ],
  }
  await writeFile(path.join(frameDir, "manifest.json"), `${JSON.stringify(frameManifest, null, 2)}\n`, "utf8")
  await writeFile(path.join(frameDir, "frame-000001.jpg"), "fixture-frame", "utf8")
}
