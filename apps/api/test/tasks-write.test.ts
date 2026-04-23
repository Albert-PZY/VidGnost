import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { llmConfigResponseSchema, taskCreateResponseSchema, taskDetailResponseSchema, uiSettingsResponseSchema } from "@vidgnost/contracts"

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
      if (request.method === "GET" && request.url === "/v1/models") {
        response.writeHead(200, { "Content-Type": "application/json" })
        response.end(JSON.stringify({
          data: [{ id: "mock-notes" }],
        }))
        return
      }

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
        const promptText = String(prompt)
        const content = promptText.includes("SEGMENTS_JSON:")
          ? JSON.stringify(
              ((promptText.match(/SEGMENTS_JSON:\s*(\[[\s\S]*\])\s*$/)?.[1]
                ? JSON.parse(promptText.match(/SEGMENTS_JSON:\s*(\[[\s\S]*\])\s*$/)?.[1] || "[]")
                : []) as Array<{ id?: string; text?: string }>).map((segment) => ({
                id: segment.id || "",
                translated_text: `EN:${segment.text || ""}`,
              })),
            )
          : promptText.includes("导图")
            ? "# Mock 思维导图\n"
            : "## Mock 笔记\n"

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
      await removeDirectoryWithRetry(storageDir)
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
  }, 20_000)

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
    const detail = await waitForTaskDetail(
      app,
      created.task_id,
      (taskDetail) =>
        taskDetail.status === "completed" &&
        (taskDetail.notes_markdown || "").includes("Mock 笔记") &&
        !(taskDetail.notes_markdown || "").includes("当前为回退生成结果"),
      {
        description: "task completion with regenerated llm notes",
        timeoutMs: 20_000,
      },
    )

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
  }, 30_000)

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

  it("exports study artifacts through direct task export routes", async () => {
    const llmConfigResponse = await app.inject({
      method: "GET",
      url: "/api/config/llm",
    })
    expect(llmConfigResponse.statusCode).toBe(200)
    const llmConfig = llmConfigResponseSchema.parse(llmConfigResponse.json())

    const saveLlmConfigResponse = await app.inject({
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
    expect(saveLlmConfigResponse.statusCode).toBe(200)

    const uiConfigResponse = await app.inject({
      method: "GET",
      url: "/api/config/ui",
    })
    expect(uiConfigResponse.statusCode).toBe(200)
    const uiConfig = uiSettingsResponseSchema.parse(uiConfigResponse.json())

    const saveUiConfigResponse = await app.inject({
      method: "PUT",
      url: "/api/config/ui",
      payload: {
        ...uiConfig,
        study_default_translation_target: "en",
      },
    })
    expect(saveUiConfigResponse.statusCode).toBe(200)

    const noteResponse = await app.inject({
      method: "POST",
      url: "/api/knowledge/notes",
      payload: {
        excerpt: "seed knowledge note",
        note_markdown: "## seed knowledge note",
        source_kind: "manual",
        tags: ["seed"],
        task_id: "task-seed",
        title: "Seed Knowledge",
      },
    })
    expect(noteResponse.statusCode).toBe(200)

    const [studyPackResponse, subtitleTracksResponse, translationRecordsResponse, knowledgeNotesResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/tasks/task-seed/export/study_pack",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/task-seed/export/subtitle_tracks",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/task-seed/export/translation_records",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/task-seed/export/knowledge_notes",
      }),
    ])

    expect(studyPackResponse.statusCode).toBe(200)
    expect(studyPackResponse.headers["content-type"]).toContain("text/markdown")
    expect(studyPackResponse.body).toContain("## Highlights")

    expect(subtitleTracksResponse.statusCode).toBe(200)
    expect(subtitleTracksResponse.headers["content-type"]).toContain("application/json")
    expect(subtitleTracksResponse.body).toContain("\"kind\":")

    expect(translationRecordsResponse.statusCode).toBe(200)
    expect(translationRecordsResponse.headers["content-type"]).toContain("application/json")
    expect(translationRecordsResponse.body).toContain("\"source\": \"llm_generated\"")
    expect(translationRecordsResponse.body).toContain("\"language\": \"en\"")

    expect(knowledgeNotesResponse.statusCode).toBe(200)
    expect(knowledgeNotesResponse.headers["content-type"]).toContain("text/markdown")
    expect(knowledgeNotesResponse.body).toContain("Seed Knowledge")
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
    const uiConfigResponse = await app.inject({
      method: "GET",
      url: "/api/config/ui",
    })
    const uiConfig = uiSettingsResponseSchema.parse(uiConfigResponse.json())

    const saveConfigResponse = await app.inject({
      method: "PUT",
      url: "/api/config/llm",
      payload: {
        ...llmConfig,
        correction_mode: "off",
      },
    })
    expect(saveConfigResponse.statusCode).toBe(200)
    const saveUiConfigResponse = await app.inject({
      method: "PUT",
      url: "/api/config/ui",
      payload: {
        ...uiConfig,
        study_default_translation_target: null,
      },
    })
    expect(saveUiConfigResponse.statusCode).toBe(200)

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
    const workspacePath = path.join(storageDir, "tasks", "stage-artifacts", "task-seed-rerun", "D", "study", "workspace.json")
    const studyPackPath = path.join(storageDir, "tasks", "stage-artifacts", "task-seed-rerun", "D", "study", "study-pack.json")
    const subtitleTracksPath = path.join(storageDir, "tasks", "stage-artifacts", "task-seed-rerun", "D", "study", "subtitle-tracks.json")
    const translationRecordsPath = path.join(storageDir, "tasks", "stage-artifacts", "task-seed-rerun", "D", "study", "translation-records.json")
    const previewPath = path.join(storageDir, "tasks", "stage-artifacts", "task-seed-rerun", "D", "study", "preview.json")
    const studySqlitePath = path.join(storageDir, "study", "study.sqlite")

    await waitForFile(correctionIndexPath)
    await waitForFile(correctionTextPath)
    await waitForFile(workspacePath)
    await waitForFile(studyPackPath)
    await waitForFile(subtitleTracksPath)
    await waitForFile(translationRecordsPath)
    await waitForFile(previewPath)
    await waitForFile(studySqlitePath)

    const detail = await waitForTaskStatus(app, "task-seed-rerun", "completed")

    const correctionIndex = JSON.parse(await readFile(correctionIndexPath, "utf8")) as {
      mode: string
      status: string
    }
    const correctionText = await readFile(correctionTextPath, "utf8")
    const subtitleTracks = JSON.parse(await readFile(subtitleTracksPath, "utf8")) as Array<{ kind?: string }>
    const translationRecords = JSON.parse(await readFile(translationRecordsPath, "utf8")) as Array<{
      source?: string
      status?: string
      target?: { language?: string } | null
    }>
    const workspace = JSON.parse(await readFile(workspacePath, "utf8")) as {
      preview?: { readiness?: string }
      study_pack?: { highlights?: unknown[] }
      translation_records?: Array<{ status?: string }>
    }
    const preview = JSON.parse(await readFile(previewPath, "utf8")) as { readiness?: string }
    const studyDatabase = new DatabaseSync(studySqlitePath)
    const persistedPackRow = studyDatabase
      .prepare("SELECT pack_json FROM study_packs WHERE task_id = ?")
      .get("task-seed-rerun") as { pack_json?: string } | undefined
    const persistedTrackRow = studyDatabase
      .prepare("SELECT tracks_json FROM subtitle_tracks WHERE task_id = ?")
      .get("task-seed-rerun") as { tracks_json?: string } | undefined
    const persistedTranslationRow = studyDatabase
      .prepare("SELECT records_json FROM translation_records WHERE task_id = ?")
      .get("task-seed-rerun") as { records_json?: string } | undefined
    studyDatabase.close()

    expect(correctionIndex).toMatchObject({
      mode: "off",
      status: "skipped",
    })
    expect(correctionText).toContain("seed transcript")
    expect(subtitleTracks.some((track) => track.kind === "whisper")).toBe(true)
    expect(translationRecords).toEqual([
      expect.objectContaining({
        source: "disabled",
        status: "disabled",
        target: null,
      }),
    ])
    expect(workspace.preview?.readiness).toBe("ready")
    expect(workspace.study_pack?.highlights?.length).toBeGreaterThan(0)
    expect(workspace.translation_records?.[0]?.status).toBe("disabled")
    expect(preview.readiness).toBe("ready")
    expect(persistedPackRow?.pack_json).toBeTruthy()
    expect(persistedTrackRow?.tracks_json).toContain("\"kind\":\"whisper\"")
    expect(persistedTranslationRow?.records_json).toContain("\"status\":\"disabled\"")
    expect(detail.stage_metrics.D).toMatchObject({
      status: "completed",
      substage_metrics: {
        subtitle_resolve: { status: "completed" },
        translation_resolve: { status: "completed" },
        study_pack_generate: { status: "completed" },
      },
    })
    expect(detail.vm_phase_metrics.D).toMatchObject({
      status: "completed",
    })
    expect(detail.study_preview).toMatchObject({
      readiness: "ready",
      generation_tier: "heuristic",
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
    const transcriptOnlyIndexPath = path.join(
      storageDir,
      "tasks",
      "stage-artifacts",
      "task-vqa-rerun",
      "D",
      "vqa-prewarm",
      "transcript-only",
      "index.json",
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
    const frameSemanticPath = path.join(
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
    await waitForFile(transcriptOnlyIndexPath)

    const prewarmIndex = JSON.parse(await readFile(prewarmIndexPath, "utf8")) as {
      item_count: number
      mode: string
      retrieval_mode: string
      items?: Array<{ source?: string; source_set?: string[] }>
    }
    const transcriptOnlyIndex = JSON.parse(await readFile(transcriptOnlyIndexPath, "utf8")) as {
      artifact_paths: string[]
      mode: string
      task_id: string
    }
    expect(prewarmIndex.mode).toBe("transcript-only")
    expect(prewarmIndex.retrieval_mode).toBe("vector-index")
    expect(prewarmIndex.item_count).toBeGreaterThan(0)
    expect(transcriptOnlyIndex).toMatchObject({
      mode: "transcript-only",
      task_id: "task-vqa-rerun",
    })
    expect(transcriptOnlyIndex.artifact_paths).toContain("D/vqa-prewarm/index.json")
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
    expect(sourceSet.has("frame_semantic")).toBe(false)
    await expectPathMissing(frameManifestPath)
    await expectPathMissing(frameSemanticPath)

    const detail = await waitForTaskStatus(app, "task-vqa-rerun", "completed")
    expect(detail.steps.map((step) => step.id)).toEqual(["extract", "transcribe", "correct", "ready"])
    expect(detail.stage_metrics.D).toMatchObject({
      substage_metrics: {
        vqa_prewarm: {
          status: "completed",
        },
      },
    })
    expect(detail.vm_phase_metrics.vqa_prewarm).toMatchObject({
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
    await waitForFileContaining(eventLogPath, "\"type\":\"task_cancelled\"")
    const eventLog = await readFile(eventLogPath, "utf8")
    expect(eventLog).toContain("task_cancelled")
  }, 20_000)

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

type TaskDetail = ReturnType<typeof taskDetailResponseSchema.parse>

async function waitForTaskDetail(
  app: FastifyInstance,
  taskId: string,
  predicate: (detail: TaskDetail) => boolean,
  options: {
    description: string
    intervalMs?: number
    timeoutMs?: number
  },
): Promise<TaskDetail> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const intervalMs = options.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  let lastDetail: TaskDetail | null = null

  while (Date.now() < deadline) {
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
    })
    const detail = taskDetailResponseSchema.parse(detailResponse.json())
    lastDetail = detail
    if (predicate(detail)) {
      return detail
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(
    `Task ${taskId} did not satisfy ${options.description}. Last status: ${lastDetail?.status ?? "unknown"}, ` +
      `last step: ${lastDetail?.current_step_id ?? "unknown"}, ` +
      `error: ${lastDetail?.error_message ?? "none"}`,
  )
}

async function waitForTaskStatus(
  app: FastifyInstance,
  taskId: string,
  status: "completed" | "cancelled" | "failed",
  options?: {
    intervalMs?: number
    timeoutMs?: number
  },
): Promise<TaskDetail> {
  return waitForTaskDetail(app, taskId, (detail) => detail.status === status, {
    description: `status ${status}`,
    intervalMs: options?.intervalMs,
    timeoutMs: options?.timeoutMs,
  })
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

async function waitForFileContaining(targetPath: string, expectedText: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const content = await readFile(targetPath, "utf8")
      if (content.includes(expectedText)) {
        return
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`File content was not written in time: ${targetPath}`)
}

async function expectPathMissing(targetPath: string): Promise<void> {
  await expect(async () => stat(targetPath)).rejects.toThrow()
}

async function removeDirectoryWithRetry(targetPath: string, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        process.platform === "win32" &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EBUSY"
      ) {
        if (index === attempts - 1) {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      if (index === attempts - 1) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
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
