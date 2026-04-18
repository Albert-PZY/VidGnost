import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { llmConfigResponseSchema, taskCreateResponseSchema, taskDetailResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("task mutation routes", () => {
  let app: FastifyInstance
  let baseUrl = ""
  let llmBaseUrl = ""
  let llmServer: ReturnType<typeof createServer>
  let storageDir = ""
  let sourceVideoPath = ""
  let fallbackSourceVideoPath = ""
  let unmatchedVideoPath = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-write-"))
    const seeded = await seedMutationFixtures(storageDir)
    sourceVideoPath = seeded.sourceVideoPath
    fallbackSourceVideoPath = seeded.fallbackSourceVideoPath
    unmatchedVideoPath = seeded.unmatchedVideoPath
    llmServer = createServer((request, response) => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ error: { message: "not found" } }))
        return
      }

      const chunks: Buffer[] = []
      request.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      request.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          messages?: Array<{ content?: string }>
        }
        const prompt = payload.messages?.at(-1)?.content || ""
        const content = String(prompt).includes("导图") ? "# Mock 思维导图\n" : "## Mock 笔记\n"

        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          choices: [
            {
              message: {
                content,
              },
            },
          ],
        }))
      })
    })
    await new Promise<void>((resolve) => {
      llmServer.listen(0, "127.0.0.1", () => resolve())
    })
    llmBaseUrl = `http://127.0.0.1:${(llmServer.address() as AddressInfo).port}/v1`
    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
      llmBaseUrl,
    })
    baseUrl = await app.listen({
      host: "127.0.0.1",
      port: 0,
    })
  })

  afterAll(async () => {
    await app.close()
    await new Promise<void>((resolve, reject) => {
      llmServer.close((error) => (error ? reject(error) : resolve()))
    })
    if (storageDir) {
      await rm(storageDir, { force: true, recursive: true })
    }
  })

  it("creates a path task and reuses compatible completed artifacts", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/path",
      payload: {
        local_path: sourceVideoPath,
        workflow: "notes",
        language: "zh",
        model_size: "small",
      },
    })

    expect(createResponse.statusCode).toBe(200)
    const created = taskCreateResponseSchema.parse(createResponse.json())
    expect(created.workflow).toBe("notes")

    const detail = await waitForTaskStatus(app, created.task_id, "completed")
    expect(detail).toMatchObject({
      status: "completed",
      workflow: "notes",
    })
    expect(detail.notes_markdown).toContain("复用笔记")

    const exportResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${created.task_id}/export/notes`,
    })
    expect(exportResponse.statusCode).toBe(200)
    expect(exportResponse.headers["content-type"]).toContain("text/markdown")
  })

  it("reruns stage d instead of replaying fallback fusion artifacts when llm is available", async () => {
    const llmConfigResponse = await app.inject({
      method: "GET",
      url: "/api/config/llm",
    })
    const llmConfig = llmConfigResponseSchema.parse(llmConfigResponse.json())

    const saveConfigResponse = await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      payload: {
        ...llmConfig,
        api_key: "ollama",
        base_url: llmBaseUrl,
        model: "mock-notes",
        correction_mode: "off",
      },
    })
    expect(saveConfigResponse.statusCode).toBe(200)

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/path",
      payload: {
        local_path: fallbackSourceVideoPath,
        workflow: "notes",
        language: "zh",
        model_size: "small",
      },
    })

    expect(createResponse.statusCode).toBe(200)
    const created = taskCreateResponseSchema.parse(createResponse.json())
    const detail = await waitForTaskStatus(app, created.task_id, "completed")

    expect(detail.notes_markdown).toContain("Mock 笔记")
    expect(detail.notes_markdown).not.toContain("当前为回退生成结果")

    const manifestPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      created.task_id,
      "D",
      "fusion",
      "manifest.json",
    )
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      notes: { generated_by: string }
    }
    expect(manifest.notes.generated_by).toBe("llm")
  })

  it("serves task event streams with loopback cors headers", async () => {
    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/api/tasks/task-seed/events`, {
      headers: {
        Accept: "text/event-stream",
        Origin: "http://127.0.0.1:16221",
      },
      signal: controller.signal,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type") || "").toContain("text/event-stream")
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:16221")

    controller.abort()
  })

  it("updates task artifacts, exports bundle and deletes terminal task", async () => {
    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/api/tasks/task-seed/artifacts",
      payload: {
        notes_markdown: "## 更新后的笔记",
      },
    })

    expect(patchResponse.statusCode).toBe(200)
    const patched = taskDetailResponseSchema.parse(patchResponse.json())
    expect(patched.notes_markdown).toContain("更新后的笔记")

    const bundleResponse = await app.inject({
      method: "GET",
      url: "/api/tasks/task-seed/export/bundle",
    })
    expect(bundleResponse.statusCode).toBe(200)
    expect(bundleResponse.headers["content-type"]).toContain("application/zip")

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/tasks/task-seed",
    })
    expect(deleteResponse.statusCode).toBe(204)

    const missingResponse = await app.inject({
      method: "GET",
      url: "/api/tasks/task-seed",
    })
    expect(missingResponse.statusCode).toBe(404)
  })

  it("reruns stage d and persists transcript correction artifacts", async () => {
    const llmConfigResponse = await app.inject({
      method: "GET",
      url: "/api/config/llm",
    })
    const llmConfig = llmConfigResponseSchema.parse(llmConfigResponse.json())

    const saveConfigResponse = await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      payload: {
        ...llmConfig,
        correction_mode: "off",
      },
    })
    expect(saveConfigResponse.statusCode).toBe(200)

    const rerunResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/task-seed-rerun/rerun-stage-d",
      payload: {},
    })
    expect(rerunResponse.statusCode).toBe(200)

    const correctionIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-seed-rerun",
      "D",
      "transcript-optimize",
      "index.json",
    )
    const correctionTextPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-seed-rerun",
      "D",
      "transcript-optimize",
      "full.txt",
    )

    await waitForFile(correctionIndexPath)
    await waitForFile(correctionTextPath)

    const detail = await waitForTaskStatus(app, "task-seed-rerun", "completed")

    const correctionIndex = JSON.parse(await readFile(correctionIndexPath, "utf8")) as {
      mode: string
      status: string
    }
    const correctionText = await readFile(correctionTextPath, "utf8")

    expect(correctionIndex).toMatchObject({
      mode: "off",
      status: "skipped",
    })
    expect(correctionText).toContain("seed transcript")
    expect(detail.stage_metrics.D).toMatchObject({
      status: "completed",
    })
    expect(detail.vm_phase_metrics.D).toMatchObject({
      status: "completed",
    })
  }, 20_000)

  it("prewarms vqa retrieval index during stage d rerun for vqa tasks", async () => {
    const rerunResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/task-vqa-rerun/rerun-stage-d",
      payload: {},
    })
    expect(rerunResponse.statusCode).toBe(200)

    const prewarmIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-rerun",
      "D",
      "vqa-prewarm",
      "index.json",
    )
    const multimodalIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-rerun",
      "D",
      "vqa-prewarm",
      "multimodal",
      "index.json",
    )
    const multimodalManifestPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-rerun",
      "D",
      "vqa-prewarm",
      "multimodal",
      "manifest.json",
    )
    const frameManifestPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-rerun",
      "D",
      "vqa-prewarm",
      "frames",
      "manifest.json",
    )
    const frameSemanticIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-rerun",
      "D",
      "vqa-prewarm",
      "frame-semantic",
      "index.json",
    )

    await waitForFile(prewarmIndexPath)
    await waitForFile(multimodalIndexPath)
    await waitForFile(multimodalManifestPath)
    await waitForFile(frameManifestPath)
    await waitForFile(frameSemanticIndexPath)

    const prewarmIndex = JSON.parse(await readFile(prewarmIndexPath, "utf8")) as {
      item_count: number
      retrieval_mode: string
      items?: Array<{ source?: string; source_set?: string[] }>
    }
    const multimodalIndex = JSON.parse(await readFile(multimodalIndexPath, "utf8")) as {
      mode: string
      entries: Array<{ artifact_path?: string; kind?: string; modality?: string }>
      task_id: string
    }
    const multimodalManifest = JSON.parse(await readFile(multimodalManifestPath, "utf8")) as {
      mode: string
      artifact_paths: string[]
    }
    const frameManifest = JSON.parse(await readFile(frameManifestPath, "utf8")) as {
      task_id: string
      frames: Array<{ path?: string }>
      frame_count: number
    }
    const frameSemanticIndex = JSON.parse(await readFile(frameSemanticIndexPath, "utf8")) as {
      task_id: string
      item_count: number
      items: Array<{ image_path?: string; visual_text?: string }>
    }
    expect(prewarmIndex.retrieval_mode).toBe("vector-index")
    expect(prewarmIndex.item_count).toBeGreaterThan(0)
    expect(multimodalIndex.task_id).toBe("task-vqa-rerun")
    expect(multimodalIndex.mode).toBe("multimodal")
    expect(Array.isArray(multimodalIndex.entries)).toBe(true)
    expect(multimodalIndex.entries.some((entry) => entry.kind === "frame_semantic")).toBe(true)
    expect(multimodalManifest.mode).toBe("multimodal")
    expect(multimodalManifest.artifact_paths).toContain("D/vqa-prewarm/index.json")
    expect(multimodalManifest.artifact_paths).toContain("D/vqa-prewarm/frame-semantic/index.json")
    expect(frameManifest.task_id).toBe("task-vqa-rerun")
    expect(frameManifest.frame_count).toBeGreaterThan(0)
    expect(frameManifest.frames[0]?.path).toMatch(/^frames\//)
    expect(frameSemanticIndex.task_id).toBe("task-vqa-rerun")
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

    const detail = await waitForTaskStatus(app, "task-vqa-rerun", "completed")
    expect(detail.steps.map((step) => step.id)).toEqual(["extract", "transcribe", "correct", "ready"])
    expect(detail.stage_metrics.D).toMatchObject({
      substage_metrics: {
        multimodal_prewarm: {
          status: "completed",
        },
      },
    })
    expect(detail.vm_phase_metrics.multimodal_prewarm).toMatchObject({
      status: "completed",
    })
  }, 20_000)

  it("cancels an active task before fallback failure completes", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/path",
      payload: {
        local_path: unmatchedVideoPath,
        workflow: "notes",
        language: "zh",
        model_size: "small",
      },
    })

    const created = taskCreateResponseSchema.parse(createResponse.json())
    await new Promise((resolve) => setTimeout(resolve, 60))

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/tasks/${created.task_id}/cancel`,
      payload: {},
    })
    expect(cancelResponse.statusCode).toBe(200)

    const detail = await waitForTaskStatus(app, created.task_id, "cancelled")
    expect(detail.status).toBe("cancelled")

    const eventLogPath = path.join(storageDir, "event-logs", `${created.task_id}.jsonl`)
    const eventLog = await readFile(eventLogPath, "utf8")
    expect(eventLog).toContain("task_cancelled")
  })

  it("deletes a running task and removes task-owned temp, artifact, upload, and trace files", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/path",
      payload: {
        local_path: unmatchedVideoPath,
        workflow: "vqa",
        language: "zh",
        model_size: "small",
      },
    })

    expect(createResponse.statusCode).toBe(200)
    const created = taskCreateResponseSchema.parse(createResponse.json())
    await new Promise((resolve) => setTimeout(resolve, 60))

    const recordPath = path.join(storageDir, "tasks", "records", `${created.task_id}.json`)
    const stageArtifactsDir = path.join(storageDir, "tasks", "stage-artifacts", created.task_id)
    const analysisResultDir = path.join(storageDir, "tasks", "analysis-results", created.task_id)
    const runtimeWarningPath = path.join(storageDir, "tasks", "runtime-warnings", `${created.task_id}.jsonl`)
    const stageMetricPath = path.join(storageDir, "tasks", "stage-metrics", `${created.task_id}.json`)
    const eventLogPath = path.join(storageDir, "event-logs", `${created.task_id}.jsonl`)
    const tracePath = path.join(storageDir, "event-logs", "traces", `trace-${created.task_id}.jsonl`)
    const uploadShadowPath = path.join(storageDir, "uploads", `${created.task_id}_shadow.mp4`)
    const remoteDownloadDir = path.join(storageDir, "uploads", `${created.task_id}-remote`)
    const taskTempDir = path.join(storageDir, "tmp", created.task_id)

    await mkdir(path.join(stageArtifactsDir, "D", "vqa-prewarm"), { recursive: true })
    await mkdir(analysisResultDir, { recursive: true })
    await mkdir(path.join(storageDir, "tasks", "runtime-warnings"), { recursive: true })
    await mkdir(path.join(storageDir, "tasks", "stage-metrics"), { recursive: true })
    await mkdir(path.join(storageDir, "event-logs", "traces"), { recursive: true })
    await mkdir(path.join(remoteDownloadDir), { recursive: true })
    await mkdir(path.join(taskTempDir, "whisper-output"), { recursive: true })

    await writeFile(path.join(stageArtifactsDir, "D", "vqa-prewarm", "index.json"), "{\"item_count\":1}\n", "utf8")
    await writeFile(path.join(analysisResultDir, "A.json"), "{\"stage\":\"A\"}\n", "utf8")
    await writeFile(runtimeWarningPath, "{\"warning\":true}\n", "utf8")
    await writeFile(stageMetricPath, "{\"stage\":\"A\"}\n", "utf8")
    await writeFile(eventLogPath, "{\"type\":\"progress\"}\n", "utf8")
    await writeFile(
      tracePath,
      `${JSON.stringify({
        trace_id: `trace-${created.task_id}`,
        stage: "trace_started",
        ts: new Date().toISOString(),
        payload: {
          metadata: {
            task_id: created.task_id,
          },
        },
      })}\n`,
      "utf8",
    )
    await writeFile(uploadShadowPath, "shadow", "utf8")
    await writeFile(path.join(remoteDownloadDir, "source.mp4"), "remote", "utf8")
    await writeFile(path.join(taskTempDir, "whisper-output", "log.txt"), "temp", "utf8")

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/tasks/${created.task_id}`,
    })
    expect(deleteResponse.statusCode).toBe(204)

    const missingResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${created.task_id}`,
    })
    expect(missingResponse.statusCode).toBe(404)

    await expectPathMissing(recordPath)
    await expectPathMissing(stageArtifactsDir)
    await expectPathMissing(analysisResultDir)
    await expectPathMissing(runtimeWarningPath)
    await expectPathMissing(stageMetricPath)
    await expectPathMissing(eventLogPath)
    await expectPathMissing(tracePath)
    await expectPathMissing(uploadShadowPath)
    await expectPathMissing(remoteDownloadDir)
    await expectPathMissing(taskTempDir)
  })
})

async function waitForTaskStatus(
  app: FastifyInstance,
  taskId: string,
  status: "completed" | "cancelled" | "failed",
): Promise<ReturnType<typeof taskDetailResponseSchema.parse>> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
    })
    const detail = taskDetailResponseSchema.parse(detailResponse.json())
    if (detail.status === status) {
      return detail
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Task ${taskId} did not reach ${status}`)
}

async function waitForFile(targetPath: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      await readFile(targetPath, "utf8")
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`File was not written in time: ${targetPath}`)
}

async function expectPathMissing(targetPath: string): Promise<void> {
  await expect(async () => stat(targetPath)).rejects.toThrow()
}

async function seedMutationFixtures(storageDir: string): Promise<{
  fallbackSourceVideoPath: string
  sourceVideoPath: string
  unmatchedVideoPath: string
}> {
  const recordsDir = path.join(storageDir, "tasks", "records")
  const uploadsDir = path.join(storageDir, "uploads")
  const fusionDir = path.join(storageDir, "tasks", "stage-artifacts", "task-seed", "D", "fusion")
  const fallbackFusionDir = path.join(storageDir, "tasks", "stage-artifacts", "task-seed-fallback", "D", "fusion")

  await mkdir(recordsDir, { recursive: true })
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(fusionDir, { recursive: true })
  await mkdir(fallbackFusionDir, { recursive: true })

  const sourceVideoPath = path.join(uploadsDir, "seed-video.mp4")
  const fallbackSourceVideoPath = path.join(uploadsDir, "fallback-video.mp4")
  const unmatchedVideoPath = path.join(uploadsDir, "fresh-video.mp4")
  const sourceVideoBytes = Buffer.from("seed-video-bytes")
  const fallbackVideoBytes = Buffer.from("fallback-video-bytes")
  const unmatchedVideoBytes = Buffer.from("fresh-video-bytes")
  await writeFile(sourceVideoPath, sourceVideoBytes)
  await writeFile(fallbackSourceVideoPath, fallbackVideoBytes)
  await writeFile(unmatchedVideoPath, unmatchedVideoBytes)

  await writeFile(path.join(fusionDir, "summary.md"), "## 复用摘要\n")
  await writeFile(path.join(fusionDir, "notes.md"), "## 复用笔记\n")
  await writeFile(path.join(fusionDir, "mindmap.md"), "# 复用导图\n")
  await writeFile(path.join(fusionDir, "manifest.json"), JSON.stringify({
    notes: { generated_by: "llm", fallback_reason: "", content: "" },
    mindmap: { generated_by: "llm", fallback_reason: "", content: "" },
    summary: { generated_by: "llm", fallback_reason: "", content: "" },
  }, null, 2))

  await writeFile(path.join(fallbackFusionDir, "summary.md"), "> 当前为回退生成结果：llm_disabled_or_unconfigured\n\n## 回退摘要\n")
  await writeFile(path.join(fallbackFusionDir, "notes.md"), "> 当前为回退生成结果：llm_disabled_or_unconfigured\n\n## 回退笔记\n")
  await writeFile(path.join(fallbackFusionDir, "mindmap.md"), "> 当前为回退生成结果：llm_disabled_or_unconfigured\n\n# 回退导图\n")
  await writeFile(path.join(fallbackFusionDir, "manifest.json"), JSON.stringify({
    notes: { generated_by: "fallback", fallback_reason: "llm_disabled_or_unconfigured", content: "" },
    mindmap: { generated_by: "fallback", fallback_reason: "llm_disabled_or_unconfigured", content: "" },
    summary: { generated_by: "fallback", fallback_reason: "llm_disabled_or_unconfigured", content: "" },
  }, null, 2))

  const completedRecord = {
    id: "task-seed",
    source_type: "local_path",
    source_input: sourceVideoPath,
    source_local_path: sourceVideoPath,
    workflow: "notes",
    title: "Seed Task",
    duration_seconds: 12.5,
    language: "zh",
    model_size: "small",
    file_size_bytes: 16,
    status: "completed",
    progress: 100,
    transcript_text: "seed transcript",
    transcript_segments_json: JSON.stringify([{ start: 0, end: 1, text: "seed transcript" }]),
    summary_markdown: "## 复用摘要\n",
    notes_markdown: "## 复用笔记\n",
    mindmap_markdown: "# 复用导图\n",
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
    artifact_index_json: JSON.stringify([{ key: "notes_markdown" }]),
    artifact_total_bytes: 10,
    created_at: "2026-04-15T07:00:00.000Z",
    updated_at: "2026-04-15T07:30:00.000Z",
  }

  await writeFile(path.join(recordsDir, "task-seed.json"), `${JSON.stringify(completedRecord)}\n`, "utf8")
  await writeFile(
    path.join(recordsDir, "task-seed-fallback.json"),
    `${JSON.stringify({
      ...completedRecord,
      id: "task-seed-fallback",
      source_input: fallbackSourceVideoPath,
      source_local_path: fallbackSourceVideoPath,
      title: "Seed Fallback Task",
      file_size_bytes: fallbackVideoBytes.length,
      summary_markdown: "> 当前为回退生成结果：llm_disabled_or_unconfigured\n\n## 回退摘要\n",
      notes_markdown: "> 当前为回退生成结果：llm_disabled_or_unconfigured\n\n## 回退笔记\n",
      mindmap_markdown: "> 当前为回退生成结果：llm_disabled_or_unconfigured\n\n# 回退导图\n",
      updated_at: "2026-04-15T07:30:30.000Z",
    })}\n`,
    "utf8",
  )
  await writeFile(
    path.join(recordsDir, "task-seed-rerun.json"),
    `${JSON.stringify({
      ...completedRecord,
      id: "task-seed-rerun",
      title: "Seed Rerun Task",
      updated_at: "2026-04-15T07:31:00.000Z",
    })}\n`,
    "utf8",
  )
  await writeFile(
    path.join(recordsDir, "task-vqa-rerun.json"),
    `${JSON.stringify({
      ...completedRecord,
      id: "task-vqa-rerun",
      workflow: "vqa",
      title: "Seed VQA Rerun Task",
      updated_at: "2026-04-15T07:32:00.000Z",
    })}\n`,
    "utf8",
  )
  return {
    fallbackSourceVideoPath,
    sourceVideoPath,
    unmatchedVideoPath,
  }
}
