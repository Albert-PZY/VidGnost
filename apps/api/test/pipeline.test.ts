import { describe, expect, it } from "vitest"

import type { TaskEvent, TaskRecord } from "@vidgnost/contracts"

import { TaskEventBus } from "../src/pipeline/event-bus.js"
import { computeReadiness, initialStages, updateStage } from "../src/pipeline/stages.js"
import { mergeOptions } from "../src/pipeline/task-manager.js"

function baseTask(): TaskRecord {
  const now = new Date().toISOString()
  return {
    id: "vg_test",
    title: "测试任务",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    source: {
      kind: "local_path",
      uri: "/tmp/a.mp4",
      platform: "local",
      title: "测试任务",
      mediaPath: "/tmp/a.mp4",
      audioOnly: false,
      durationSeconds: 600,
      sizeBytes: 1024,
      fingerprint: "abc",
      createdAt: now,
    },
    options: { language: "zh", preset: "balanced", asr: "auto", vision: false, proofread: false, translateTo: null },
    stages: initialStages(),
    artifacts: [],
    stats: { segments: 0, paragraphs: 0, chapters: 0, chunks: 0, frames: 0, knowledgeNodes: 0, tokens: {}, modelCalls: 0 },
    readiness: 0,
  }
}

describe("stage definitions", () => {
  it("starts every stage as pending with zero progress", () => {
    const stages = initialStages()
    expect(stages).toHaveLength(10)
    expect(stages.every((stage) => stage.status === "pending" && stage.progress === 0)).toBe(true)
    expect(stages.map((stage) => stage.id)).toEqual([
      "ingest",
      "audio",
      "transcribe",
      "structure",
      "insight",
      "mindmap",
      "knowledge",
      "vision",
      "index",
      "finalize",
    ])
  })
})

describe("computeReadiness", () => {
  it("is zero when nothing has run", () => {
    expect(computeReadiness(initialStages())).toBe(0)
  })

  it("is one when every stage finished", () => {
    const stages = initialStages().map((stage) => ({ ...stage, status: "succeeded" as const, progress: 1 }))
    expect(computeReadiness(stages)).toBe(1)
  })

  it("counts skipped stages as done", () => {
    const stages = initialStages().map((stage) => ({ ...stage, status: "skipped" as const, progress: 1 }))
    expect(computeReadiness(stages)).toBe(1)
  })

  it("weights running stages by their progress", () => {
    const stages = initialStages().map((stage) =>
      stage.id === "transcribe" ? { ...stage, status: "running" as const, progress: 0.5 } : stage,
    )
    const readiness = computeReadiness(stages)
    expect(readiness).toBeGreaterThan(0)
    expect(readiness).toBeLessThan(0.2)
  })
})

describe("updateStage", () => {
  it("patches one stage and recomputes readiness", () => {
    const task = baseTask()
    const patched = updateStage(task, "ingest", { status: "succeeded", progress: 1 })
    expect(patched.stages.find((stage) => stage.id === "ingest")?.status).toBe("succeeded")
    expect(patched.stages.find((stage) => stage.id === "audio")?.status).toBe("pending")
    expect(patched.readiness).toBeGreaterThan(0)
    expect(task.stages.find((stage) => stage.id === "ingest")?.status).toBe("pending")
  })
})

describe("TaskEventBus", () => {
  const event: TaskEvent = {
    type: "log",
    taskId: "vg_test",
    level: "info",
    message: "hello",
    at: new Date().toISOString(),
  }

  it("delivers events to task subscribers", () => {
    const bus = new TaskEventBus()
    const received: TaskEvent[] = []
    const unsubscribe = bus.subscribe("vg_test", (item) => received.push(item))
    bus.publish(event)
    expect(received).toHaveLength(1)
    unsubscribe()
    bus.publish(event)
    expect(received).toHaveLength(1)
  })

  it("delivers events to global subscribers", () => {
    const bus = new TaskEventBus()
    const received: TaskEvent[] = []
    const unsubscribe = bus.subscribeAll((item) => received.push(item))
    bus.publish(event)
    expect(received).toHaveLength(1)
    unsubscribe()
    bus.publish(event)
    expect(received).toHaveLength(1)
  })

  it("replays recent events for late subscribers", () => {
    const bus = new TaskEventBus()
    bus.publish(event)
    bus.publish({ ...event, message: "world" })
    expect(bus.replay("vg_test")).toHaveLength(2)
  })

  it("caps the replay buffer", () => {
    const bus = new TaskEventBus()
    for (let index = 0; index < 260; index += 1) {
      bus.publish({ ...event, message: `msg-${index}` })
    }
    const replay = bus.replay("vg_test")
    expect(replay).toHaveLength(200)
  })

  it("isolates subscriber failures", () => {
    const bus = new TaskEventBus()
    const received: TaskEvent[] = []
    bus.subscribe("vg_test", () => {
      throw new Error("boom")
    })
    bus.subscribe("vg_test", (item) => received.push(item))
    expect(() => bus.publish(event)).not.toThrow()
    expect(received).toHaveLength(1)
  })

  it("clears history on demand", () => {
    const bus = new TaskEventBus()
    bus.publish(event)
    bus.clear("vg_test")
    expect(bus.replay("vg_test")).toEqual([])
  })
})

describe("mergeOptions", () => {
  const settings = {
    defaultPreset: "balanced" as const,
    defaultLanguage: "zh",
    defaultAsr: "auto" as const,
    defaultVision: false,
    defaultProofread: false,
    defaultTranslateTo: null,
  }

  it("uses settings defaults for an empty request", () => {
    expect(mergeOptions(undefined, settings)).toEqual({
      language: "zh",
      preset: "balanced",
      asr: "auto",
      vision: false,
      proofread: false,
      translateTo: null,
    })
  })

  it("enables vision and proofreading for the deep preset", () => {
    const options = mergeOptions({ preset: "deep" }, settings)
    expect(options.vision).toBe(true)
    expect(options.proofread).toBe(true)
  })

  it("keeps explicit overrides over preset defaults", () => {
    const options = mergeOptions({ preset: "deep", vision: false, proofread: false }, settings)
    expect(options.vision).toBe(false)
    expect(options.proofread).toBe(false)
  })

  it("accepts an explicit translation target", () => {
    expect(mergeOptions({ translateTo: "en" }, settings).translateTo).toBe("en")
  })

  it("allows disabling translation with null", () => {
    expect(mergeOptions({ translateTo: null }, { ...settings, defaultTranslateTo: "en" }).translateTo).toBeNull()
  })
})
