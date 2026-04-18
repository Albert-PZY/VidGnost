import path from "node:path"
import { cp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"

import type {
  TaskDetailResponse,
  TaskListResponse,
  TaskRecentResponse,
  TaskStatsResponse,
  TaskStepItem,
  TaskStepStatus,
  TaskSummaryItem,
  TranscriptSegment,
  WorkflowType,
} from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { ensureDirectory, pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"
import {
  ALLOWED_VIDEO_EXTENSIONS,
  STAGE_KEYS,
  buildArtifactIndex,
  normalizeDate,
  normalizeSourceType,
  normalizeWorkflow,
  parseStageLogs,
  parseStageMetrics,
  toPublicTaskStatus as toPublicStatus,
} from "./task-support.js"

type SortBy = "date" | "name" | "size"

interface ListTaskOptions {
  limit: number
  offset: number
  q?: string
  sortBy: SortBy
  status?: string
  workflow?: WorkflowType
}

export interface StoredTaskRecord {
  artifact_index_json?: string | null
  artifact_total_bytes?: number
  created_at?: string
  duration_seconds?: number | null
  error_message?: string | null
  file_size_bytes?: number
  fusion_prompt_markdown?: string | null
  id?: string
  language?: string
  mindmap_markdown?: string | null
  model_size?: string
  notes_markdown?: string | null
  progress?: number
  source_input?: string
  source_local_path?: string | null
  source_type?: string
  stage_logs_json?: string | null
  stage_metrics_json?: string | null
  status?: string
  summary_markdown?: string | null
  title?: string | null
  transcript_segments_json?: string | null
  transcript_text?: string | null
  updated_at?: string
  workflow?: string
}

const MARKDOWN_IMAGE_PATTERN =
  /(!\[[^\]]*]\()(?<path>(?:\.{1,2}\/)?[^)\s]+\.(?:png|jpg|jpeg|gif|webp|svg))(\))/gi

export class TaskRepository {
  private readonly recordsDir: string
  private readonly eventLogsDir: string
  private readonly stageArtifactsDir: string
  private readonly tasksRootDir: string
  private readonly tempDir: string
  private readonly traceLogsDir: string
  private readonly uploadDir: string

  constructor(private readonly config: AppConfig) {
    this.tasksRootDir = path.join(config.storageDir, "tasks")
    this.recordsDir = path.join(this.tasksRootDir, "records")
    this.stageArtifactsDir = path.join(this.tasksRootDir, "stage-artifacts")
    this.eventLogsDir = config.eventLogDir
    this.tempDir = config.tempDir
    this.traceLogsDir = path.join(config.eventLogDir, "traces")
    this.uploadDir = config.uploadDir
  }

  async list(options: ListTaskOptions): Promise<TaskListResponse> {
    const allRecords = await this.listAllRecords()
    const filteredRecords = allRecords
      .filter((record) => matchesQuery(record, options.q))
      .filter((record) => matchesWorkflow(record, options.workflow))
      .filter((record) => matchesStatus(record, options.status))

    sortRecords(filteredRecords, options.sortBy)

    return {
      items: filteredRecords.slice(options.offset, options.offset + options.limit).map((record) => toSummaryItem(record)),
      total: filteredRecords.length,
    }
  }

  async stats(): Promise<TaskStatsResponse> {
    const allRecords = await this.listAllRecords()
    return {
      total: allRecords.length,
      notes: allRecords.filter((record) => normalizeWorkflow(record.workflow) === "notes").length,
      vqa: allRecords.filter((record) => normalizeWorkflow(record.workflow) === "vqa").length,
      completed: allRecords.filter((record) => toPublicStatus(record.status) === "completed").length,
    }
  }

  async recent(limit: number): Promise<TaskRecentResponse> {
    const allRecords = await this.listAllRecords()
    sortRecords(allRecords, "date")
    return {
      items: allRecords.slice(0, Math.max(1, limit)).map((record) => ({
        id: String(record.id || ""),
        title: normalizeNullableString(record.title) || normalizeNullableString(record.source_input) || String(record.id || ""),
        workflow: normalizeWorkflow(record.workflow),
        duration_seconds: resolveEffectiveDurationSeconds(record),
        updated_at: normalizeDate(record.updated_at),
      })),
    }
  }

  async getDetail(taskId: string): Promise<TaskDetailResponse | null> {
    const record = await this.getRecord(taskId)
    if (!record) {
      return null
    }

    const workflow = normalizeWorkflow(record.workflow)
    const transcriptSegments = parseTranscriptSegments(record.transcript_segments_json)
    const stageLogs = parseStageLogs(record.stage_logs_json)
    const stageMetrics = parseStageMetrics(record.stage_metrics_json)
    const vmPhaseMetrics = buildVmPhaseMetrics(stageMetrics)
    const overallProgress = normalizeProgress(record.progress)
    const steps = buildStepsForWorkflow(workflow, stageMetrics, overallProgress)
    const currentStepId = resolveCurrentStepId(steps)
    const sourceMediaPath = await this.findSourceMediaPath(record)

    return {
      id: String(record.id || ""),
      title: normalizeNullableString(record.title),
      workflow,
      source_type: normalizeSourceType(record.source_type),
      source_input: normalizeString(record.source_input),
      source_local_path: sourceMediaPath || normalizeNullableString(record.source_local_path),
      language: normalizeString(record.language, "zh"),
      model_size: normalizeString(record.model_size, "small"),
      status: toPublicStatus(record.status),
      progress: overallProgress,
      overall_progress: overallProgress,
      eta_seconds: estimateEtaSeconds(toPublicStatus(record.status), overallProgress, stageMetrics),
      current_step_id: currentStepId,
      steps,
      error_message: normalizeNullableString(record.error_message),
      duration_seconds: resolveEffectiveDurationSeconds(record),
      transcript_text: normalizeNullableString(record.transcript_text),
      transcript_segments: transcriptSegments,
      summary_markdown: await sanitizeMarkdownArtifactImages(
        this.stageArtifactsDir,
        String(record.id || ""),
        normalizeNullableString(record.summary_markdown),
      ),
      mindmap_markdown: normalizeNullableString(record.mindmap_markdown),
      notes_markdown: await sanitizeMarkdownArtifactImages(
        this.stageArtifactsDir,
        String(record.id || ""),
        normalizeNullableString(record.notes_markdown),
      ),
      fusion_prompt_markdown: normalizeNullableString(record.fusion_prompt_markdown),
      stage_logs: stageLogs,
      stage_metrics: stageMetrics,
      vm_phase_metrics: vmPhaseMetrics,
      artifact_total_bytes: normalizeNonNegativeInteger(record.artifact_total_bytes),
      artifact_index: parseArtifactIndex(record.artifact_index_json),
      created_at: normalizeDate(record.created_at),
      updated_at: normalizeDate(record.updated_at),
    }
  }

  async getStoredRecord(taskId: string): Promise<StoredTaskRecord | null> {
    return this.getRecord(taskId)
  }

  async create(record: StoredTaskRecord): Promise<StoredTaskRecord> {
    const taskId = normalizeString(record.id)
    if (!taskId) {
      throw new Error("Task id is required")
    }
    if (await this.getRecord(taskId)) {
      throw new Error(`Task already exists: ${taskId}`)
    }

    const now = new Date().toISOString()
    const nextRecord = normalizeWritableRecord({
      ...record,
      id: taskId,
      created_at: normalizeNullableString(record.created_at) || now,
      updated_at: normalizeNullableString(record.updated_at) || now,
    })

    await writeJsonFile(this.recordPath(taskId), nextRecord)
    return (await this.getRecord(taskId)) as StoredTaskRecord
  }

  async update(taskId: string, patch: Partial<StoredTaskRecord>): Promise<StoredTaskRecord> {
    const record = await this.getRecord(taskId)
    if (!record) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const nextRecord = normalizeWritableRecord({
      ...record,
      ...patch,
      id: taskId,
      created_at: normalizeNullableString(record.created_at) || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await writeJsonFile(this.recordPath(taskId), nextRecord)
    return (await this.getRecord(taskId)) as StoredTaskRecord
  }

  async replace(record: StoredTaskRecord): Promise<StoredTaskRecord> {
    const taskId = normalizeString(record.id)
    if (!taskId) {
      throw new Error("Task id is required")
    }

    const nextRecord = normalizeWritableRecord({
      ...record,
      id: taskId,
      created_at: normalizeNullableString(record.created_at) || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await writeJsonFile(this.recordPath(taskId), nextRecord)
    return (await this.getRecord(taskId)) as StoredTaskRecord
  }

  async delete(taskId: string): Promise<boolean> {
    const targets = [
      this.recordPath(taskId),
      this.eventLogPath(taskId),
      this.stageArtifactsTaskDir(taskId),
      this.analysisResultsTaskDir(taskId),
      this.runtimeWarningsPath(taskId),
      this.stageMetricsPath(taskId),
      this.taskTempDir(taskId),
    ]

    let removed = false
    for (const target of targets) {
      removed = (await this.removeIfExists(target)) || removed
    }

    removed = (await this.removeTaskUploads(taskId)) || removed
    removed = (await this.removeTaskTraceLogs(taskId)) || removed

    return removed
  }

  async findReusableCompletedTask(input: {
    excludeTaskId?: string
    fileSizeBytes?: number
    sourceInput?: string
    sourceLocalPath?: string | null
    workflow: WorkflowType
  }): Promise<StoredTaskRecord | null> {
    const records = await this.listAllRecords()
    const sourceInput = normalizeNullableString(input.sourceInput)?.trim().toLowerCase() || ""
    const sourceLocalPath = normalizeNullableString(input.sourceLocalPath)?.trim().toLowerCase() || ""

    return (
      records.find((record) => {
        if (normalizeString(record.id) === normalizeString(input.excludeTaskId)) {
          return false
        }
        if (normalizeWorkflow(record.workflow) !== input.workflow) {
          return false
        }
        if (toPublicStatus(record.status) !== "completed") {
          return false
        }
        if (input.fileSizeBytes && normalizeNonNegativeInteger(record.file_size_bytes) !== input.fileSizeBytes) {
          return false
        }
        const recordSourceInput = normalizeNullableString(record.source_input)?.trim().toLowerCase() || ""
        const recordSourceLocalPath = normalizeNullableString(record.source_local_path)?.trim().toLowerCase() || ""
        return Boolean(
          (sourceLocalPath && recordSourceLocalPath === sourceLocalPath) ||
            (sourceInput && recordSourceInput === sourceInput),
        )
      }) || null
    )
  }

  async cloneTaskArtifacts(sourceTaskId: string, targetTaskId: string): Promise<void> {
    const sourceDir = this.stageArtifactsTaskDir(sourceTaskId)
    const targetDir = this.stageArtifactsTaskDir(targetTaskId)
    if (!(await pathExists(sourceDir))) {
      return
    }
    await rm(targetDir, { recursive: true, force: true })
    await ensureDirectory(path.dirname(targetDir))
    await cp(sourceDir, targetDir, { recursive: true })
  }

  async writeTaskArtifactText(taskId: string, relativePath: string, content: string): Promise<void> {
    const targetPath = this.resolveTaskArtifactWritePath(taskId, relativePath)
    await ensureDirectory(path.dirname(targetPath))
    await writeFile(targetPath, content, "utf8")
  }

  async copyTaskArtifactFile(taskId: string, relativePath: string, sourcePath: string): Promise<void> {
    const targetPath = this.resolveTaskArtifactWritePath(taskId, relativePath)
    await ensureDirectory(path.dirname(targetPath))
    await cp(sourcePath, targetPath, { force: true })
  }

  async readTaskArtifactText(taskId: string, relativePath: string): Promise<string | null> {
    const targetPath = this.resolveTaskArtifactWritePath(taskId, relativePath)
    try {
      return await readFile(targetPath, "utf8")
    } catch {
      return null
    }
  }

  async syncArtifactIndex(taskId: string): Promise<StoredTaskRecord> {
    const record = await this.getRecord(taskId)
    if (!record) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const updatedAt = new Date().toISOString()
    const artifactIndex = buildArtifactIndex({
      taskId,
      transcriptText: normalizeNullableString(record.transcript_text),
      transcriptSegmentsJson: normalizeNullableString(record.transcript_segments_json),
      summaryMarkdown: normalizeNullableString(record.summary_markdown),
      notesMarkdown: normalizeNullableString(record.notes_markdown),
      mindmapMarkdown: normalizeNullableString(record.mindmap_markdown),
      updatedAt,
    })

    return this.update(taskId, {
      artifact_index_json: artifactIndex.artifactIndexJson,
      artifact_total_bytes: artifactIndex.artifactTotalBytes,
      updated_at: updatedAt,
    })
  }

  async resolveSourceMediaPath(taskId: string): Promise<string | null> {
    const record = await this.getRecord(taskId)
    if (!record) {
      return null
    }
    return this.findSourceMediaPath(record)
  }

  async resolveOpenLocation(taskId: string): Promise<string | null> {
    const record = await this.getRecord(taskId)
    if (!record) {
      return null
    }

    const sourceMediaPath = await this.findSourceMediaPath(record)
    if (sourceMediaPath) {
      return path.dirname(sourceMediaPath)
    }

    const rawPath = normalizeNullableString(record.source_local_path)
    if (!rawPath) {
      return null
    }

    return path.dirname(rawPath)
  }

  resolveArtifactPath(taskId: string, relativePath: string): string {
    const normalized = String(relativePath || "").replace(/\\/g, "/").trim().replace(/^\/+/, "")
    if (!normalized || normalized.split("/").includes("..")) {
      throw new Error("Invalid artifact path")
    }

    const taskArtifactRoot = path.resolve(this.stageArtifactsDir, taskId)
    if (looksLikeStageArtifactPath(normalized)) {
      return resolveArtifactPathWithinRoot(taskArtifactRoot, normalized)
    }

    if (normalized.startsWith("frames/")) {
      return resolveArtifactPathWithinRoot(path.resolve(taskArtifactRoot, "D", "vqa-prewarm"), normalized)
    }

    return resolveArtifactPathWithinRoot(path.resolve(taskArtifactRoot, "D", "fusion"), normalized)
  }

  private recordPath(taskId: string): string {
    return path.join(this.recordsDir, `${taskId}.json`)
  }

  private stageArtifactsTaskDir(taskId: string): string {
    return path.join(this.stageArtifactsDir, taskId)
  }

  private analysisResultsTaskDir(taskId: string): string {
    return path.join(this.tasksRootDir, "analysis-results", taskId)
  }

  private runtimeWarningsPath(taskId: string): string {
    return path.join(this.tasksRootDir, "runtime-warnings", `${taskId}.jsonl`)
  }

  private stageMetricsPath(taskId: string): string {
    return path.join(this.tasksRootDir, "stage-metrics", `${taskId}.json`)
  }

  private eventLogPath(taskId: string): string {
    return path.join(this.eventLogsDir, `${taskId}.jsonl`)
  }

  private taskTempDir(taskId: string): string {
    return path.join(this.tempDir, taskId)
  }

  private async removeIfExists(targetPath: string): Promise<boolean> {
    if (!(await pathExists(targetPath))) {
      return false
    }
    await rm(targetPath, { recursive: true, force: true })
    return true
  }

  private async removeTaskUploads(taskId: string): Promise<boolean> {
    if (!(await pathExists(this.uploadDir))) {
      return false
    }

    let removed = false
    const entries = await readdir(this.uploadDir, { withFileTypes: true })
    await Promise.all(
      entries
        .filter((entry) => entry.name.startsWith(`${taskId}_`) || entry.name.startsWith(`${taskId}-`))
        .map(async (entry) => {
          await rm(path.join(this.uploadDir, entry.name), { recursive: true, force: true })
          removed = true
        }),
    )
    return removed
  }

  private async removeTaskTraceLogs(taskId: string): Promise<boolean> {
    if (!(await pathExists(this.traceLogsDir))) {
      return false
    }

    let removed = false
    const entries = await readdir(this.traceLogsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) {
        continue
      }

      const targetPath = path.join(this.traceLogsDir, entry.name)
      const raw = await readFile(targetPath, "utf8").catch(() => "")
      if (!raw || !traceLogBelongsToTask(raw, taskId)) {
        continue
      }

      await rm(targetPath, { force: true })
      removed = true
    }

    return removed
  }

  private resolveTaskArtifactWritePath(taskId: string, relativePath: string): string {
    const normalized = String(relativePath || "").replace(/\\/g, "/").trim().replace(/^\/+/, "")
    if (!normalized || normalized.split("/").includes("..")) {
      throw new Error("Invalid artifact path")
    }

    const artifactRoot = path.resolve(this.stageArtifactsDir, taskId)
    const targetPath = path.resolve(artifactRoot, normalized)
    if (targetPath !== artifactRoot && !isWithinRoot(artifactRoot, targetPath)) {
      throw new Error("Artifact path escaped task root")
    }
    return targetPath
  }

  private async getRecord(taskId: string): Promise<StoredTaskRecord | null> {
    const recordPath = this.recordPath(taskId)
    const payload = await readJsonFile<StoredTaskRecord | null>(recordPath, null)
    if (!payload || typeof payload !== "object") {
      return null
    }
    if (!normalizeString(payload.id || taskId)) {
      return null
    }
    return {
      ...payload,
      id: normalizeString(payload.id || taskId),
    }
  }

  private async listAllRecords(): Promise<StoredTaskRecord[]> {
    if (!(await pathExists(this.recordsDir))) {
      return []
    }

    const entries = await readdir(this.recordsDir, { withFileTypes: true })
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
        .map((entry) => this.getRecord(entry.name.replace(/\.json$/i, ""))),
    )

    return records.filter((record): record is StoredTaskRecord => Boolean(record))
  }

  private async findSourceMediaPath(record: StoredTaskRecord): Promise<string | null> {
    const candidates = await collectSourceMediaCandidates(record, this.uploadDir)
    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return candidate
      }
    }
    return null
  }
}

async function collectSourceMediaCandidates(record: StoredTaskRecord, uploadDir: string): Promise<string[]> {
  const candidates: string[] = []
  const sourceLocalPath = normalizeNullableString(record.source_local_path)
  if (sourceLocalPath) {
    candidates.push(path.normalize(sourceLocalPath))
  }

  const sourceInput = normalizeString(record.source_input)
  if (sourceInput && (normalizeSourceType(record.source_type) === "local_path" || looksLikeLocalMediaPath(sourceInput))) {
    candidates.push(path.normalize(sourceInput))
  }

  if (await pathExists(uploadDir)) {
    const entries = await readdir(uploadDir, { withFileTypes: true })
    const matchingFiles = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(`${normalizeString(record.id)}_`))
        .map(async (entry) => {
          const absolutePath = path.join(uploadDir, entry.name)
          const extension = path.extname(entry.name).toLowerCase()
          if (!ALLOWED_VIDEO_EXTENSIONS.has(extension)) {
            return null
          }
          const fileStat = await stat(absolutePath)
          return {
            absolutePath,
            modifiedAt: fileStat.mtimeMs,
          }
        }),
    )

    candidates.push(
      ...matchingFiles
        .filter((item): item is { absolutePath: string; modifiedAt: number } => Boolean(item))
        .sort((left, right) => right.modifiedAt - left.modifiedAt)
        .map((item) => item.absolutePath),
    )
  }

  return deduplicatePaths(candidates)
}

function deduplicatePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const candidate of paths) {
    const normalized = path.normalize(candidate)
    const dedupeKey = process.platform === "win32" ? normalized.toLowerCase() : normalized
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    items.push(normalized)
  }
  return items
}

function traceLogBelongsToTask(raw: string, taskId: string): boolean {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => {
      try {
        return payloadReferencesTaskId(JSON.parse(line) as unknown, taskId)
      } catch {
        return false
      }
    })
}

function payloadReferencesTaskId(value: unknown, taskId: string): boolean {
  if (!value || typeof value !== "object") {
    return false
  }

  if (Array.isArray(value)) {
    return value.some((item) => payloadReferencesTaskId(item, taskId))
  }

  return Object.entries(value).some(([key, entryValue]) => {
    if ((key === "task_id" || key === "taskId") && String(entryValue || "").trim() === taskId) {
      return true
    }
    return payloadReferencesTaskId(entryValue, taskId)
  })
}

function matchesQuery(record: StoredTaskRecord, q?: string): boolean {
  const keyword = String(q || "").trim().toLowerCase()
  if (!keyword) {
    return true
  }
  return [normalizeNullableString(record.title), normalizeNullableString(record.source_input)]
    .filter((item): item is string => Boolean(item))
    .some((item) => item.toLowerCase().includes(keyword))
}

function matchesWorkflow(record: StoredTaskRecord, workflow?: WorkflowType): boolean {
  if (!workflow) {
    return true
  }
  return normalizeWorkflow(record.workflow) === workflow
}

function matchesStatus(record: StoredTaskRecord, status?: string): boolean {
  const normalizedStatus = String(status || "").trim().toLowerCase()
  if (!normalizedStatus) {
    return true
  }
  return toPublicStatus(record.status) === normalizedStatus
}

function sortRecords(records: StoredTaskRecord[], sortBy: SortBy): void {
  if (sortBy === "name") {
    records.sort((left, right) => {
      const leftName = normalizeNullableString(left.title) || normalizeString(left.source_input)
      const rightName = normalizeNullableString(right.title) || normalizeString(right.source_input)
      return leftName.localeCompare(rightName, "zh-CN")
    })
    return
  }

  if (sortBy === "size") {
    records.sort((left, right) => normalizeNonNegativeInteger(right.file_size_bytes) - normalizeNonNegativeInteger(left.file_size_bytes))
    return
  }

  records.sort((left, right) => parseTimestamp(right.updated_at) - parseTimestamp(left.updated_at))
}

function toSummaryItem(record: StoredTaskRecord): TaskSummaryItem {
  return {
    id: normalizeString(record.id),
    title: normalizeNullableString(record.title),
    workflow: normalizeWorkflow(record.workflow),
    source_type: normalizeSourceType(record.source_type),
    source_input: normalizeString(record.source_input),
    status: toPublicStatus(record.status),
    progress: normalizeProgress(record.progress),
    file_size_bytes: normalizeNonNegativeInteger(record.file_size_bytes),
    duration_seconds: resolveEffectiveDurationSeconds(record),
    created_at: normalizeDate(record.created_at),
    updated_at: normalizeDate(record.updated_at),
  }
}

function normalizeString(value: unknown, fallback = ""): string {
  const candidate = String(value || "").trim()
  return candidate || fallback
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return String(value)
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 0), 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }
  return parsed
}

function normalizeProgress(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? 0), 10)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(100, parsed))
}

function parseTimestamp(value: unknown): number {
  const candidate = String(value || "").trim()
  const parsed = Date.parse(candidate)
  return Number.isNaN(parsed) ? 0 : parsed
}

function resolveEffectiveDurationSeconds(record: StoredTaskRecord): number | null {
  const durationSeconds = Number(record.duration_seconds)
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Number(durationSeconds.toFixed(2))
  }

  const transcriptSegments = parseTranscriptSegments(record.transcript_segments_json)
  if (transcriptSegments.length === 0) {
    return null
  }

  const maxEnd = Math.max(...transcriptSegments.map((segment) => Number(segment.end) || 0))
  if (maxEnd <= 0) {
    return null
  }

  return Number(maxEnd.toFixed(2))
}

function parseTranscriptSegments(raw: string | null | undefined): TranscriptSegment[] {
  if (!raw) {
    return []
  }

  try {
    const payload = JSON.parse(raw) as unknown
    if (!Array.isArray(payload)) {
      return []
    }
    const segments: TranscriptSegment[] = []
    for (const item of payload) {
      if (!item || typeof item !== "object") {
        continue
      }
      const segment = item as Record<string, unknown>
      segments.push({
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        text: normalizeString(segment.text),
        ...(segment.speaker !== undefined && segment.speaker !== null ? { speaker: String(segment.speaker) } : {}),
      })
    }
    return segments
  } catch {
    return []
  }
}

function buildVmPhaseMetrics(stageMetrics: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const toVmStatus = (metric: Record<string, unknown>): string => {
    const explicitStatus = String(metric.status || "").trim().toLowerCase()
    if (explicitStatus === "cancelled") {
      return "failed"
    }
    if (["pending", "running", "paused", "completed", "failed", "skipped"].includes(explicitStatus)) {
      return explicitStatus
    }
    if (metric.completed_at) {
      return "completed"
    }
    if (metric.started_at) {
      return "running"
    }
    return "pending"
  }

  const result: Record<string, Record<string, unknown>> = {}
  for (const stage of ["A", "B", "C"]) {
    const metric = stageMetrics[stage] || {}
    result[stage] = {
      status: toVmStatus(metric),
      started_at: metric.started_at ?? null,
      completed_at: metric.completed_at ?? null,
      elapsed_seconds: metric.elapsed_seconds ?? null,
      optional: false,
      reason: metric.reason ?? null,
    }
  }

  const dMetric = stageMetrics.D || {}
  const substageMetrics =
    dMetric.substage_metrics && typeof dMetric.substage_metrics === "object" && !Array.isArray(dMetric.substage_metrics)
      ? (dMetric.substage_metrics as Record<string, Record<string, unknown>>)
      : {}

  const transcriptOptimizeMetric = substageMetrics.transcript_optimize || {}
  result.transcript_optimize = {
    status: String(transcriptOptimizeMetric.status || "pending").trim().toLowerCase() || "pending",
    started_at: transcriptOptimizeMetric.started_at ?? null,
    completed_at: transcriptOptimizeMetric.completed_at ?? null,
    elapsed_seconds: transcriptOptimizeMetric.elapsed_seconds ?? null,
    optional: Boolean(transcriptOptimizeMetric.optional ?? true),
    reason: transcriptOptimizeMetric.reason ?? null,
  }

  const multimodalPrewarmMetric = substageMetrics.multimodal_prewarm || substageMetrics.multimodal_index_fusion || {}
  result.multimodal_prewarm = {
    status: String(multimodalPrewarmMetric.status || "pending").trim().toLowerCase() || "pending",
    started_at: multimodalPrewarmMetric.started_at ?? null,
    completed_at: multimodalPrewarmMetric.completed_at ?? null,
    elapsed_seconds: multimodalPrewarmMetric.elapsed_seconds ?? null,
    optional: Boolean(multimodalPrewarmMetric.optional ?? true),
    reason: multimodalPrewarmMetric.reason ?? null,
  }

  for (const key of ["transcript_vectorize", "frame_extract", "frame_semantic", "frame_vectorize", "multimodal_index_fusion"]) {
    const metric = substageMetrics[key] || {}
    result[key] = {
      status: String(metric.status || "pending").trim().toLowerCase() || "pending",
      started_at: metric.started_at ?? null,
      completed_at: metric.completed_at ?? null,
      elapsed_seconds: metric.elapsed_seconds ?? null,
      optional: Boolean(metric.optional ?? true),
      reason: metric.reason ?? null,
    }
  }

  const fusionMetric = substageMetrics.fusion_delivery || {}
  result.D = {
    status: String(fusionMetric.status || toVmStatus(dMetric)).trim().toLowerCase() || "pending",
    started_at: fusionMetric.started_at ?? dMetric.started_at ?? null,
    completed_at: fusionMetric.completed_at ?? dMetric.completed_at ?? null,
    elapsed_seconds: fusionMetric.elapsed_seconds ?? dMetric.elapsed_seconds ?? null,
    optional: false,
    reason: fusionMetric.reason ?? null,
  }

  return result
}

function buildStepsForWorkflow(
  workflow: WorkflowType,
  stageMetrics: Record<string, Record<string, unknown>>,
  overallProgress: number,
): TaskStepItem[] {
  return workflowStepBlueprint(workflow).map((step) => {
    const metric = resolveMetricForStep(step.id, stageMetrics)
    const status = metricToStepStatus(metric)
    return {
      id: step.id,
      name: step.name,
      status,
      progress: status === "completed" ? 100 : status === "processing" ? overallProgress : 0,
      duration: formatDuration(toOptionalNumber(metric.elapsed_seconds)),
      logs: [],
    }
  })
}

function workflowStepBlueprint(workflow: WorkflowType): Array<{ id: string; name: string }> {
  if (workflow === "vqa") {
    return [
      { id: "extract", name: "音频提取" },
      { id: "transcribe", name: "语音转写" },
      { id: "correct", name: "文本纠错" },
      { id: "ready", name: "问答就绪" },
    ]
  }

  return [
    { id: "extract", name: "音频提取" },
    { id: "transcribe", name: "语音转写" },
    { id: "correct", name: "文本纠错" },
    { id: "notes", name: "笔记生成" },
  ]
}

function resolveMetricForStep(
  stepId: string,
  stageMetrics: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const aMetric = stageMetrics.A || {}
  const bMetric = stageMetrics.B || {}
  const cMetric = stageMetrics.C || {}
  const dMetric = stageMetrics.D || {}
  const substageMetrics =
    dMetric.substage_metrics && typeof dMetric.substage_metrics === "object" && !Array.isArray(dMetric.substage_metrics)
      ? (dMetric.substage_metrics as Record<string, Record<string, unknown>>)
      : {}

  if (stepId === "extract") {
    return mergeStepMetrics(aMetric, bMetric)
  }
  if (stepId === "transcribe") {
    return cMetric
  }
  if (stepId === "correct") {
    return substageMetrics.transcript_optimize || {}
  }
  return substageMetrics.fusion_delivery || dMetric
}

function mergeStepMetrics(...metrics: Record<string, unknown>[]): Record<string, unknown> {
  const validMetrics = metrics.filter((metric) => Object.keys(metric).length > 0)
  if (validMetrics.length === 0) {
    return {}
  }

  const primary = [...validMetrics].sort((left, right) => statusRank(right) - statusRank(left))[0]
  const startedAt = validMetrics.map((metric) => String(metric.started_at || "")).filter(Boolean).sort()[0] || primary.started_at
  const completedCandidates = validMetrics.map((metric) => String(metric.completed_at || "")).filter(Boolean).sort()
  const completedAt = completedCandidates.at(-1) || primary.completed_at
  const elapsedTotal = validMetrics.reduce((total, metric) => total + (toOptionalNumber(metric.elapsed_seconds) || 0), 0)

  return {
    ...primary,
    started_at: startedAt,
    completed_at: completedAt,
    elapsed_seconds: elapsedTotal > 0 ? Number(elapsedTotal.toFixed(2)) : primary.elapsed_seconds,
  }
}

function statusRank(metric: Record<string, unknown>): number {
  const raw = String(metric.status || "").trim().toLowerCase()
  if (["failed", "error", "cancelled"].includes(raw)) {
    return 4
  }
  if (["running", "processing", "paused"].includes(raw)) {
    return 3
  }
  if (["completed", "done", "success", "skipped"].includes(raw)) {
    return 2
  }
  if (metric.started_at) {
    return 1
  }
  return 0
}

function metricToStepStatus(metric: Record<string, unknown>): TaskStepStatus {
  if (Object.keys(metric).length === 0) {
    return "pending"
  }
  const raw = String(metric.status || "").trim().toLowerCase()
  if (["failed", "error", "cancelled"].includes(raw)) {
    return "error"
  }
  if (raw === "paused") {
    return "processing"
  }
  if (["completed", "done", "success", "skipped"].includes(raw)) {
    return "completed"
  }
  if (["running", "processing"].includes(raw)) {
    return "processing"
  }
  if (metric.completed_at) {
    return "completed"
  }
  if (metric.started_at) {
    return "processing"
  }
  return "pending"
}

function resolveCurrentStepId(steps: TaskStepItem[]): string {
  const activeStep = steps.find((step) => step.status === "processing")
  if (activeStep) {
    return activeStep.id
  }
  return steps.find((step) => step.status !== "completed")?.id || steps[0]?.id || ""
}

function estimateEtaSeconds(
  status: string,
  progress: number,
  stageMetrics: Record<string, Record<string, unknown>>,
): number | null {
  if (status !== "running" || progress <= 0 || progress >= 100) {
    return null
  }

  const elapsed = STAGE_KEYS.reduce((total, stage) => total + (toOptionalNumber(stageMetrics[stage]?.elapsed_seconds) || 0), 0)
  if (elapsed <= 0) {
    return null
  }

  const estimatedTotal = elapsed * (100 / progress)
  return Math.max(0, Math.round(estimatedTotal - elapsed))
}

function parseArtifactIndex(raw: string | null | undefined): Array<Record<string, unknown>> {
  if (!raw) {
    return []
  }

  try {
    const payload = JSON.parse(raw) as unknown
    if (!Array.isArray(payload)) {
      return []
    }
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
  } catch {
    return []
  }
}

async function sanitizeMarkdownArtifactImages(
  stageArtifactsDir: string,
  taskId: string,
  markdown: string | null,
): Promise<string | null> {
  if (!markdown) {
    return markdown
  }

  const artifactRoot = path.resolve(stageArtifactsDir, taskId, "D", "fusion")
  let result = ""
  let lastIndex = 0

  for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const matchIndex = match.index ?? 0
    result += markdown.slice(lastIndex, matchIndex)

    const relativePath = normalizeMarkdownImagePath(match.groups?.path || "")
    if (!relativePath || relativePath.split("/").includes("..")) {
      lastIndex = matchIndex + match[0].length
      continue
    }

    const targetPath = path.resolve(artifactRoot, relativePath)
    if (!isWithinRoot(artifactRoot, targetPath) || !(await pathExists(targetPath))) {
      lastIndex = matchIndex + match[0].length
      continue
    }

    result += `${match[1]}${relativePath}${match[3]}`
    lastIndex = matchIndex + match[0].length
  }

  result += markdown.slice(lastIndex)
  return result
}

function normalizeMarkdownImagePath(value: string): string {
  let normalized = String(value || "").replace(/\\/g, "/").trim()
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2)
  }
  return normalized.replace(/^\/+/, "")
}

function looksLikeStageArtifactPath(value: string): boolean {
  return /^[A-Z]\//.test(value)
}

function resolveArtifactPathWithinRoot(root: string, relativePath: string): string {
  const targetPath = path.resolve(root, relativePath)
  if (targetPath !== root && !isWithinRoot(root, targetPath)) {
    throw new Error("Artifact path escaped task root")
  }
  return targetPath
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function looksLikeLocalMediaPath(value: string): boolean {
  const raw = String(value || "").trim()
  if (!raw || raw.includes("://")) {
    return false
  }
  if (raw.startsWith("\\\\") || raw.startsWith("~")) {
    return true
  }
  return path.isAbsolute(raw)
}

function toOptionalNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatDuration(elapsedSeconds: number | null): string {
  if (!elapsedSeconds || elapsedSeconds <= 0) {
    return ""
  }
  const totalSeconds = Math.round(elapsedSeconds)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function normalizeWritableRecord(record: StoredTaskRecord): StoredTaskRecord {
  return JSON.parse(JSON.stringify(record)) as StoredTaskRecord
}
