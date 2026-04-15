import path from "node:path"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"

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
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  await rename(tempPath, targetPath)
}
