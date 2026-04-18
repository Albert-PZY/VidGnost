import { stat } from "node:fs/promises"

import type { TaskStatus, WorkflowType } from "@vidgnost/contracts"

import type { AsrChunkResult, AsrService } from "../asr/asr-service.js"
import { EventBus } from "../events/event-bus.js"
import type { MediaPipelineService } from "../media/media-pipeline-service.js"
import type { VideoFrameService } from "../media/video-frame-service.js"
import type { SummaryService } from "../summary/summary-service.js"
import type { TranscriptCorrectionPreviewEvent } from "../summary/transcript-correction-service.js"
import { RetrievalIndexService, type FrameSemanticSegment } from "../vqa/retrieval-index-service.js"
import type { VlmRuntimeService } from "../vqa/vlm-runtime-service.js"
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
  completion: Promise<void>
  mode: "full" | "rerun-stage-d"
  pauseRequested: boolean
  resumeResolvers: Array<() => void>
  resolveCompletion: () => void
}

interface TaskExecutionDependencies {
  asrService: AsrService
  mediaPipelineService: MediaPipelineService
  summaryService: SummaryService
  videoFrameService?: VideoFrameService
  vlmRuntimeService?: VlmRuntimeService
}

interface VqaMultimodalPrewarmArtifact {
  task_id: string
  mode: "multimodal"
  entries: Array<{
    artifact_path: string
    modality: "text" | "image"
    kind: "retrieval_index" | "frame_manifest" | "frame_semantic"
  }>
  generated_at: string
}

export class TaskOrchestrator {
  private readonly activeExecutions = new Map<string, ActiveExecution>()
  private readonly retrievalIndexService: RetrievalIndexService

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly eventBus: EventBus,
    private readonly dependencies: TaskExecutionDependencies,
  ) {
    this.retrievalIndexService = new RetrievalIndexService()
  }

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
          execution.resolveCompletion()
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
          execution.resolveCompletion()
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
    execution.abortController?.abort()
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

  async cancelAndWait(taskId: string): Promise<boolean> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      return false
    }

    const execution = this.activeExecutions.get(taskId)
    if (!execution) {
      return true
    }

    execution.cancelled = true
    execution.pauseRequested = false
    execution.abortController?.abort()
    this.resolveExecution(execution)
    await execution.completion
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
    let resolveCompletion: () => void = () => {}
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    return {
      abortController: null,
      cancelled: false,
      completion,
      mode,
      pauseRequested: false,
      resumeResolvers: [],
      resolveCompletion,
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
      const shouldReuseStageDOutputs = await this.shouldReuseStageDOutputs(reusableSource)
      await this.completeStage(input.taskId, "A", 10, "已匹配可复用的历史输入")
      await this.startStage(input.taskId, "B", "Artifact Reuse", 15)
      await this.waitForControl(execution)
      await this.completeStage(input.taskId, "B", 25, `复用历史任务 ${reusableSource.id} 的已有工件`)
      await this.startStage(input.taskId, "C", "Transcript Restore", 30, "transcribing")
      await this.waitForControl(execution)
      await this.completeStage(input.taskId, "C", 68, "已复用历史转写结果")
      if (shouldReuseStageDOutputs) {
        await this.runStageDReplay(input.taskId, execution, reusableSource)
        return
      }

      await this.prepareReusableTranscriptState(input.taskId, reusableSource)
      await this.appendStageLog(
        input.taskId,
        "D",
        `历史任务 ${reusableSource.id} 的融合产物包含回退结果，已基于复用转写重新生成阶段 D`,
      )
      await this.runStageD(input.taskId, execution)
      return
    }

    const preparedSource = await this.runControllable(execution, (signal) =>
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
    const audioArtifact = await this.runControllable(execution, (signal) =>
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
    const transcriptProgressState = { lastStageProgress: 0 }
    const transcription = await this.runControllable(execution, (signal) =>
      this.dependencies.asrService.transcribe({
        audioPath: audioArtifact.audioPath,
        onLog: async (message) => {
          await this.appendStageLog(input.taskId, "C", message)
        },
        onReset: async () => {
          transcriptProgressState.lastStageProgress = 0
          await this.publishTranscriptReset(input.taskId)
        },
        onSegment: async (segment) => {
          await this.eventBus.publish(input.taskId, {
            type: "transcript_delta",
            task_id: input.taskId,
            start: segment.start,
            end: segment.end,
            text: segment.text,
          })
          await this.publishTranscriptSegmentProgress(
            input.taskId,
            segment.end,
            audioArtifact.durationSeconds,
            transcriptProgressState,
          )
        },
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
    await this.writeTranscriptChunkArtifacts(input.taskId, transcription.chunks || [])
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

    const workflow = normalizeWorkflow(record.workflow)

    await this.startStage(taskId, "D", "Detailed Notes and Mindmap Generation", 72, "summarizing")
    await this.startSubstage(taskId, "transcript_optimize", "转录文本优化", 78)
    const artifacts = await this.runControllable(execution, () =>
      this.dependencies.summaryService.buildArtifacts({
        onCorrectionPreviewEvent: async (event) => {
          await this.publishCorrectionPreviewEvent(taskId, event)
        },
        taskId,
        taskTitle: normalizeNullableTitle(record.title) || taskId,
        transcriptSegments,
        transcriptText,
        workflow,
      }),
    )
    await this.completeSubstage(taskId, "transcript_optimize", 84, "转录文本优化完成")

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
    if (workflow === "vqa") {
      await this.startSubstage(taskId, "multimodal_prewarm", "多模态问答预热", 86)
      await this.startSubstage(taskId, "transcript_vectorize", "文本向量化", 86)
      const transcriptItems = await this.retrievalIndexService.buildTranscriptItemsAsync({
        taskId,
        taskTitle: normalizeNullableTitle(record.title) || taskId,
        transcriptSegments: artifacts.correctedSegments,
        transcriptText: artifacts.correctedText,
      })
      await this.completeSubstage(taskId, "transcript_vectorize", 89, `文本证据向量化完成，共 ${transcriptItems.length} 条`)

      await this.startSubstage(taskId, "frame_extract", "视频抽帧", 90)
      const mediaPath = String(record.source_local_path || "").trim()
      const framesResult = await this.buildFrameArtifacts(taskId, mediaPath, execution)
      await this.completeSubstage(
        taskId,
        "frame_extract",
        92,
        framesResult ? `视频抽帧完成，共 ${framesResult.manifest.frames.length} 帧` : "视频抽帧失败，已回退纯文本检索",
      )

      await this.startSubstage(taskId, "frame_semantic", "画面语义识别", 92)
      const frameSemanticResult = await this.buildFrameSemanticArtifacts(taskId, framesResult?.manifest.frames || [], execution)
      await this.completeSubstage(
        taskId,
        "frame_semantic",
        94,
        frameSemanticResult.segments.length > 0
          ? `画面语义识别完成，共 ${frameSemanticResult.segments.length} 条`
          : "未生成画面语义证据，已回退纯文本召回",
      )

      await this.startSubstage(taskId, "multimodal_index_fusion", "多模态融合索引", 95)
      const frameSemanticItems = await this.retrievalIndexService.buildFrameSemanticItemsAsync({
        taskId,
        taskTitle: normalizeNullableTitle(record.title) || taskId,
        frameSemanticSegments: frameSemanticResult.segments,
      })
      const prewarmIndex = this.retrievalIndexService.buildIndexFromItems([
        ...transcriptItems,
        ...frameSemanticItems,
      ])
      await this.taskRepository.writeTaskArtifactText(taskId, "D/vqa-prewarm/index.json", prewarmIndex.indexJson)
      const multimodalArtifact = buildMultimodalPrewarmArtifact(taskId)
      await this.taskRepository.writeTaskArtifactText(
        taskId,
        "D/vqa-prewarm/multimodal/index.json",
        JSON.stringify(multimodalArtifact, null, 2),
      )
      await this.taskRepository.writeTaskArtifactText(
        taskId,
        "D/vqa-prewarm/multimodal/manifest.json",
        JSON.stringify({
          mode: multimodalArtifact.mode,
          artifact_paths: multimodalArtifact.entries.map((entry) => entry.artifact_path),
          generated_at: multimodalArtifact.generated_at,
        }, null, 2),
      )
      await this.appendStageLog(taskId, "D", `VQA 检索索引预热完成，共 ${prewarmIndex.item_count} 条证据`)
      await this.completeSubstage(taskId, "multimodal_index_fusion", 96, "多模态融合索引已生成")
      await this.completeSubstage(taskId, "multimodal_prewarm", 96, "多模态预热入口已就绪")
      await this.startSubstage(taskId, "fusion_delivery", "融合生成与交付", 97)
    } else {
      await this.startSubstage(taskId, "fusion_delivery", "融合生成与交付", 90)
      await this.updateStageMetric({
        taskId,
        stage: "D",
        substage: "multimodal_prewarm",
        patch: {
          status: "skipped",
          completed_at: new Date().toISOString(),
          reason: "workflow_not_vqa",
        },
      })
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

  private async shouldReuseStageDOutputs(sourceRecord: StoredTaskRecord): Promise<boolean> {
    const llmGenerationEnabled = await this.dependencies.summaryService.isLlmGenerationEnabled()
    if (!llmGenerationEnabled) {
      return true
    }

    const sourceTaskId = String(sourceRecord.id || "")
    if (!sourceTaskId) {
      return true
    }

    const manifestRaw = await this.taskRepository.readTaskArtifactText(sourceTaskId, "D/fusion/manifest.json")
    if (!manifestRaw) {
      return true
    }

    try {
      const manifest = JSON.parse(manifestRaw) as Record<string, { generated_by?: string }>
      return !Object.values(manifest).some((artifact) => String(artifact?.generated_by || "").trim() === "fallback")
    } catch {
      return true
    }
  }

  private async prepareReusableTranscriptState(taskId: string, sourceRecord: StoredTaskRecord): Promise<void> {
    const sourceTaskId = String(sourceRecord.id || "")
    if (!sourceTaskId) {
      return
    }

    if (sourceTaskId !== taskId) {
      await this.taskRepository.cloneTaskArtifacts(sourceTaskId, taskId, {
        stages: ["A", "B", "C"],
      })
    }

    await this.taskRepository.update(taskId, {
      duration_seconds: sourceRecord.duration_seconds,
      transcript_segments_json: sourceRecord.transcript_segments_json,
      transcript_text: sourceRecord.transcript_text,
      title: normalizeNullableTitle(sourceRecord.title),
    })
  }

  private async buildFrameArtifacts(
    taskId: string,
    mediaPath: string,
    execution: ActiveExecution,
  ): Promise<{
    manifest: {
      frames: Array<{
        frame_index: number
        is_fallback?: boolean
        path: string
        timestamp_seconds: number
      }>
    }
  } | null> {
    if (!this.dependencies.videoFrameService || !mediaPath) {
      return null
    }

    try {
      const result = await this.runControllable(execution, (signal) =>
        this.dependencies.videoFrameService!.extractFrames({
          taskId,
          mediaPath,
          outputRootDir: this.taskRepository.resolveArtifactPath(taskId, "D/vqa-prewarm"),
          intervalSeconds: 4,
          signal,
        }),
      )
      await this.taskRepository.writeTaskArtifactText(taskId, "D/vqa-prewarm/frames/manifest.json", result.manifestJson)
      return {
        manifest: result.manifest,
      }
    } catch (error) {
      await this.appendStageLog(taskId, "D", `视频抽帧失败，已降级为纯文本检索：${toErrorMessage(error)}`)
      return null
    }
  }

  private async buildFrameSemanticArtifacts(
    taskId: string,
    frames: Array<{
      frame_index: number
      is_fallback?: boolean
      path: string
      timestamp_seconds: number
    }>,
    execution: ActiveExecution,
  ): Promise<{ segments: FrameSemanticSegment[] }> {
    if (frames.length === 0) {
      await this.taskRepository.writeTaskArtifactText(
        taskId,
        "D/vqa-prewarm/frame-semantic/index.json",
        JSON.stringify({
          task_id: taskId,
          item_count: 0,
          items: [],
          generated_at: new Date().toISOString(),
        }, null, 2),
      )
      return { segments: [] }
    }

    const segments: FrameSemanticSegment[] = []
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index]
      let visualText = buildFallbackFrameSemanticText(frame.frame_index, frame.timestamp_seconds)
      if (!frame.is_fallback && this.dependencies.vlmRuntimeService) {
        const frameUri = this.taskRepository.resolveArtifactPath(taskId, `D/vqa-prewarm/${frame.path}`)
        try {
          const described = await this.runControllable(execution, () =>
            this.dependencies.vlmRuntimeService!.describeFrame({
              imageUrl: pathToFileUrl(frameUri),
              userPrompt: "请用一句中文描述该帧的关键信息，聚焦人物、动作、字幕与场景。",
            }),
          )
          visualText = String(described.content || "").trim() || visualText
        } catch (error) {
          await this.appendStageLog(taskId, "D", `VLM 帧语义识别失败，已回退模板描述：${toErrorMessage(error)}`)
        }
      }
      segments.push({
        start: frame.timestamp_seconds,
        end: frame.timestamp_seconds,
        text: visualText,
        visual_text: visualText,
        image_path: frame.path,
        frame_index: frame.frame_index,
        frame_timestamp: frame.timestamp_seconds,
      })
    }

    await this.taskRepository.writeTaskArtifactText(
      taskId,
      "D/vqa-prewarm/frame-semantic/index.json",
      JSON.stringify({
        task_id: taskId,
        item_count: segments.length,
        items: segments.map((segment) => ({
          image_path: segment.image_path,
          visual_text: segment.visual_text,
          start: segment.start,
          end: segment.end,
          frame_index: segment.frame_index,
          frame_timestamp: segment.frame_timestamp,
        })),
        generated_at: new Date().toISOString(),
      }, null, 2),
    )
    return { segments }
  }

  private async writeTranscriptChunkArtifacts(taskId: string, chunks: AsrChunkResult[] | undefined): Promise<void> {
    if (!chunks || !chunks.length) {
      return
    }

    const chunkEntries: Array<{ relative_path: string }> = []
    for (const chunk of chunks) {
      const relativePath = `C/transcript/chunks/chunk-${String(chunk.index + 1).padStart(3, "0")}.json`
      chunkEntries.push({ relative_path: relativePath })
      await this.taskRepository.writeTaskArtifactText(
        taskId,
        relativePath,
        JSON.stringify({
          chunk_index: chunk.index,
          duration_seconds: chunk.durationSeconds,
          segments: chunk.segments,
          start_seconds: chunk.startSeconds,
        }, null, 2),
      )
    }

    await this.taskRepository.writeTaskArtifactText(
      taskId,
      "C/transcript/index.json",
      JSON.stringify({
        chunks: chunkEntries,
        generated_at: new Date().toISOString(),
        mode: chunks.length > 1 ? "chunked" : "single",
      }, null, 2),
    )
  }

  private async publishTranscriptReset(taskId: string): Promise<void> {
    await this.eventBus.publish(taskId, {
      type: "transcript_delta",
      task_id: taskId,
      reset: true,
    })
  }

  private async publishTranscriptSegmentProgress(
    taskId: string,
    segmentEndSeconds: number,
    durationSeconds: number,
    state: { lastStageProgress: number },
  ): Promise<void> {
    const safeDurationSeconds = Math.max(1, Number(durationSeconds) || 0)
    const ratio = Math.max(0, Math.min(1, (Number(segmentEndSeconds) || 0) / safeDurationSeconds))
    const stageProgress = Math.max(1, Math.round(ratio * 100))
    if (stageProgress <= state.lastStageProgress) {
      return
    }
    state.lastStageProgress = stageProgress
    const overallProgress = Math.min(67, 28 + Math.round(ratio * 39))
    await this.taskRepository.update(taskId, {
      progress: overallProgress,
      status: "running",
    })
    await this.eventBus.publish(taskId, {
      type: "progress",
      task_id: taskId,
      stage: "C",
      overall_progress: overallProgress,
      stage_progress: stageProgress,
    })
  }

  private async publishCorrectionPreviewEvent(
    taskId: string,
    event: TranscriptCorrectionPreviewEvent,
  ): Promise<void> {
    await this.eventBus.publish(taskId, {
      type: "transcript_optimized_preview",
      task_id: taskId,
      done: event.done,
      fallback_used: event.fallbackUsed,
      mode: event.mode,
      reset: event.reset,
      ...(event.segment ? {
        end: event.segment.end,
        start: event.segment.start,
        text: event.segment.text,
      } : {}),
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
      const result = await runner(controller.signal)
      if (execution.cancelled) {
        throw new TaskCancelledError()
      }
      if (execution.pauseRequested) {
        await this.waitForControl(execution)
      }
      return result
    } catch (error) {
      if (execution.cancelled) {
        throw new TaskCancelledError()
      }
      if (controller.signal.aborted && execution.pauseRequested) {
        throw new TaskPauseRequestedError()
      }
      if (controller.signal.aborted) {
        throw new TaskCancelledError()
      }
      throw error
    } finally {
      if (execution.abortController === controller) {
        execution.abortController = null
      }
    }
  }

  private async runControllable<T>(
    execution: ActiveExecution,
    runner: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    while (true) {
      try {
        return await this.runAbortable(execution, runner)
      } catch (error) {
        if (!(error instanceof TaskPauseRequestedError)) {
          throw error
        }
        await this.waitForControl(execution)
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
    await this.eventBus.publish(taskId, {
      type: "substage_complete",
      task_id: taskId,
      stage: "D",
      substage,
      overall_progress: overallProgress,
      status: "completed",
      message,
    })
    await this.taskRepository.update(taskId, {
      progress: overallProgress,
      status: overallProgress >= 100 ? "completed" : "running",
    })
  }

  private async failOrCancelTask(
    taskId: string,
    eventType: "task_cancelled" | "task_failed",
    message: string,
    status: "cancelled" | "failed",
  ): Promise<void> {
    const record = await this.taskRepository.getStoredRecord(taskId)
    if (!record) {
      return
    }

    await this.taskRepository.update(taskId, {
      error_message: status === "failed" ? message : null,
      status,
    })
    await this.updateStageMetric({
      taskId,
      stage: inferActiveStage(record.stage_metrics_json),
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
      syncStageMetricFromSubstages(stageMetric, substageMetrics)
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

class TaskPauseRequestedError extends Error {
  constructor() {
    super("Task paused")
    this.name = "TaskPauseRequestedError"
  }
}

function normalizeNullableTitle(value: unknown): string | null {
  const candidate = String(value || "").trim()
  return candidate || null
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "任务执行失败"
}

function syncStageMetricFromSubstages(
  stageMetric: Record<string, unknown>,
  substageMetrics: Record<string, Record<string, unknown>>,
): void {
  const entries = Object.values(substageMetrics)
  if (entries.length === 0) {
    return
  }

  const statuses = entries.map((metric) => String(metric.status || "").trim().toLowerCase())
  const fusionMetric = substageMetrics.fusion_delivery || {}
  const fusionStatus = String(fusionMetric.status || "").trim().toLowerCase()

  if (!stageMetric.started_at) {
    const startedAt = entries
      .map((metric) => String(metric.started_at || "").trim())
      .filter(Boolean)
      .sort()[0]
    if (startedAt) {
      stageMetric.started_at = startedAt
    }
  }

  if (fusionStatus === "completed") {
    stageMetric.status = "completed"
    stageMetric.completed_at = fusionMetric.completed_at ?? stageMetric.completed_at ?? null
    stageMetric.reason = fusionMetric.reason ?? null
    return
  }

  if (statuses.some((status) => status === "failed" || status === "cancelled")) {
    const failureMetric = entries.find((metric) => {
      const status = String(metric.status || "").trim().toLowerCase()
      return status === "failed" || status === "cancelled"
    })
    stageMetric.status = String(failureMetric?.status || "failed").trim().toLowerCase()
    stageMetric.completed_at = failureMetric?.completed_at ?? stageMetric.completed_at ?? null
    stageMetric.reason = failureMetric?.reason ?? null
    return
  }

  if (statuses.some((status) => status === "running" || status === "paused")) {
    stageMetric.status = statuses.includes("paused") ? "paused" : "running"
    stageMetric.completed_at = null
    return
  }

  if (statuses.some((status) => status === "completed" || status === "skipped")) {
    stageMetric.status = "running"
    stageMetric.completed_at = null
    return
  }

  stageMetric.status = "pending"
  stageMetric.completed_at = null
}

function buildMultimodalPrewarmArtifact(taskId: string): VqaMultimodalPrewarmArtifact {
  return {
    task_id: taskId,
    mode: "multimodal",
    entries: [
      {
        artifact_path: "D/vqa-prewarm/index.json",
        modality: "text",
        kind: "retrieval_index",
      },
      {
        artifact_path: "D/vqa-prewarm/frames/manifest.json",
        modality: "image",
        kind: "frame_manifest",
      },
      {
        artifact_path: "D/vqa-prewarm/frame-semantic/index.json",
        modality: "image",
        kind: "frame_semantic",
      },
    ],
    generated_at: new Date().toISOString(),
  }
}

function pathToFileUrl(value: string): string {
  const normalized = value.replace(/\\/g, "/")
  if (normalized.startsWith("/")) {
    return `file://${normalized}`
  }
  return `file:///${normalized}`
}

function buildFallbackFrameSemanticText(frameIndex: number, timestampSeconds: number): string {
  return `画面帧 ${frameIndex + 1}，时间 ${formatSeconds(timestampSeconds)}，等待视觉语义补全`
}

function formatSeconds(value: number): string {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
