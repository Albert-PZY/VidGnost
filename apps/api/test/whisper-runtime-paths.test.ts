import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { resolveWhisperModelPath } from "../src/modules/asr/whisper-runtime-paths.js"

describe("resolveWhisperModelPath", () => {
  let tempDir = ""

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-whisper-model-"))
  })

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("prefers a direct faster-whisper model directory", async () => {
    const modelDir = path.join(tempDir, "direct-model")
    await mkdir(modelDir, { recursive: true })
    await writeFile(path.join(modelDir, "config.json"), "{\"model_type\":\"whisper\"}\n", "utf8")
    await writeFile(path.join(modelDir, "model.bin"), "model", "utf8")

    await expect(resolveWhisperModelPath(modelDir, "small")).resolves.toBe(path.normalize(modelDir))
  })

  it("finds a nested faster-whisper model directory under the configured root", async () => {
    const modelRoot = path.join(tempDir, "nested-root")
    const nestedDir = path.join(modelRoot, "whisper-default")
    await mkdir(nestedDir, { recursive: true })
    await writeFile(path.join(nestedDir, "config.json"), "{\"model_type\":\"whisper\"}\n", "utf8")
    await writeFile(path.join(nestedDir, "model.bin"), "model", "utf8")

    await expect(resolveWhisperModelPath(modelRoot, "small")).resolves.toBe(path.normalize(nestedDir))
  })

  it("resolves worker script and workspace python paths from the repository root even when cwd is apps/api", async () => {
    const fakeWorkspaceRoot = path.join(tempDir, "workspace-root")
    const fakeApiDir = path.join(fakeWorkspaceRoot, "apps", "api")
    const fakePythonDir = path.join(fakeApiDir, "python")
    const fakeVenvPython = path.join(
      fakePythonDir,
      ".venv",
      process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"),
    )
    const fakeWorkerScript = path.join(fakePythonDir, "transcribe_faster_whisper.py")

    await mkdir(path.dirname(fakeVenvPython), { recursive: true })
    await writeFile(path.join(fakeWorkspaceRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8")
    await writeFile(fakeVenvPython, "python", "utf8")
    await writeFile(fakeWorkerScript, "# worker\n", "utf8")

    const originalCwd = process.cwd()
    process.chdir(fakeApiDir)
    vi.resetModules()

    try {
      const runtimePaths = await import("../src/modules/asr/whisper-runtime-paths.js")

      await expect(
        runtimePaths.resolveWhisperPythonExecutable({
          runtimeBinDir: "",
          whisperPythonExecutable: "",
        }),
      ).resolves.toBe(path.normalize(fakeVenvPython))
      expect(runtimePaths.resolveWhisperWorkerScriptPath()).toBe(path.normalize(fakeWorkerScript))
    } finally {
      process.chdir(originalCwd)
      vi.resetModules()
    }
  })
})
