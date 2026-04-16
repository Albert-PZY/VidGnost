import { stat } from "node:fs/promises"

import type { TaskStatus, WorkflowType } from "@vidgnost/contracts"

import type { AsrService } from "../asr/asr-service.js"
import { EventBus } from "../events/event-bus.js"
import type { MediaPipelineService } from "../media/media-pipeline-service.js"
import type { SummaryService } from "../summary/summary-service.js"
import { RetrievalIndexService } from "../vqa/retrieval-index-service.js"
import { TaskRepository, type StoredTaskRecord } from "./task-repository.js"
import {
  buildArtifactIndex,
  inferActiveStage,
  normalizeWorkflow,
  parseStageLogs,
  parseStageMetrics,
  parseTranscriptSegments,
  toPublicTaskStatus as toPublicStatus,
} from "./task-support.js"

interface SubmitTaskInput {
  taskId: string
  sourceInput: string
  sourceLocalPath?: string | null
  workflow: WorkflowType
}

interface ActiveExecution {
  abortController: AbortController | null
  cancelled: boolean
  mode: "full" | "rerun-stage-d"
  pauseRequested: boolean
  resumeResolvers: Array<() => void>
}

interface TaskExecutionDependencies {
  asrService: AsrService
  mediaPipelineService: MediaPipelineService
  summaryService: SummaryService
}

export class TaskOrchestrator {
  private readonly activeExecutions = new Map<string, ActiveExecution>()
  private readonly retrievalIndexService = new RetrievalIndexService()

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly eventBus: EventBus,
    private readonly dependencies: TaskExecutionDependencies,
  ) {}

  async submit(input: SubmitTaskInput): Promise<void> {
    if (this.activeExecutions.has(input.taskId)) {
      return
    }

    const execution = this.createExecution("full")
    this.activeExecutions.set(input.taskId, execution)
    queueMicrotask(() => {
      void this.runFullTask(input, execution)
        .catch(async (error: unknown) => {
          if (error instanceof TaskCancelledError) {
            await this.failOrCancelTask(input.taskId, "task_cancelled", "任务已取消", "cancelled")
            return
          }
          await this.failOrCancelTask(input.taskId, "task_failed", toErrorMessage(error), "failed")
        })
        .finally(() => {
          this.activeExecutions.delete(input.taskId)
        })
    })
  }

  async rerunStageD(taskId: string): Promise<boolean> {
    if (this.activeExecutions.has(taskId)) {
      return false
    }

    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const execution = this.createExecution("rerun-stage-d")
    this.activeExecutions.set(taskId, execution)
    queueMicrotask(() => {
      void this.runStageDOnly(record, execution)
        .catch(async (error: unknown) => {
          if (error instanceof TaskCancelledError) {
            await this.failOrCancelTask(taskId, "task_cancelled", "任务已取消", "cancelled")
            return
          }
          await this.failOrCancelTask(taskId, "task_failed", toErrorMessage(error), "failed")
        })
        .finally(() => {
          this.activeExecutions.delete(taskId)
        })
    })
    return true
  }

  async cancel(taskId: string): Promise<boolean> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      return false
    }

    const execution = this.activeExecutions.get(taskId)
    if (execution) {
      execution.cancelled = true
      execution.pauseRequested = false
      execution.abortController?.abort()
      this.resolveExecution(execution)
      return true
    }

    if (toPublicStatus(record.status) === "paused") {
      await this.failOrCancelTask(taskId, "task_cancelled", "任务已取消", "cancelled")
      return true
    }

    return false
  }

  async pause(taskId: string): Promise<boolean> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      return false
    }

    const execution = this.activeExecutions.get(taskId)
    if (!execution || execution.pauseRequested) {
      return false
    }

    execution.pauseRequested = true
    await this.updateStageMetric({
      taskId,
      stage: inferActiveStage(record.stage_metrics_json),
      patch: {
        status: "paused",
      },
    })
    await this.taskRepository.update(taskId, {
      status: "paused",
    })
    await this.eventBus.publish(taskId, {
      type: "task_paused",
      task_id: taskId,
      message: "任务将在当前阶段执行完毕后暂停",
    })
    return true
  }

  async resume(taskId: string): Promise<boolean> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      return false
    }

    const execution = this.activeExecutions.get(taskId)
    if (!execution || !execution.pauseRequested) {
      return false
    }

    execution.pauseRequested = false
    await this.updateStageMetric({
      taskId,
      stage: inferActiveStage(record.stage_metrics_json),
      patch: {
        status: "running",
      },
    })
    await this.taskRepository.update(taskId, {
      status: "running",
    })
    await this.eventBus.publish(taskId, {
      type: "progress",
      task_id: taskId,
      overall_progress: Math.max(1, Number(record.progress) || 0),
    })
    this.resolveExecution(execution)
    return true
  }

  private createExecution(mode: ActiveExecution["mode"]): ActiveExecution {
    return {
      abortController: null,
      cancelled: false,
      mode,
      pauseRequested: false,
      resumeResolvers: [],
    }
  }

  private async runFullTask(input: SubmitTaskInput, execution: ActiveExecution): Promise<void> {
    const record = await this.taskRepository.getStoredRecord(input.taskId)
    if (!record) {
      return
    }

    await this.startStage(input.taskId, "A", "Source Ingestion", 3, "preparing")

    const reusableSource = await this.findReusableSource(record)
    if (reusableSource) {
      await this.completeStage(input.taskId, "A", 10, "已匹配可复用的历史输入")
      await this.startStage(input.taskId, "B", "Artifact Reuse", 15)
      await this.waitForControl(execution)
      await this.completeStage(input.taskId, "B", 25, `复用历史任务 ${reusableSource.id} 的已有工件`)
      await this.startStage(input.taskId, "C", "Transcript Restore", 30, "transcribing")
      await this.waitForControl(execution)
      await this.completeStage(input.taskId, "C", 68, "已复用历史转写结果")
      await this.runStageDReplay(input.taskId, execution, reusableSource)
      return
    }

    const preparedSource = await this.runAbortable(execution, (signal) =>
      this.dependencies.mediaPipelineService.prepareSource({
        taskId: input.taskId,
        sourceInput: input.sourceInput,
        sourceLocalPath: input.sourceLocalPath,
        signal,
      }),
    )

    await this.taskRepository.update(input.taskId, {
      duration_seconds: preparedSource.durationSeconds,
      file_size_bytes: preparedSource.fileSizeBytes,
      source_input: preparedSource.sourceLabel,
      source_local_path: preparedSource.mediaPath,
      title: normalizeNullableTitle(record.title) || preparedSource.title,
    })
    await this.appendStageLog(input.taskId, "A", `视频源已解析: ${preparedSource.mediaPath}`)
    await this.completeStage(input.taskId, "A", 12, "视频源检查完成")

    await this.startStage(input.taskId, "B", "Audio Extraction", 15)
    const audioArtifact = await this.runAbortable(execution, (signal) =>
      this.dependencies.mediaPipelineService.extractAudio({
        mediaPath: preparedSource.mediaPath,
        taskId: input.taskId,
        targetChannels: 1,
        targetSampleRate: 16000,
        signal,
      }),
    )
    await this.appendStageLog(input.taskId, "B", `音频提取完成: ${audioArtifact.audioPath}`)
    await this.completeStage(input.taskId, "B", 24, "音频提取完成")

    await this.startStage(input.taskId, "C", "Speech Transcription", 28, "transcribing")
    const transcription = await this.runAbortable(execution, (signal) =>
      this.dependencies.asrService.transcribe({
        audioPath: audioArtifact.audioPath,
        taskId: input.taskId,
        signal,
      }),
    )
    const transcriptSegmentsJson = JSON.stringify(transcription.segments)
    await this.taskRepository.update(input.taskId, {
      duration_seconds: preparedSource.durationSeconds || audioArtifact.durationSeconds,
      transcript_segments_json: transcriptSegmentsJson,
      transcript_text: transcription.text,
    })
    await this.taskRepository.writeTaskArtifactText(input.taskId, "C/transcript.txt", transcription.text)
    await this.taskRepository.writeTaskArtifactText(input.taskId, "C/transcript.segments.json", transcriptSegmentsJson)
    await this.appendStageLog(input.taskId, "C", `转写完成，共 ${transcription.segments.length} 个片段`)
    await this.completeStage(input.taskId, "C", 68, "语音转写完成")

    await this.runStageD(input.taskId, execution)
  }

  private async runStageDOnly(record: StoredTaskRecord, execution: ActiveExecution): Promise<void> {
    const taskId = String(record.id || "")
    if (!taskId) {
      return
    }

    await this.taskRepository.update(taskId, {
      error_message: null,
      progress: 68,
      status: "running",
    })
    await this.runStageD(taskId, execution)
  }

  private async runStageDReplay(taskId: string, execution: ActiveExecution, sourceRecord: StoredTaskRecord): Promise<void> {
    await this.waitForControl(execution)
    if (execution.cancelled) {
      throw new TaskCancelledError()
    }

    const sourceTaskId = String(sourceRecord.id || "")
    if (!sourceTaskId) {
      return
    }

    if (sourceTaskId !== taskId) {
      await this.taskRepository.cloneTaskArtifacts(sourceTaskId, taskId)
      await this.copyCompletedRecord(sourceTaskId, taskId)
    }

    await this.completeStage(taskId, "D", 100, `已复用历史任务 ${sourceTaskId} 的笔记、摘要与导图`)
    await this.taskRepository.update(taskId, {
      error_message: null,
      progress: 100,
      status: "completed",
    })
    await this.eventBus.publish(taskId, {
      type: "task_complete",
      task_id: taskId,
      overall_progress: 100,
      status: "completed",
      message: "任务已完成",
    })
  }

  private async runStageD(taskId: string, execution: ActiveExecution): Promise<void> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      return
    }

    const transcriptSegments = parseTranscriptSegments(record.transcript_segments_json)
    const transcriptText =
      String(record.transcript_text || "").trim() || transcriptSegments.map((item) => item.text).join("\n").trim()
    if (!transcriptText) {
      throw new Error("Task transcript is empty")
    }

    await this.startStage(taskId, "D", "Detailed Notes and Mindmap Generation", 72, "summarizing")
    await this.startSubstage(taskId, "transcript_optimize", "转录文本优化", 78)
    const artifacts = await this.runAbortable(execution, () =>
      this.dependencies.summaryService.buildArtifacts({
        taskId,
        taskTitle: normalizeNullableTitle(record.title) || taskId,
        transcriptSegments,
        transcriptText,
        workflow: normalizeWorkflow(record.workflow),
      }),
    )
    await this.completeSubstage(taskId, "transcript_optimize", 84, "转录文本优化完成")

    await this.startSubstage(taskId, "fusion_delivery", "融合生成与交付", 90)
    await this.taskRepository.update(taskId, {
      fusion_prompt_markdown: artifacts.fusionPromptMarkdown,
      mindmap_markdown: artifacts.mindmapMarkdown,
      notes_markdown: artifacts.notesMarkdown,
      summary_markdown: artifacts.summaryMarkdown,
      transcript_segments_json: JSON.stringify(artifacts.correctedSegments),
      transcript_text: artifacts.correctedText,
    })

    await this.taskRepository.writeTaskArtifactText(taskId, "C/transcript.txt", artifacts.correctedText)
    await this.taskRepository.writeTaskArtifactText(
      taskId,
      "C/transcript.segments.json",
      JSON.stringify(artifacts.correctedSegments, null, 2),
    )
    await this.taskRepository.writeTaskArtifactText(taskId, "D/transcript-optimize/index.json", artifacts.correctionIndexJson)
    await this.taskRepository.writeTaskArtifactText(taskId, "D/transcript-optimize/full.txt", artifacts.correctionFullText)
    await this.taskRepository.writeTaskArtifactText(
      taskId,
      "D/transcript-optimize/strict-segments.json",
      artifacts.correctionStrictSegmentsJson || "[]",
    )
    await this.taskRepository.writeTaskArtifactText(
      taskId,
      "D/transcript-optimize/rewrite.txt",
      artifacts.correctionRewriteText,
    )
    await this.taskRepository.writeTaskArtifactText(taskId, "D/fusion/summary.md", artifacts.summaryMarkdown)
    await this.taskRepository.writeTaskArtifactText(taskId, "D/fusion/notes.md", artifacts.notesMarkdown)
    await this.taskRepository.writeTaskArtifactText(taskId, "D/fusion/mindmap.md", artifacts.mindmapMarkdown)
    await this.taskRepository.writeTaskArtifactText(taskId, "D/fusion/fusion-prompt.md", artifacts.fusionPromptMarkdown)
    await this.taskRepository.writeTaskArtifactText(taskId, "D/fusion/manifest.json", artifacts.artifactManifestJson)

    const artifactIndex = buildArtifactIndex({
      taskId,
      transcriptText: artifacts.correctedText,
      transcriptSegmentsJson: JSON.stringify(artifacts.correctedSegments),
      summaryMarkdown: artifacts.summaryMarkdown,
      notesMarkdown: artifacts.notesMarkdown,
      mindmapMarkdown: artifacts.mindmapMarkdown,
      updatedAt: new Date().toISOString(),
    })
    await this.taskRepository.update(taskId, {
      artifact_index_json: artifactIndex.artifactIndexJson,
      artifact_total_bytes: artifactIndex.artifactTotalBytes,
    })
    await this.taskRepository.syncArtifactIndex(taskId)
    if (artifacts.fallbackArtifactChannels.length > 0) {
      await this.appendStageLog(taskId, "D", `融合生成已回退：${artifacts.fallbackArtifactChannels.join(", ")}`)
    }
    if (normalizeWorkflow(record.workflow) === "vqa") {
      const prewarmIndex = await this.retrievalIndexService.buildIndexAsync({
        taskId,
        taskTitle: normalizeNullableTitle(record.title) || taskId,
        transcriptSegments: artifacts.correctedSegments,
        transcriptText: artifacts.correctedText,
      })
      await this.taskRepository.writeTaskArtifactText(taskId, "D/vqa-prewarm/index.json", prewarmIndex.indexJson)
      await this.appendStageLog(taskId, "D", `VQA 检索索引预热完成，共 ${prewarmIndex.item_count} 条证据`)
    }
    await this.completeSubstage(taskId, "fusion_delivery", 100, "笔记、摘要与导图已生成")

    await this.taskRepository.update(taskId, {
      error_message: null,
      progress: 100,
      status: "completed",
    })
    await this.eventBus.publish(taskId, {
      type: "task_complete",
      task_id: taskId,
      overall_progress: 100,
      status: "completed",
      message: "任务已完成",
    })
  }

  private async copyCompletedRecord(sourceTaskId: string, targetTaskId: string): Promise<void> {
    const source = await this.taskRepository.getStoredRecord(sourceTaskId)
    if (!source) {
      return
    }
    const target = await this.taskRepository.getStoredRecord(targetTaskId)
    if (!target) {
      return
    }

    await this.taskRepository.update(targetTaskId, {
      artifact_index_json: source.artifact_index_json,
      artifact_total_bytes: source.artifact_total_bytes,
      duration_seconds: source.duration_seconds,
      fusion_prompt_markdown: source.fusion_prompt_markdown,
      mindmap_markdown: source.mindmap_markdown,
      notes_markdown: source.notes_markdown,
      stage_logs_json: source.stage_logs_json,
      stage_metrics_json: source.stage_metrics_json,
      summary_markdown: source.summary_markdown,
      title: target.title || source.title,
      transcript_segments_json: source.transcript_segments_json,
      transcript_text: source.transcript_text,
    })
  }

  private async findReusableSource(record: StoredTaskRecord): Promise<StoredTaskRecord | null> {
    const sourceLocalPath = String(record.source_local_path || "").trim()
    let fileSizeBytes = Number(record.file_size_bytes) || 0
    if (sourceLocalPath && fileSizeBytes <= 0) {
      try {
        const fileStat = await stat(sourceLocalPath)
        fileSizeBytes = fileStat.size
      } catch {
        fileSizeBytes = 0
      }
    }

    return this.taskRepository.findReusableCompletedTask({
      excludeTaskId: String(record.id || ""),
      fileSizeBytes: fileSizeBytes > 0 ? fileSizeBytes : undefined,
      sourceInput: String(record.source_input || ""),
      sourceLocalPath: sourceLocalPath || null,
      workflow: normalizeWorkflow(record.workflow),
    })
  }

  private async runAbortable<T>(
    execution: ActiveExecution,
    runner: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    await this.waitForControl(execution)
    if (execution.cancelled) {
      throw new TaskCancelledError()
    }

    const controller = new AbortController()
    execution.abortController = controller
    try {
      return await runner(controller.signal)
    } catch (error) {
      if (controller.signal.aborted || execution.cancelled) {
        throw new TaskCancelledError()
      }
      throw error
    } finally {
      if (execution.abortController === controller) {
        execution.abortController = null
      }
    }
  }

  private async startStage(
    taskId: string,
    stage: "A" | "B" | "C" | "D",
    title: string,
    overallProgress: number,
    status: TaskStatus | undefined = "running",
  ): Promise<void> {
    await this.updateStageMetric({
      taskId,
      stage,
      patch: {
        status: "running",
        started_at: new Date().toISOString(),
        completed_at: null,
        reason: null,
      },
    })
    await this.taskRepository.update(taskId, {
      error_message: null,
      progress: overallProgress,
      status: status || "running",
    })
    await this.appendStageLog(taskId, stage, `Stage ${stage} started: ${title}`)
    await this.eventBus.publish(taskId, {
      type: "stage_start",
      task_id: taskId,
      stage,
      title,
      overall_progress: overallProgress,
      status,
    })
  }

  private async completeStage(
    taskId: string,
    stage: "A" | "B" | "C" | "D",
    overallProgress: number,
    message: string,
  ): Promise<void> {
    await this.updateStageMetric({
      taskId,
      stage,
      patch: {
        status: "completed",
        completed_at: new Date().toISOString(),
        reason: null,
      },
    })
    await this.appendStageLog(taskId, stage, message)
    await this.taskRepository.update(taskId, {
      progress: overallProgress,
      status: overallProgress >= 100 ? "completed" : "running",
    })
    await this.eventBus.publish(taskId, {
      type: "stage_complete",
      task_id: taskId,
      stage,
      overall_progress: overallProgress,
      stage_progress: 100,
      status: "completed",
      message,
    })
    await this.eventBus.publish(taskId, {
      type: "progress",
      task_id: taskId,
      stage,
      overall_progress: overallProgress,
      stage_progress: 100,
    })
  }

  private async startSubstage(taskId: string, substage: string, title: string, overallProgress: number): Promise<void> {
    await this.updateStageMetric({
      taskId,
      stage: "D",
      substage,
      patch: {
        status: "running",
        started_at: new Date().toISOString(),
        completed_at: null,
        reason: null,
      },
    })
    await this.taskRepository.update(taskId, {
      progress: overallProgress,
      status: "running",
    })
    await this.eventBus.publish(taskId, {
      type: "substage_start",
      task_id: taskId,
      stage: "D",
      substage,
      title,
      overall_progress: overallProgress,
    })
  }

  private async completeSubstage(
    taskId: string,
    substage: string,
    overallProgress: number,
    message: string,
  ): Promise<void> {
    await this.updateStageMetric({
      taskId,
      stage: "D",
      substage,
      patch: {
        status: "completed",
        completed_at: new Date().toISOString(),
        reason: null,
      },
    })
    await this.taskRepository.update(taskId, {
      progress: overallProgress,
      status: overallProgress >= 100 ? "completed" : "running",
    })
    await this.eventBus.publish(taskId, {
      type: "substage_complete",
      task_id: taskId,
      stage: "D",
      substage,
      overall_progress: overallProgress,
      status: "completed",
      message,
    })
  }

  private async failOrCancelTask(
    taskId: string,
    eventType: "task_cancelled" | "task_failed",
    message: string,
    status: "cancelled" | "failed",
  ): Promise<void> {
    await this.taskRepository.update(taskId, {
      error_message: status === "failed" ? message : null,
      status,
    })
    await this.updateStageMetric({
      taskId,
      stage: await this.resolveActiveStage(taskId),
      patch: {
        status,
        completed_at: new Date().toISOString(),
        reason: message,
      },
    })
    await this.eventBus.publish(taskId, {
      type: eventType,
      task_id: taskId,
      overall_progress: 0,
      message,
      status,
      error: status === "failed" ? message : undefined,
    })
  }

  private async appendStageLog(taskId: string, stage: string, message: string): Promise<void> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      return
    }

    const stageLogs = parseStageLogs(record.stage_logs_json)
    stageLogs[stage] = [...(stageLogs[stage] || []), `[${new Date().toISOString()}] ${message}`]
    await this.taskRepository.update(taskId, {
      stage_logs_json: JSON.stringify(stageLogs),
    })
    await this.eventBus.publish(taskId, {
      type: "log",
      task_id: taskId,
      stage,
      message,
    })
  }

  private async waitForControl(execution: ActiveExecution): Promise<void> {
    while (execution.pauseRequested && !execution.cancelled) {
      await new Promise<void>((resolve) => {
        execution.resumeResolvers.push(resolve)
      })
    }
    if (execution.cancelled) {
      throw new TaskCancelledError()
    }
  }

  private resolveExecution(execution: ActiveExecution): void {
    while (execution.resumeResolvers.length > 0) {
      execution.resumeResolvers.shift()?.()
    }
  }

  private async resolveActiveStage(taskId: string): Promise<string> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    return inferActiveStage(record?.stage_metrics_json)
  }

  private async updateStageMetric(input: {
    stage: string
    taskId: string
    substage?: string
    patch: Record<string, unknown>
  }): Promise<void> {
    const record = await this.taskRepository.getStoredRecord(input.taskId)
    if (!record) {
      return
    }

    const stageMetrics = parseStageMetrics(record.stage_metrics_json)
    const stageKey = String(input.stage || "").trim() || "A"
    const stageMetric = {
      ...(stageMetrics[stageKey] || {}),
    }

    if (input.substage) {
      const substageMetrics =
        stageMetric.substage_metrics && typeof stageMetric.substage_metrics === "object" && !Array.isArray(stageMetric.substage_metrics)
          ? { ...(stageMetric.substage_metrics as Record<string, Record<string, unknown>>) }
          : {}
      const currentSubstageMetric = { ...(substageMetrics[input.substage] || {}) }
      substageMetrics[input.substage] = {
        ...currentSubstageMetric,
        ...input.patch,
      }
      stageMetric.substage_metrics = substageMetrics
      if (!("status" in input.patch) && stageMetric.status === "pending") {
        stageMetric.status = "running"
      }
    } else {
      Object.assign(stageMetric, input.patch)
    }

    stageMetrics[stageKey] = stageMetric
    await this.taskRepository.update(input.taskId, {
      stage_metrics_json: JSON.stringify(stageMetrics),
    })
  }
}

class TaskCancelledError extends Error {
  constructor() {
    super("Task cancelled")
    this.name = "TaskCancelledError"
  }
}

function normalizeNullableTitle(value: unknown): string | null {
  const candidate = String(value || "").trim()
  return candidate || null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "任务执行失败"
}
