import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import {
  taskDetailResponseSchema,
  taskListResponseSchema,
  taskRecentResponseSchema,
  taskStatsResponseSchema,
} from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("task read routes", () => {
  let app: FastifyInstance
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-backend-ts-tasks-"))
    await seedTaskFixtures(storageDir)
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

  it("lists task summaries and aggregate stats", async () => {
    const [listResponse, statsResponse, recentResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/tasks?workflow=notes&status=completed&limit=10&offset=0",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/stats",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/recent?limit=1",
      }),
    ])

    expect(listResponse.statusCode).toBe(200)
    expect(statsResponse.statusCode).toBe(200)
    expect(recentResponse.statusCode).toBe(200)

    const listPayload = taskListResponseSchema.parse(listResponse.json())
    const statsPayload = taskStatsResponseSchema.parse(statsResponse.json())
    const recentPayload = taskRecentResponseSchema.parse(recentResponse.json())

    expect(listPayload.total).toBe(1)
    expect(listPayload.items[0]).toMatchObject({
      id: "task-1",
      workflow: "notes",
      status: "completed",
    })
    expect(statsPayload).toMatchObject({
      total: 2,
      notes: 1,
      vqa: 1,
      completed: 1,
    })
    expect(recentPayload.items).toHaveLength(1)
    expect(recentPayload.items[0]?.id).toBe("task-1")
  })

  it("returns task detail and sanitizes missing markdown artifacts", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tasks/task-1",
    })

    expect(response.statusCode).toBe(200)
    const payload = taskDetailResponseSchema.parse(response.json())
    expect(payload).toMatchObject({
      id: "task-1",
      workflow: "notes",
      status: "completed",
      source_local_path: expect.stringContaining("task-1_fixture.mp4"),
      artifact_total_bytes: 1024,
    })
    expect(payload.notes_markdown).toContain("notes-images/existing.png")
    expect(payload.notes_markdown).not.toContain("notes-images/missing.png")
    expect(payload.summary_markdown).not.toContain("notes-images/missing.png")
    expect(payload.steps).toHaveLength(4)
    expect(payload.current_step_id).toBe("extract")
  })

  it("streams source media, resolves open location and serves task artifacts", async () => {
    const [mediaResponse, locationResponse, artifactResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/tasks/task-1/source-media",
        headers: {
          range: "bytes=0-3",
        },
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/task-1/open-location",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/task-1/artifacts/file?path=notes-images/existing.png",
      }),
    ])

    expect(mediaResponse.statusCode).toBe(206)
    expect(mediaResponse.headers["content-type"]).toBe("video/mp4")
    expect(mediaResponse.body.length).toBe(4)

    expect(locationResponse.statusCode).toBe(200)
    expect(locationResponse.json()).toMatchObject({
      task_id: "task-1",
      path: expect.stringContaining(path.join("uploads")),
    })

    expect(artifactResponse.statusCode).toBe(200)
    expect(artifactResponse.headers["content-type"]).toBe("image/png")
    expect(Buffer.from(artifactResponse.body, "utf8").length).toBeGreaterThan(0)
  })
})

async function seedTaskFixtures(storageDir: string): Promise<void> {
  const recordsDir = path.join(storageDir, "tasks", "records")
  const uploadsDir = path.join(storageDir, "uploads")
  const fusionDir = path.join(storageDir, "tasks", "stage-artifacts", "task-1", "D", "fusion")
  const notesImagesDir = path.join(fusionDir, "notes-images")

  await mkdir(recordsDir, { recursive: true })
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(notesImagesDir, { recursive: true })

  await writeFile(path.join(uploadsDir, "task-1_fixture.mp4"), Buffer.from("0123456789"), "utf8")
  await writeFile(path.join(notesImagesDir, "existing.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  const completedRecord = {
    id: "task-1",
    source_type: "local_file",
    source_input: "fixture-video.mp4",
    source_local_path: path.join(uploadsDir, "task-1_fixture.mp4"),
    workflow: "notes",
    title: "Fixture Notes Task",
    duration_seconds: 123.45,
    language: "zh",
    model_size: "small",
    file_size_bytes: 10,
    status: "completed",
    progress: 100,
    error_message: null,
    transcript_text: "hello world",
    transcript_segments_json: JSON.stringify([
      { start: 0, end: 12.5, text: "hello" },
      { start: 12.5, end: 33.1, text: "world" },
    ]),
    summary_markdown: "![missing](notes-images/missing.png)\nsummary body",
    mindmap_markdown: "# mindmap",
    notes_markdown: "![keep](notes-images/existing.png)\n![drop](notes-images/missing.png)",
    fusion_prompt_markdown: "prompt",
    stage_logs_json: JSON.stringify({
      A: ["a"],
      B: ["b"],
      C: ["c"],
      D: ["d"],
    }),
    stage_metrics_json: JSON.stringify({
      A: { status: "completed", elapsed_seconds: 1.2, started_at: "2026-04-15T07:00:00.000Z", completed_at: "2026-04-15T07:00:01.200Z" },
      B: { status: "completed", elapsed_seconds: 2.3, started_at: "2026-04-15T07:00:02.000Z", completed_at: "2026-04-15T07:00:04.300Z" },
      C: { status: "completed", elapsed_seconds: 3.4, started_at: "2026-04-15T07:00:05.000Z", completed_at: "2026-04-15T07:00:08.400Z" },
      D: {
        status: "completed",
        elapsed_seconds: 4.5,
        started_at: "2026-04-15T07:00:09.000Z",
        completed_at: "2026-04-15T07:00:13.500Z",
        substage_metrics: {
          transcript_optimize: { status: "completed", elapsed_seconds: 1.1, optional: true },
          fusion_delivery: { status: "completed", elapsed_seconds: 3.4, optional: false },
        },
      },
    }),
    artifact_index_json: JSON.stringify([{ key: "notes_markdown", logical_path: "db://task/task-1/notes.md" }]),
    artifact_total_bytes: 1024,
    created_at: "2026-04-15T07:00:00.000Z",
    updated_at: "2026-04-15T08:00:00.000Z",
  }

  const failedRecord = {
    id: "task-2",
    source_type: "bilibili",
    source_input: "https://example.com/video",
    workflow: "vqa",
    title: "Fixture VQA Task",
    language: "zh",
    model_size: "small",
    file_size_bytes: 2048,
    status: "failed",
    progress: 42,
    error_message: "boom",
    transcript_segments_json: JSON.stringify([{ start: 0, end: 9.9, text: "partial" }]),
    created_at: "2026-04-15T06:00:00.000Z",
    updated_at: "2026-04-15T06:30:00.000Z",
  }

  await writeFile(path.join(recordsDir, "task-1.json"), `${JSON.stringify(completedRecord)}\n`, "utf8")
  await writeFile(path.join(recordsDir, "task-2.json"), `${JSON.stringify(failedRecord)}\n`, "utf8")
}
