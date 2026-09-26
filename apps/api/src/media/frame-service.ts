import path from "node:path"
import { readdir, readFile } from "node:fs/promises"

import type { KeyFrame } from "@vidgnost/contracts"

import { ensureDirectory } from "../core/fs.js"
import { runCommand } from "../core/io.js"
import { dedupeByHash as perceptualDedupe, dHash } from "./perceptual-hash.js"
import type { MediaService } from "./media-service.js"

export interface FrameSamplingInput {
  /** 最多保留的帧数，默认 24。 */
  maxFrames?: number
  /** 场景变化检测阈值，越小越敏感。 */
  sceneThreshold?: number
  signal?: AbortSignal
  taskDir: string
  mediaPath: string
  durationSeconds: number
}

const DEFAULT_MAX_FRAMES = 24
const DEFAULT_SCENE_THRESHOLD = 0.32

export class FrameService {
  constructor(private readonly media: MediaService) {}

  /**
   * 抽取关键帧：
   * 1. 用 ffmpeg `select='gt(scene,t)'` 抓版面变化点（讲座 / 幻灯片场景最有效）；
   * 2. 若候选过少，退化为等间隔采样；
   * 3. 用 dHash 感知哈希去重，保留差异最大的若干帧。
   */
  async extractKeyFrames(input: FrameSamplingInput): Promise<KeyFrame[]> {
    const ffmpeg = await this.media.resolveFfmpeg()
    const outputDir = path.join(input.taskDir, "frames")
    await ensureDirectory(outputDir)
    const maxFrames = Math.max(4, input.maxFrames ?? DEFAULT_MAX_FRAMES)
    const threshold = input.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD

    const candidates: Array<{ time: number; path: string }> = []
    const scenePattern = path.join(outputDir, "scene-%04d.jpg")
    let sceneDetected = false

    try {
      await runCommand({
        command: ffmpeg,
        args: [
          "-y",
          "-v",
          "error",
          "-skip_frame",
          "nokey",
          "-i",
          input.mediaPath,
          "-vsync",
          "vfr",
          "-vf",
          `select='gt(scene,${threshold})',scale=640:-2,showinfo`,
          "-frames:v",
          String(maxFrames * 2),
          "-q:v",
          "4",
          scenePattern,
        ],
        signal: input.signal,
      })
      sceneDetected = true
    } catch {
      sceneDetected = false
    }

    if (sceneDetected) {
      const files = await listJpegs(outputDir, "scene-")
      for (const [index, file] of files.entries()) {
        candidates.push({ time: estimateSceneTime(index, files.length, input.durationSeconds), path: path.join(outputDir, file) })
      }
    }

    if (candidates.length < 3) {
      const intervalFrames = await this.sampleByInterval({
        durationSeconds: input.durationSeconds,
        ffmpeg,
        maxFrames,
        outputDir,
        signal: input.signal,
        source: input.mediaPath,
      })
      candidates.length = 0
      candidates.push(...intervalFrames)
    }

    const frames = await dedupeByHash(candidates, maxFrames)
    return frames.map((frame, index) => ({
      id: `frame-${String(index).padStart(3, "0")}`,
      time: Number(frame.time.toFixed(2)),
      path: path.relative(input.taskDir, frame.path).split(path.sep).join("/"),
      kind: sceneDetected ? "scene" : "interval",
    }))
  }

  private async sampleByInterval(input: {
    durationSeconds: number
    ffmpeg: string
    maxFrames: number
    outputDir: string
    signal?: AbortSignal
    source: string
  }): Promise<Array<{ time: number; path: string }>> {
    const count = Math.max(4, input.maxFrames)
    const interval = Math.max(2, input.durationSeconds / (count + 1))
    const pattern = path.join(input.outputDir, "interval-%04d.jpg")
    await runCommand({
      command: input.ffmpeg,
      args: [
        "-y",
        "-v",
        "error",
        "-i",
        input.source,
        "-vf",
        `fps=1/${interval.toFixed(3)},scale=640:-2`,
        "-frames:v",
        String(count),
        "-q:v",
        "4",
        pattern,
      ],
      signal: input.signal,
    })
    const files = await listJpegs(input.outputDir, "interval-")
    return files.map((file, index) => ({
      time: Math.min(input.durationSeconds, interval * (index + 1)),
      path: path.join(input.outputDir, file),
    }))
  }
}

async function listJpegs(dir: string, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".jpg"))
    .map((entry) => entry.name)
    .sort()
}

function estimateSceneTime(index: number, total: number, durationSeconds: number): number {
  if (total <= 1) {
    return durationSeconds / 2
  }
  return (index / total) * durationSeconds
}

/** dHash + 汉明距离去重，保留互不相似的关键帧。 */
async function dedupeByHash(
  candidates: Array<{ time: number; path: string }>,
  maxFrames: number,
): Promise<Array<{ time: number; path: string }>> {
  const hashed: Array<{ time: number; path: string; hash: bigint }> = []
  for (const candidate of candidates) {
    try {
      const buffer = await readFile(candidate.path)
      hashed.push({ ...candidate, hash: dHash(buffer) })
    } catch {
      // 跳过不可读帧
    }
  }
  if (hashed.length === 0) {
    return []
  }

  const kept = perceptualDedupe(hashed, maxFrames)

  // 去重后仍然太稀疏时，按时间顺序补齐
  if (kept.length < Math.min(6, maxFrames) && hashed.length > kept.length) {
    for (const frame of hashed) {
      if (kept.length >= maxFrames) {
        break
      }
      if (!kept.includes(frame)) {
        kept.push(frame)
      }
    }
  }

  return kept.sort((a, b) => a.time - b.time)
}
