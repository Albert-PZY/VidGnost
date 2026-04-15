import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { describe, expect, it, vi } from "vitest"

import { VqaTraceStore } from "../src/modules/vqa/trace-store.js"

describe("VqaTraceStore", () => {
  it("allocates unique trace ids within the same second", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-trace-store-"))

    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-04-16T00:00:00.000Z"))

      const store = new VqaTraceStore(storageDir)
      const firstTraceId = store.newTrace({
        configSnapshot: { retrieval: { mode: "hybrid-heuristic" } },
        metadata: { query_text: "第一个问题" },
      })
      const secondTraceId = store.newTrace({
        configSnapshot: { retrieval: { mode: "hybrid-heuristic" } },
        metadata: { query_text: "第二个问题" },
      })

      expect(firstTraceId).not.toBe(secondTraceId)
    } finally {
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 10))
      await rm(storageDir, { force: true, recursive: true })
    }
  })
})
