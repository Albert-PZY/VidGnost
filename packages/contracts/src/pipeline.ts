import type { ErrorShape, IsoDateTime, JsonValue, TaskId, TokenUsage } from "./common.js"
import type { MediaSource } from "./media.js"
import type { TranscriptEngine } from "./transcript.js"

/* ------------------------------------------------------------------ 阶段 */

export type StageId =
  | "ingest"
  | "audio"
  | "transcribe"
  | "structure"
  | "insight"
  | "mindmap"
  | "knowledge"
  | "vision"
  | "index"
  | "finalize"

export type StageStatus = "pending" | "running" | "succeeded" | "failed" | "skipped"

export interface StageState {
  id: StageId
  label: string
  status: StageStatus
  /** 0 - 1。 */
  progress: number
  /** 当前动作说明，用于实时展示。 */
  message: string
  /** 相对权重，用于计算总进度。 */
  weight: number
  startedAt?: IsoDateTime
  finishedAt?: IsoDateTime
  error?: ErrorShape
  /** 该阶段产出的工件 key。 */
  artifacts: string[]
  /** 该阶段的模型调用次数。 */
  calls: number
  usage?: TokenUsage
}

/* ------------------------------------------------------------------ 选项 */

export type ProcessingPreset = "fast" | "balanced" | "deep"

export type AsrPreference = "auto" | "online" | "local"

export interface TaskOptions {
  /** 预期语言，`auto` 交给引擎判定。 */
  language: string
  preset: ProcessingPreset
  asr: AsrPreference
  /** 是否做视觉增强（关键帧 + 多模态理解）。 */
  vision: boolean
  /** 是否做术语/错别字纠错。 */
  proofread: boolean
  /** 翻译目标语言，null 表示不翻译。 */
  translateTo: string | null
}

/* ------------------------------------------------------------------ 任务 */

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled"

export interface TaskStats {
  transcriptEngine?: TranscriptEngine
  transcriptModel?: string
  segments: number
  paragraphs: number
  chapters: number
  chunks: number
  frames: number
  knowledgeNodes: number
  tokens: TokenUsage
  /** 端到端处理耗时（毫秒）。 */
  elapsedMs?: number
  /** 在线模型调用次数。 */
  modelCalls: number
}

export interface TaskArtifact {
  /** 逻辑 key，例如 `transcript`、`outline`、`summary`。 */
  key: string
  label: string
  /** 相对任务目录的路径。 */
  path: string
  /** 是否可直接作为文本预览 / 导出。 */
  exportable: boolean
  bytes: number
  updatedAt: IsoDateTime
}

export interface TaskRecord {
  id: TaskId
  title: string
  status: TaskStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** 处理完成时间。 */
  finishedAt?: IsoDateTime
  source: MediaSource
  options: TaskOptions
  stages: StageState[]
  artifacts: TaskArtifact[]
  stats: TaskStats
  /** 就绪度 0-1，用于资产库展示。 */
  readiness: number
  error?: ErrorShape
}

/** 资产库卡片用的轻量投影。 */
export interface TaskSummary {
  id: TaskId
  title: string
  status: TaskStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  durationSeconds: number
  platform: MediaSource["platform"]
  tldr?: string
  tags: string[]
  chapters: number
  frames: number
  knowledgeNodes: number
  hasTranscript: boolean
  hasMindMap: boolean
  readiness: number
  engine?: TranscriptEngine
}

/* ------------------------------------------------------------------ 事件 */

export type TaskEvent =
  | { type: "snapshot"; task: TaskRecord }
  | { type: "stage"; taskId: TaskId; stage: StageState; readiness: number }
  | { type: "log"; taskId: TaskId; level: "info" | "warn" | "error"; message: string; at: IsoDateTime }
  | { type: "artifact"; taskId: TaskId; artifact: TaskArtifact }
  | { type: "status"; taskId: TaskId; status: TaskStatus; error?: ErrorShape }
  | { type: "done"; taskId: TaskId; task: TaskRecord }

/* ------------------------------------------------------------ 请求 / 响应 */

export interface CreateTaskRequest {
  /** 本地绝对路径或远程 URL。 */
  source: string
  title?: string
  options?: Partial<TaskOptions>
}

export interface CreateTaskResponse {
  task: TaskRecord
}

export interface TaskListQuery {
  query?: string
  status?: TaskStatus
  limit?: number
}

export interface TaskListResponse {
  tasks: TaskSummary[]
  total: number
}

export interface ArtifactPayload {
  key: string
  label: string
  path: string
  /** 文本工件内容（二进制工件为 null）。 */
  text: string | null
  json: JsonValue | null
}
