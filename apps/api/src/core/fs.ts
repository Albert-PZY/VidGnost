import path from "node:path"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"

const JSON_WRITE_RETRYABLE_CODES = new Set(["EACCES", "EBUSY", "EPERM"])
const JSON_WRITE_RETRY_DELAYS_MS = [20, 50, 100]

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

export async function ensureDirectory(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true })
}

export async function readJsonFile<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(targetPath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJsonFile(targetPath: string, payload: unknown): Promise<void> {
  await ensureDirectory(path.dirname(targetPath))
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  try {
    await renameWithRetry(tempPath, targetPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function renameWithRetry(sourcePath: string, targetPath: string): Promise<void> {
  for (let attempt = 0; attempt <= JSON_WRITE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rename(sourcePath, targetPath)
      return
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt === JSON_WRITE_RETRY_DELAYS_MS.length) {
        throw error
      }
      await delay(JSON_WRITE_RETRY_DELAYS_MS[attempt])
    }
  }
}

function isRetryableRenameError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false
  }
  return JSON_WRITE_RETRYABLE_CODES.has(String(error.code || "").toUpperCase())
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs))
}
