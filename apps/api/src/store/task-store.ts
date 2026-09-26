import path from "node:path"

import type {
  ArtifactPayload,
  TaskArtifact,
  TaskEvent,
  TaskRecord,
  TaskSummary,
} from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { AppError } from "../core/errors.js"
import {
  appendJsonLine,
  ensureDirectory,
  fileSize,
  readJsonFile,
  readJsonLines,
  writeJsonFile,
} from "../core/fs.js"

const ARTIFACT_LABELS: Record<string, string> = {
  transcript: "转写稿",
  "transcript.srt": "SRT 字幕",
  paragraphs: "语义段落",
  outline: "章节大纲",
  summary: "摘要",
  mindmap: "思维导图",
  knowledge: "知识图谱",
  frames: "关键帧",
  translation: "翻译",
  notes: "Markdown 笔记",
  index: "检索索引",
  report: "Markdown 报告",
  pack: "导出包",
}

export const ARTIFACT_FILES: Record<string, string> = {
  transcript: "transcript.json",
  "transcript.srt": "transcript.srt",
  "transcript.txt": "transcript.txt",
  paragraphs: "paragraphs.json",
  outline: "outline.json",
  summary: "summary.json",
  mindmap: "mindmap.json",
  "mindmap.mmd": "mindmap.mmd",
  knowledge: "knowledge.json",
  frames: "frames.json",
  translation: "translation.json",
  notes: "notes.md",
  index: "index/chunks.json",
  report: "export/report.md",
  pack: "export/pack.json",
}

export class TaskStore {
  constructor(private readonly config: AppConfig) {}

  taskDir(taskId: string): string {
    return path.join(this.config.storageDir, "tasks", taskId)
  }

  async ensureTaskDir(taskId: string): Promise<string> {
    const dir = this.taskDir(taskId)
    await ensureDirectory(dir)
    return dir
  }

  async write(task: TaskRecord): Promise<void> {
    await writeJsonFile(path.join(this.taskDir(task.id), "task.json"), task)
  }

  async read(taskId: string): Promise<TaskRecord | null> {
    return readJsonFile<TaskRecord>(path.join(this.taskDir(taskId), "task.json"))
  }

  async requireTask(taskId: string): Promise<TaskRecord> {
    const task = await this.read(taskId)
    if (!task) {
      throw AppError.notFound(`任务不存在：${taskId}`, { code: "TASK_NOT_FOUND" })
    }
    return task
  }

  async list(): Promise<TaskRecord[]> {
    const tasksDir = path.join(this.config.storageDir, "tasks")
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(tasksDir, { withFileTypes: true }).catch(() => [])
    const tasks: TaskRecord[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const task = await this.read(entry.name)
      if (task) {
        tasks.push(task)
      }
    }
    return tasks.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  async appendEvent(taskId: string, event: TaskEvent): Promise<void> {
    await appendJsonLine(path.join(this.taskDir(taskId), "events.ndjson"), event)
  }

  async readEvents(taskId: string, limit = 400): Promise<TaskEvent[]> {
    return readJsonLines<TaskEvent>(path.join(this.taskDir(taskId), "events.ndjson"), limit)
  }

  /* -------------------------------------------------------- 阶段检查点 */

  checkpointPath(taskId: string, stage: string): string {
    return path.join(this.taskDir(taskId), "checkpoints", `${stage}.json`)
  }

  async readCheckpoint<T = Record<string, unknown>>(taskId: string, stage: string): Promise<T | null> {
    return readJsonFile<T>(this.checkpointPath(taskId, stage))
  }

  async writeCheckpoint(taskId: string, stage: string, payload: Record<string, unknown>): Promise<void> {
    await writeJsonFile(this.checkpointPath(taskId, stage), {
      stage,
      finishedAt: new Date().toISOString(),
      ...payload,
    })
  }

  async clearCheckpoint(taskId: string, stage: string): Promise<void> {
    const { rm } = await import("node:fs/promises")
    await rm(this.checkpointPath(taskId, stage), { force: true })
  }

  /* ------------------------------------------------------------ 工件 */

  async refreshArtifacts(task: TaskRecord, keys?: string[]): Promise<TaskArtifact[]> {
    const taskDir = this.taskDir(task.id)
    const candidates = keys ? keys.filter((key) => ARTIFACT_FILES[key]) : Object.keys(ARTIFACT_FILES)
    const artifacts: TaskArtifact[] = []

    for (const key of candidates) {
      const relative = ARTIFACT_FILES[key]
      const absolute = path.join(taskDir, relative)
      const bytes = await fileSize(absolute)
      if (bytes <= 0) {
        continue
      }
      artifacts.push({
        key,
        label: ARTIFACT_LABELS[key] || key,
        path: relative.split(path.sep).join("/"),
        exportable: key !== "index",
        bytes,
        updatedAt: new Date().toISOString(),
      })
    }

    const merged = new Map(task.artifacts.map((artifact) => [artifact.key, artifact]))
    for (const artifact of artifacts) {
      merged.set(artifact.key, artifact)
    }
    return [...merged.values()]
  }

  async readArtifact(taskId: string, key: string): Promise<ArtifactPayload> {
    const relative = ARTIFACT_FILES[key]
    if (!relative) {
      throw AppError.notFound(`未知工件：${key}`, { code: "ARTIFACT_UNKNOWN" })
    }
    const absolute = path.join(this.taskDir(taskId), relative)
    const { readFile } = await import("node:fs/promises")
    let text: string
    try {
      text = await readFile(absolute, "utf8")
    } catch {
      throw AppError.notFound(`工件尚未生成：${key}`, { code: "ARTIFACT_NOT_READY" })
    }

    let json: ArtifactPayload["json"] = null
    if (relative.endsWith(".json")) {
      try {
        json = JSON.parse(text) as ArtifactPayload["json"]
      } catch {
        json = null
      }
    }

    return {
      key,
      label: ARTIFACT_LABELS[key] || key,
      path: relative,
      text: relative.endsWith(".json") ? null : text,
      json,
    }
  }

  async artifactJson<T>(taskId: string, key: string): Promise<T | null> {
    const relative = ARTIFACT_FILES[key]
    if (!relative) {
      return null
    }
    return readJsonFile<T>(path.join(this.taskDir(taskId), relative))
  }

  async writeArtifactJson(taskId: string, key: string, value: unknown): Promise<void> {
    const relative = ARTIFACT_FILES[key]
    if (!relative) {
      throw AppError.badRequest(`未知工件：${key}`, { code: "ARTIFACT_UNKNOWN" })
    }
    await writeJsonFile(path.join(this.taskDir(taskId), relative), value)
  }

  async writeArtifactText(taskId: string, key: string, content: string): Promise<void> {
    const relative = ARTIFACT_FILES[key]
    if (!relative) {
      throw AppError.badRequest(`未知工件：${key}`, { code: "ARTIFACT_UNKNOWN" })
    }
    const { writeTextFile } = await import("../core/fs.js")
    await writeTextFile(path.join(this.taskDir(taskId), relative), content)
  }

  async readArtifactText(taskId: string, key: string): Promise<string> {
    const relative = ARTIFACT_FILES[key]
    if (!relative) {
      return ""
    }
    const { readFile } = await import("node:fs/promises")
    return readFile(path.join(this.taskDir(taskId), relative), "utf8").catch(() => "")
  }

  toSummary(task: TaskRecord, extras: { tldr?: string; tags?: string[] } = {}): TaskSummary {
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      durationSeconds: task.source.durationSeconds,
      platform: task.source.platform,
      tldr: extras.tldr,
      tags: extras.tags || [],
      chapters: task.stats.chapters,
      frames: task.stats.frames,
      knowledgeNodes: task.stats.knowledgeNodes,
      hasTranscript: task.artifacts.some((artifact) => artifact.key === "transcript"),
      hasMindMap: task.artifacts.some((artifact) => artifact.key === "mindmap"),
      readiness: task.readiness,
      engine: task.stats.transcriptEngine,
    }
  }
}
