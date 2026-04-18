import os from "node:os"
import path from "node:path"
import { mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { OllamaRuntimeConfigRepository } from "../src/modules/models/ollama-runtime-config-repository.js"

describe("OllamaRuntimeConfigRepository", () => {
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-ollama-runtime-"))
  })

  afterAll(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it("normalizes persisted install path back to the platform default", async () => {
    const repository = new OllamaRuntimeConfigRepository({
      ollamaBaseUrl: "http://127.0.0.1:11434",
      storageDir,
    } as never)
    const defaultInstallDir =
      process.platform === "win32"
        ? path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Ollama")
        : "/usr/local/bin"
    const defaultExecutablePath = path.join(defaultInstallDir, process.platform === "win32" ? "ollama.exe" : "ollama")

    await writeFile(
      path.join(storageDir, "ollama-runtime.json"),
      JSON.stringify(
        {
          install_dir: "D:\\Portable\\Ollama",
          executable_path: "D:\\Portable\\Ollama\\ollama.exe",
          models_dir: "G:\\Ollama_Model",
          base_url: "http://127.0.0.1:11434",
        },
        null,
        2,
      ),
      "utf8",
    )

    await expect(repository.get()).resolves.toMatchObject({
      install_dir: defaultInstallDir,
      executable_path: defaultExecutablePath,
      models_dir: path.normalize("G:\\Ollama_Model"),
      base_url: "http://127.0.0.1:11434",
    })
  })
})
