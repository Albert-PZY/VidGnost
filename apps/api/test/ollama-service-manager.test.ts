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
    let stopCalled = false
    let startCalled = false
    let stopInput: { executablePath: string; trayExecutablePath: string } | null = null

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
        return true
      },
      async stopProcess(input) {
        stopCalled = true
        stopInput = input
      },
      async startProcess() {
        startCalled = true
        return {
          reachable: true,
          startupError: "",
        }
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
    expect(stopInput).toMatchObject({
      executablePath: path.join(storageDir, "ollama", "ollama.exe"),
      trayExecutablePath: path.join(storageDir, "ollama", "ollama app.exe"),
    })
    expect(restarted.message).toContain("已重启")
  })

  it("reports when the configured loopback port is restricted by Windows", async () => {
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
          detected: false,
          pid: null,
        }
      },
      async listModels() {
        return []
      },
      async pathExists(targetPath) {
        return targetPath.endsWith("ollama.exe")
      },
      async probe() {
        return false
      },
      async diagnoseBaseUrl() {
        return "restricted"
      },
    })

    const status = await manager.getStatus()
    expect(status.reachable).toBe(false)
    expect(status.message).toContain("11434")
    expect(status.message).toContain("端口")
    expect(status.message).toContain("限制")
  })

  it("kills the process occupying 11434 and retries Ollama on the same port", async () => {
    let currentConfig = {
      install_dir: path.join(storageDir, "ollama"),
      executable_path: path.join(storageDir, "ollama", "ollama.exe"),
      models_dir: path.join(storageDir, "ollama-models"),
      base_url: "http://127.0.0.1:11434",
    }
    const startInputs: Array<{ baseUrl: string; executablePath: string; modelsDir: string }> = []
    const killedPids: number[] = []
    let startAttempt = 0
    let serviceReachable = false

    const manager = new OllamaServiceManager({
      async get() {
        return currentConfig
      },
      async save(payload: Partial<typeof currentConfig>) {
        currentConfig = {
          ...currentConfig,
          ...payload,
        }
        return currentConfig
      },
    } as never, {
      async findProcess() {
        return {
          detected: true,
          pid: 5120,
        }
      },
      async listModels() {
        return serviceReachable ? ["qwen2.5:3b"] : []
      },
      async pathExists(targetPath) {
        return targetPath.endsWith("ollama.exe")
      },
      async probe() {
        return serviceReachable
      },
      async startProcess(input) {
        startInputs.push(input)
        startAttempt += 1
        if (startAttempt === 1) {
          return {
            reachable: false,
            startupError: "listen tcp 127.0.0.1:11434: bind: Only one usage of each socket address is normally permitted.",
          }
        }
        serviceReachable = true
        return {
          reachable: true,
          startupError: "",
        }
      },
      async stopProcess() {
        return
      },
      async diagnoseBaseUrl() {
        return serviceReachable ? "available" : "occupied"
      },
      async findPortOwnerPid() {
        return 7788
      },
      async killProcessByPid(pid) {
        killedPids.push(pid)
      },
    })

    const restarted = await manager.restartService()
    expect(startInputs.map((item) => item.baseUrl)).toEqual([
      "http://127.0.0.1:11434",
      "http://127.0.0.1:11434",
    ])
    expect(killedPids).toEqual([7788])
    expect(restarted).toMatchObject({
      reachable: true,
      process_detected: true,
    })
    expect(restarted.message).toContain("已重启")
  })

  it("does not switch to another port when 11434 is restricted by Windows", async () => {
    let currentConfig = {
      install_dir: path.join(storageDir, "ollama"),
      executable_path: path.join(storageDir, "ollama", "ollama.exe"),
      models_dir: path.join(storageDir, "ollama-models"),
      base_url: "http://127.0.0.1:11434",
    }
    const startInputs: Array<{ baseUrl: string; executablePath: string; modelsDir: string }> = []
    const savedBaseUrls: string[] = []
    const killedPids: number[] = []

    const manager = new OllamaServiceManager({
      async get() {
        return currentConfig
      },
      async save(payload: Partial<typeof currentConfig>) {
        currentConfig = {
          ...currentConfig,
          ...payload,
        }
        savedBaseUrls.push(currentConfig.base_url)
        return currentConfig
      },
    } as never, {
      async findProcess() {
        return {
          detected: false,
          pid: null,
        }
      },
      async listModels() {
        return []
      },
      async pathExists(targetPath) {
        return targetPath.endsWith("ollama.exe")
      },
      async probe() {
        return false
      },
      async startProcess(input) {
        startInputs.push(input)
        return {
          reachable: false,
          startupError: "listen tcp 127.0.0.1:11434: bind: An attempt was made to access a socket in a way forbidden by its access permissions.",
        }
      },
      async stopProcess() {
        return
      },
      async diagnoseBaseUrl() {
        return "restricted"
      },
      async findPortOwnerPid() {
        return null
      },
      async killProcessByPid(pid) {
        killedPids.push(pid)
      },
    })

    const restarted = await manager.restartService()
    expect(startInputs.map((item) => item.baseUrl)).toEqual([
      "http://127.0.0.1:11434",
    ])
    expect(savedBaseUrls).toEqual([])
    expect(killedPids).toEqual([])
    expect(restarted.reachable).toBe(false)
    expect(restarted.message).toContain("11434")
    expect(restarted.message).toContain("限制")
  })
})
