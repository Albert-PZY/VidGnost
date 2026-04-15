import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { taskCreateResponseSchema, taskDetailResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("task mutation routes", () => {
  let app: FastifyInstance
  let storageDir = ""
  let sourceVideoPath = ""
  let unmatchedVideoPath = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-write-"))
    const seeded = await seedMutationFixtures(storageDir)
    sourceVideoPath = seeded.sourceVideoPath
    unmatchedVideoPath = seeded.unmatchedVideoPath
    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
    })
  })

  afterAll(async () => {
    await app.close()
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

async function seedMutationFixtures(storageDir: string): Promise<{
  sourceVideoPath: string
  unmatchedVideoPath: string
}> {
  const recordsDir = path.join(storageDir, "tasks", "records")
  const uploadsDir = path.join(storageDir, "uploads")
  const fusionDir = path.join(storageDir, "tasks", "stage-artifacts", "task-seed", "D", "fusion")

  await mkdir(recordsDir, { recursive: true })
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(fusionDir, { recursive: true })

  const sourceVideoPath = path.join(uploadsDir, "seed-video.mp4")
  const unmatchedVideoPath = path.join(uploadsDir, "fresh-video.mp4")
  await writeFile(sourceVideoPath, Buffer.from("seed-video-bytes"))
  await writeFile(unmatchedVideoPath, Buffer.from("fresh-video-bytes"))

  await writeFile(path.join(fusionDir, "summary.md"), "## 复用摘要\n")
  await writeFile(path.join(fusionDir, "notes.md"), "## 复用笔记\n")
  await writeFile(path.join(fusionDir, "mindmap.md"), "# 复用导图\n")

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
  return {
    sourceVideoPath,
    unmatchedVideoPath,
  }
}
