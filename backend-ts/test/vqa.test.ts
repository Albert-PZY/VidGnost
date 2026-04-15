import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { vqaTraceResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("vqa routes", () => {
  let app: FastifyInstance
  let baseUrl = ""
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-backend-ts-vqa-"))
    await seedVqaFixture(storageDir)
    app = await buildApp({
      apiPrefix: "/api",
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
      dense_hits: Array<{ task_id: string }>
      rerank_hits: Array<{ text: string }>
      trace_id: string
    }>()
    expect(searchPayload.trace_id).toBeTruthy()
    expect(searchPayload.dense_hits[0]?.task_id).toBe("task-vqa-1")
    expect(searchPayload.rerank_hits.length).toBeGreaterThan(0)

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

    const traceId = searchPayload.trace_id
    const traceResponse = await app.inject({
      method: "GET",
      url: `/api/traces/${traceId}`,
    })

    expect(traceResponse.statusCode).toBe(200)
    const tracePayload = vqaTraceResponseSchema.parse(traceResponse.json())
    expect(tracePayload.trace_id).toBe(traceId)
    expect(tracePayload.records.some((item) => item.stage === "trace_started")).toBe(true)
    expect(tracePayload.records.some((item) => item.stage === "retrieval")).toBe(true)
    expect(tracePayload.records.some((item) => item.stage === "trace_finished")).toBe(true)
  })
})

async function seedVqaFixture(storageDir: string): Promise<void> {
  const recordsDir = path.join(storageDir, "tasks", "records")
  const uploadsDir = path.join(storageDir, "uploads")
  await mkdir(recordsDir, { recursive: true })
  await mkdir(uploadsDir, { recursive: true })

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
}
