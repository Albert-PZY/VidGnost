import path from "node:path"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"

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
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}
