import { createHash, randomUUID } from "node:crypto"

/** 生成短随机 ID。 */
export function shortId(length = 8): string {
  return randomUUID().replace(/-/g, "").slice(0, length)
}

/** 生成任务 ID，形如 `vg_20260926_1a2b3c4d`。 */
export function newTaskId(now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("")
  return `vg_${stamp}_${shortId()}`
}

export function sha1(...parts: Array<string | number | boolean | null | undefined>): string {
  const hash = createHash("sha1")
  for (const part of parts) {
    hash.update(String(part ?? ""))
    hash.update("\u0000")
  }
  return hash.digest("hex")
}

export function fingerprintBuffer(buffer: Buffer, extra = ""): string {
  const hash = createHash("sha1")
  hash.update(buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)))
  hash.update(`|${buffer.length}|${extra}`)
  return hash.digest("hex").slice(0, 16)
}
