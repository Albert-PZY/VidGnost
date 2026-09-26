import { createWriteStream } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"

export { runCommand, findCommand, CommandExecutionError } from "./process.js"

export async function downloadToFile(input: {
  url: string
  targetPath: string
  signal?: AbortSignal
}): Promise<string> {
  const response = await fetch(input.url, { method: "GET", signal: input.signal })
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status}`)
  }
  const output = createWriteStream(input.targetPath)
  await pipeline(response.body, output)
  return input.targetPath
}

export function joinUrl(baseUrl: string, suffix: string): string {
  return `${String(baseUrl || "").replace(/\/+$/, "")}${suffix}`
}

export function withExtension(filePath: string, nextExt: string): string {
  const parsed = path.parse(filePath)
  return path.join(parsed.dir, `${parsed.name}${nextExt}`)
}

export async function removeQuietly(targetPath: string): Promise<void> {
  await rm(targetPath, { force: true, recursive: true }).catch(() => undefined)
}
