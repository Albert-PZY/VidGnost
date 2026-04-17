import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { taskBatchCreateResponseSchema, taskDetailResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("task upload batch route", () => {
  let app: FastifyInstance
  let baseUrl = ""
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-upload-"))
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

  it("returns a batch task response after consuming uploaded file streams", async () => {
    const largeVideoBuffer = Buffer.alloc(32 * 1024 * 1024, 7)
    const form = new FormData()
    form.append("workflow", "vqa")
    form.append("language", "zh")
    form.append("strategy", "single_task_per_file")
    form.append("files", new File([largeVideoBuffer], "upload-sample.mp4", { type: "video/mp4" }))

    const response = await fetch(`${baseUrl}/api/tasks/upload/batch`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(2_000),
    })

    expect(response.status).toBe(200)
    const payload = taskBatchCreateResponseSchema.parse(await response.json())
    expect(payload.strategy).toBe("single_task_per_file")
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0]?.workflow).toBe("vqa")
    await waitForTerminalStatus(app, payload.tasks[0]?.task_id || "")
  })
})

async function waitForTerminalStatus(app: FastifyInstance, taskId: string): Promise<void> {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}`,
    })
    const detail = taskDetailResponseSchema.parse(response.json())
    if (["completed", "failed", "cancelled"].includes(detail.status)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Task ${taskId} did not reach a terminal status in time`)
}
