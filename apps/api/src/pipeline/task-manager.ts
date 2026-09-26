import path from "node:path"

import type { CreateTaskRequest, TaskOptions, TaskRecord, TaskSummary } from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { AppError } from "../core/errors.js"
import { newTaskId } from "../core/id.js"
import { logger } from "../core/logger.js"
import { ensureDirectory } from "../core/fs.js"
import { readJsonFile } from "../core/fs.js"
import type { ModelGateway } from "../providers/gateway.js"
import type { TaskStore } from "../store/task-store.js"
import type { TaskEventBus } from "./event-bus.js"
import { initialStages } from "./stages.js"
import type { TaskRunner } from "./task-runner.js"

const log = logger.child({ scope: "task-manager" })

interface RunningTask {
  controller: AbortController
  promise: Promise<TaskRecord>
}

/**
 * 任务管理器：负责任务排队、并发上限、取消与库索引维护。
 */
export class TaskManager {
  private readonly running = new Map<string, RunningTask>()
  private readonly queue: string[] = []
  private concurrency: number

  constructor(
    private readonly deps: {
      bus: TaskEventBus
      config: AppConfig
      gateway: ModelGateway
      runner: TaskRunner
      store: TaskStore
    },
  ) {
    this.concurrency = deps.config.maxConcurrentTasks
  }

  async setConcurrency(value: number): Promise<void> {
    this.concurrency = Math.max(1, Math.min(8, Math.round(value)))
    await this.drain()
  }

  async create(request: CreateTaskRequest): Promise<TaskRecord> {
    const settings = await this.deps.gateway.settings.getSettings()
    const options = mergeOptions(request.options, settings)
    const now = new Date().toISOString()
    const taskId = newTaskId()
    await ensureDirectory(this.deps.store.taskDir(taskId))

    const title = request.title?.trim() || deriveTitle(request.source)
    const task: TaskRecord = {
      id: taskId,
      title,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      source: {
        kind: "local_path",
        uri: request.source,
        platform: "other",
        title,
        mediaPath: "",
        audioOnly: false,
        durationSeconds: 0,
        sizeBytes: 0,
        fingerprint: "",
        createdAt: now,
      },
      options,
      stages: initialStages(),
      artifacts: [],
      stats: {
        segments: 0,
        paragraphs: 0,
        chapters: 0,
        chunks: 0,
        frames: 0,
        knowledgeNodes: 0,
        tokens: {},
        modelCalls: 0,
      },
      readiness: 0,
    }

    await this.deps.store.write(task)
    this.deps.bus.publish({ type: "snapshot", task })
    this.deps.bus.publish({ type: "status", taskId, status: "queued" })

    this.queue.push(taskId)
    void this.drain()
    return task
  }

  async list(query: { limit?: number; query?: string; status?: TaskRecord["status"] } = {}): Promise<{ tasks: TaskSummary[]; total: number }> {
    const tasks = await this.deps.store.list()
    const keyword = String(query.query || "").trim().toLowerCase()
    const filtered = tasks.filter((task) => {
      if (query.status && task.status !== query.status) {
        return false
      }
      if (!keyword) {
        return true
      }
      const summary = task.title.toLowerCase()
      return summary.includes(keyword) || task.id.toLowerCase().includes(keyword)
    })

    const summaries: TaskSummary[] = []
    for (const task of filtered.slice(0, query.limit ?? 100)) {
      const summary = await readJsonFile<{ tldr?: string; tags?: string[] }>(
        path.join(this.deps.store.taskDir(task.id), "summary.json"),
      )
      summaries.push(this.deps.store.toSummary(task, { tldr: summary?.tldr, tags: summary?.tags }))
    }
    return { tasks: summaries, total: filtered.length }
  }

  async cancel(taskId: string): Promise<TaskRecord> {
    const task = await this.deps.store.requireTask(taskId)
    const entry = this.running.get(taskId)
    if (entry) {
      entry.controller.abort()
      return task
    }
    const queuedIndex = this.queue.indexOf(taskId)
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1)
      const updated: TaskRecord = { ...task, status: "canceled", updatedAt: new Date().toISOString() }
      await this.deps.store.write(updated)
      this.deps.bus.publish({ type: "status", taskId, status: "canceled" })
      return updated
    }
    throw AppError.conflict("任务当前不在运行中，无法取消。", { code: "TASK_NOT_RUNNING" })
  }

  async remove(taskId: string): Promise<void> {
    const entry = this.running.get(taskId)
    if (entry) {
      throw AppError.conflict("任务正在运行，请先取消再删除。", { code: "TASK_RUNNING" })
    }
    const { rm } = await import("node:fs/promises")
    await rm(this.deps.store.taskDir(taskId), { force: true, recursive: true })
    this.deps.bus.clear(taskId)
  }

  async rerun(taskId: string, stages?: string[]): Promise<TaskRecord> {
    const task = await this.deps.store.requireTask(taskId)
    if (this.running.has(taskId)) {
      throw AppError.conflict("任务正在运行。", { code: "TASK_RUNNING" })
    }
    for (const stage of stages?.length ? stages : ["transcript", "structure", "insight", "mindmap", "knowledge", "vision", "index", "finalize"]) {
      await this.deps.store.clearCheckpoint(taskId, stage)
    }
    const updated: TaskRecord = {
      ...task,
      status: "queued",
      error: undefined,
      stages: initialStages(),
      readiness: 0,
      updatedAt: new Date().toISOString(),
    }
    await this.deps.store.write(updated)
    this.deps.bus.publish({ type: "snapshot", task: updated })
    this.queue.push(taskId)
    void this.drain()
    return updated
  }

  isRunning(taskId: string): boolean {
    return this.running.has(taskId)
  }

  /**
   * 启动恢复：进程重启后，磁盘上仍标记为 queued/running 的任务会重新入队。
   * 阶段产物已按检查点缓存，因此重跑只会补算未完成的阶段。
   */
  async recoverInterrupted(): Promise<number> {
    const tasks = await this.deps.store.list()
    let recovered = 0
    for (const task of tasks) {
      if (task.status !== "running" && task.status !== "queued") {
        continue
      }
      const updated: TaskRecord = {
        ...task,
        status: "queued",
        error: undefined,
        stages: task.stages.map((stage) =>
          stage.status === "running"
            ? { ...stage, status: "pending", progress: 0, message: "等待恢复", startedAt: undefined }
            : stage,
        ),
        updatedAt: new Date().toISOString(),
      }
      await this.deps.store.write(updated)
      this.deps.bus.publish({ type: "snapshot", task: updated })
      this.queue.push(updated.id)
      recovered += 1
    }
    if (recovered > 0) {
      log.info({ recovered }, "recovered interrupted tasks")
      void this.drain()
    }
    return recovered
  }

  private async drain(): Promise<void> {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const taskId = this.queue.shift()
      if (!taskId) {
        return
      }
      const task = await this.deps.store.read(taskId)
      if (!task || task.status === "canceled") {
        continue
      }
      const controller = new AbortController()
      const promise = this.deps.runner
        .run(task, controller.signal)
        .catch((error) => {
          log.error({ taskId, error: String(error) }, "runner crashed")
          return task
        })
        .finally(() => {
          this.running.delete(taskId)
          void this.drain()
        })
      this.running.set(taskId, { controller, promise })
    }
  }
}

export function mergeOptions(input: Partial<TaskOptions> | undefined, settings: { defaultAsr: TaskOptions["asr"]; defaultLanguage: string; defaultPreset: TaskOptions["preset"]; defaultProofread: boolean; defaultTranslateTo: string | null; defaultVision: boolean }): TaskOptions {
  const preset = input?.preset || settings.defaultPreset
  return {
    language: input?.language || settings.defaultLanguage,
    preset,
    asr: input?.asr || settings.defaultAsr,
    // 只有 deep 预设默认开启视觉与校对，其余预设跟随显式传参
    vision: input?.vision ?? (preset === "deep" ? true : settings.defaultVision),
    proofread: input?.proofread ?? (preset === "deep" ? true : settings.defaultProofread),
    translateTo: input?.translateTo === undefined ? settings.defaultTranslateTo : input.translateTo,
  }
}

function deriveTitle(source: string): string {
  const trimmed = String(source || "").trim()
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const last = url.pathname.split("/").filter(Boolean).pop() || url.hostname
      return decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 80) || url.hostname
    } catch {
      return trimmed.slice(0, 80)
    }
  }
  const base = path.basename(trimmed)
  return base.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 80) || "未命名任务"
}
