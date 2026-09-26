import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { TaskRecord } from "@vidgnost/contracts"

import { resolveConfig } from "../src/core/config.js"
import { TaskStore } from "../src/store/task-store.js"

async function createStore() {
  const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-store-"))
  return { storageDir, store: new TaskStore({ ...resolveConfig({}), storageDir }) }
}

function task(id: string): TaskRecord {
  const now = new Date().toISOString()
  return {
    id,
    title: "任务",
    status: "succeeded",
    createdAt: now,
    updatedAt: now,
    source: {
      kind: "local_path",
      uri: "/tmp/a.mp4",
      platform: "local",
      title: "任务",
      mediaPath: "/tmp/a.mp4",
      audioOnly: false,
      durationSeconds: 10,
      sizeBytes: 1,
      fingerprint: `${id}-fp`,
      createdAt: now,
    },
    options: { language: "zh", preset: "balanced", asr: "auto", vision: false, proofread: false, translateTo: null },
    stages: [],
    artifacts: [],
    stats: { segments: 3, paragraphs: 1, chapters: 1, chunks: 1, frames: 0, knowledgeNodes: 2, tokens: {}, modelCalls: 0 },
    readiness: 1,
  }
}

describe("TaskStore", () => {
  it("round-trips a task record", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    await store.write(task("vg_a"))
    const loaded = await store.read("vg_a")
    expect(loaded?.title).toBe("任务")
  })

  it("returns null for a missing task", async () => {
    const { store } = await createStore()
    expect(await store.read("vg_missing")).toBeNull()
  })

  it("throws a not-found AppError when requiring a missing task", async () => {
    const { store } = await createStore()
    await expect(store.requireTask("vg_missing")).rejects.toMatchObject({ code: "TASK_NOT_FOUND" })
  })

  it("lists tasks in reverse chronological order", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_old")
    await store.write({ ...task("vg_old"), createdAt: "2026-01-01T00:00:00.000Z" })
    await store.ensureTaskDir("vg_new")
    await store.write({ ...task("vg_new"), createdAt: "2026-06-01T00:00:00.000Z" })
    const list = await store.list()
    expect(list.map((item) => item.id)).toEqual(["vg_new", "vg_old"])
  })

  it("appends and reads events with a limit", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    for (let index = 0; index < 12; index += 1) {
      await store.appendEvent("vg_a", {
        type: "log",
        taskId: "vg_a",
        level: "info",
        message: `msg-${index}`,
        at: new Date().toISOString(),
      })
    }
    const events = await store.readEvents("vg_a", 5)
    expect(events).toHaveLength(5)
    expect((events[4] as { message: string }).message).toBe("msg-11")
  })

  it("round-trips stage checkpoints", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    await store.writeCheckpoint("vg_a", "transcribe", { key: "abc", message: "ok" })
    const checkpoint = await store.readCheckpoint<{ key: string; stage: string }>("vg_a", "transcribe")
    expect(checkpoint?.key).toBe("abc")
    expect(checkpoint?.stage).toBe("transcribe")
    await store.clearCheckpoint("vg_a", "transcribe")
    expect(await store.readCheckpoint("vg_a", "transcribe")).toBeNull()
  })

  it("refreshes artifacts from disk", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    await store.writeArtifactText("vg_a", "report", "# 报告\n")
    const artifacts = await store.refreshArtifacts(task("vg_a"), ["report"])
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ key: "report", label: "Markdown 报告", exportable: true })
  })

  it("reads JSON artifacts as objects and text artifacts as strings", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    await store.writeArtifactJson("vg_a", "summary", { tldr: "x" })
    await store.writeArtifactText("vg_a", "report", "# 标题\n")
    const summary = await store.readArtifact("vg_a", "summary")
    const report = await store.readArtifact("vg_a", "report")
    expect(summary.json).toEqual({ tldr: "x" })
    expect(summary.text).toBeNull()
    expect(report.text).toBe("# 标题\n")
    expect(report.json).toBeNull()
  })

  it("rejects unknown artifact keys", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    await expect(store.readArtifact("vg_a", "nope")).rejects.toMatchObject({ code: "ARTIFACT_UNKNOWN" })
  })

  it("reports missing artifacts clearly", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    await expect(store.readArtifact("vg_a", "summary")).rejects.toMatchObject({ code: "ARTIFACT_NOT_READY" })
  })

  it("projects a summary with readiness and engine", async () => {
    const { store } = await createStore()
    await store.ensureTaskDir("vg_a")
    const record = { ...task("vg_a"), stats: { ...task("vg_a").stats, transcriptEngine: "dashscope-filetrans" as const }, artifacts: [{ key: "transcript", label: "转写稿", path: "transcript.json", exportable: true, bytes: 10, updatedAt: "now" }] }
    const summary = store.toSummary(record, { tldr: "概览", tags: ["A"] })
    expect(summary.hasTranscript).toBe(true)
    expect(summary.hasMindMap).toBe(false)
    expect(summary.engine).toBe("dashscope-filetrans")
    expect(summary.tldr).toBe("概览")
  })

  it("tolerates a corrupt event line", async () => {
    const { store, storageDir } = await createStore()
    await store.ensureTaskDir("vg_a")
    await store.appendEvent("vg_a", { type: "log", taskId: "vg_a", level: "info", message: "ok", at: "now" })
    await writeFile(path.join(storageDir, "tasks", "vg_a", "events.ndjson"), "not json\n", { flag: "a" })
    const events = await store.readEvents("vg_a")
    expect(events).toHaveLength(1)
  })
})
