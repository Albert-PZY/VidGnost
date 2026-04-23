import os from "node:os"
import path from "node:path"
import { mkdtemp, readFile, rm } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("core fs helpers", () => {
  let storageDir = ""

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-core-fs-"))
  })

  afterEach(async () => {
    vi.resetModules()
    vi.restoreAllMocks()
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
      storageDir = ""
    }
  })

  it("retries transient windows rename conflicts when writing json files", async () => {
    let renameAttempts = 0
    const renameSpy = vi.fn()

    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>()
      return {
        ...actual,
        rename: async (from: string, to: string) => {
          renameAttempts += 1
          renameSpy(from, to)
          if (renameAttempts === 1) {
            const error = Object.assign(new Error("operation not permitted"), {
              code: "EPERM",
            })
            throw error
          }
          return actual.rename(from, to)
        },
      }
    })

    const { writeJsonFile } = await import("../src/core/fs.js")
    const targetPath = path.join(storageDir, "state.json")

    await writeJsonFile(targetPath, {
      status: "ok",
    })

    const persisted = JSON.parse(await readFile(targetPath, "utf8")) as { status?: string }
    expect(persisted).toMatchObject({
      status: "ok",
    })
    expect(renameSpy).toHaveBeenCalledTimes(2)
  })
})
