import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"

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

  it("reports restart required when manifest files exist but the running service has not loaded models", async () => {
    const modelsDir = path.join(storageDir, "ollama-models")
    await mkdir(path.join(modelsDir, "manifests", "registry.ollama.ai", "library", "qwen2.5"), {
      recursive: true,
    })

    const manager = new OllamaServiceManager({
      async get() {
        return {
          install_dir: path.join(storageDir, "ollama"),
          executable_path: path.join(storageDir, "ollama", "ollama.exe"),
          models_dir: modelsDir,
          base_url: "http://127.0.0.1:65531",
        }
      },
    } as never, {
      async findProcess() {
        return {
          detected: true,
          pid: 2048,
        }
      },
      async listModels() {
        return []
      },
      async pathExists(targetPath) {
        return targetPath.endsWith("ollama.exe") || targetPath.endsWith("manifests")
      },
      async probe() {
        return true
      },
    })

    const status = await manager.getStatus()
    expect(status).toMatchObject({
      process_detected: true,
      process_id: 2048,
      can_self_restart: true,
      restart_required: true,
    })
    expect(status.message).toContain("重启")
  })

  it("restarts Ollama through injected process controls and returns refreshed status", async () => {
    let probeCallCount = 0
    let stopCalled = false
    let startCalled = false

    const manager = new OllamaServiceManager({
      async get() {
        return {
          install_dir: path.join(storageDir, "ollama"),
          executable_path: path.join(storageDir, "ollama", "ollama.exe"),
          models_dir: path.join(storageDir, "ollama-models"),
          base_url: "http://127.0.0.1:11434",
        }
      },
    } as never, {
      async findProcess() {
        return {
          detected: true,
          pid: 4096,
        }
      },
      async listModels() {
        return ["qwen2.5:3b"]
      },
      async pathExists(targetPath) {
        return targetPath.endsWith("ollama.exe")
      },
      async probe() {
        probeCallCount += 1
        return probeCallCount > 1
      },
      async stopProcess() {
        stopCalled = true
      },
      async startProcess() {
        startCalled = true
      },
    })

    const restarted = await manager.restartService()
    expect(stopCalled).toBe(true)
    expect(startCalled).toBe(true)
    expect(restarted).toMatchObject({
      reachable: true,
      process_detected: true,
      can_self_restart: true,
      restart_required: false,
    })
    expect(restarted.message).toContain("已重启")
  })
})
