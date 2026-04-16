import os from "node:os"
import path from "node:path"
import { mkdtemp, rm } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { OllamaServiceManager } from "../src/modules/models/ollama-service-manager.js"

describe("OllamaServiceManager", () => {
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-ollama-manager-"))
  })

  afterAll(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it("reports probe-only runtime status when local restart is not managed", async () => {
    const manager = new OllamaServiceManager({
      async get() {
        return {
          install_dir: path.join(storageDir, "ollama"),
          executable_path: path.join(storageDir, "ollama", "ollama.exe"),
          models_dir: path.join(storageDir, "ollama-models"),
          base_url: "http://127.0.0.1:65531",
        }
      },
    } as never)

    const status = await manager.getStatus()
    expect(status).toMatchObject({
      process_detected: false,
      can_self_restart: false,
      restart_required: false,
      using_configured_models_dir: true,
    })
    expect(status.message).toContain("未检测到 Ollama 可执行文件")

    const restarted = await manager.restartService()
    expect(restarted.can_self_restart).toBe(false)
    expect(restarted.message).toContain("尚未接入自动重启能力")
  })
})
