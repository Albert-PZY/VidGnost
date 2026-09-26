import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

export async function ensureDirectory(targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true })
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8")
    if (!raw.trim()) {
      return null
    }
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 原子写入 JSON（先写临时文件再 rename），避免半截文件。 */
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rm(filePath, { force: true })
  await rename(tempPath, filePath)
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDirectory(path.dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, content, "utf8")
  await rm(filePath, { force: true })
  await rename(tempPath, filePath)
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(filePath))
  await appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8")
}

export async function readJsonLines<T>(filePath: string, limit = 500): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8")
    const lines = raw.split(/\r?\n/).filter((line) => line.trim())
    const slice = lines.length > limit ? lines.slice(lines.length - limit) : lines
    const result: T[] = []
    for (const line of slice) {
      try {
        result.push(JSON.parse(line) as T)
      } catch {
        // 忽略损坏行
      }
    }
    return result
  } catch {
    return []
  }
}

export async function fileSize(filePath: string): Promise<number> {
  try {
    const info = await stat(filePath)
    return info.size
  } catch {
    return 0
  }
}

export function sanitizeFilename(input: string, fallback = "file"): string {
  const cleaned = String(input || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
  return cleaned.slice(0, 120) || fallback
}
