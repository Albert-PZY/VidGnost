"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  Download,
  Edit3,
  Loader2,
  MapPin,
  Maximize,
  MessageSquare,
  Pause,
  Play,
  Save,
  Search,
  Send,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PromptMarkdownEditor } from "@/components/editors/prompt-markdown-editor"
import { MarkdownArtifactViewer } from "@/components/ui/markdown-artifact-viewer"
import { ResearchBoardPanel } from "@/components/views/research-board-panel"
import {
  ApiError,
  buildTaskArtifactFileUrl,
  buildTaskSourceMediaUrl,
  cancelTask,
  downloadTaskArtifact,
  getApiErrorMessage,
  getChatTrace,
  getTaskArtifactText,
  getTaskDetail,
  pauseTask,
  resumeTask,
  streamChatWithTask,
  streamTaskEvents,
  updateTaskArtifacts,
} from "@/lib/api"
import { formatBytes, formatDateTime, formatSecondsAsClock } from "@/lib/format"
import { logPerfSample, markPerfStart } from "@/lib/perf"
import { addResearchBoardItem } from "@/lib/research-board"
import type { ResearchBoardItem } from "@/lib/research-board"
import type {
  TaskDetailResponse,
  TaskStepItem,
  TaskStreamEvent,
  TranscriptSegment,
  VqaChatStreamEvent,
  VqaCitationItem,
  VqaTraceResponse,
  WorkflowType,
} from "@/lib/types"
import { cn } from "@/lib/utils"

interface TaskProcessingWorkbenchProps {
  taskId: string
  workflow: WorkflowType
  taskTitle: string
  onBack: () => void
  onTaskChanged: () => void
  onTaskLoaded?: (task: TaskDetailResponse) => void
}

type LeftTab = "transcript" | "evidence" | "stage"
type NotesTab = "notes" | "mindmap" | "research"
type VqaTab = "chat" | "trace" | "research"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  status: "streaming" | "done" | "error"
  citations: VqaCitationItem[]
  traceId?: string
  contextTokensApprox?: number
  statusMessage?: string
  errorMessage?: string
}

const WORKFLOW_STEPS: Record<WorkflowType, Array<{ id: string; name: string }>> = {
  notes: [
    { id: "extract", name: "音频提取" },
    { id: "transcribe", name: "语音转写" },
    { id: "correct", name: "文本纠错" },
    { id: "notes", name: "笔记生成" },
  ],
  vqa: [
    { id: "extract", name: "音频提取" },
    { id: "transcribe", name: "语音转写" },
    { id: "correct", name: "文本纠错" },
    { id: "embed", name: "向量化入库" },
    { id: "frames", name: "帧画面分析" },
    { id: "ready", name: "问答就绪" },
  ],
}

const VM_PHASE_LABELS: Record<string, string> = {
  A: "阶段 A · 音频提取",
  B: "阶段 B · 媒体预处理",
  C: "阶段 C · 语音转写",
  transcript_optimize: "阶段 D1 · 文本优化",
  D: "阶段 D2 · 结果交付",
}

const TASK_EVENT_BADGE_LABELS: Record<string, string> = {
  transcript_optimize: "文本优化",
  fusion_delivery: "结果交付",
}

const TRACE_SECTIONS = [
  { key: "dense_hits", label: "Dense 语义候选", scoreKey: "dense_score" },
  { key: "sparse_hits", label: "Sparse 关键词候选", scoreKey: "sparse_score" },
  { key: "rrf_hits", label: "RRF 融合结果", scoreKey: "rrf_score" },
  { key: "rerank_hits", label: "最终排序结果", scoreKey: "final_score" },
] as const

function buildFallbackSteps(workflow: WorkflowType): TaskStepItem[] {
  return WORKFLOW_STEPS[workflow].map((step) => ({
    id: step.id,
    name: step.name,
    status: "pending",
    progress: 0,
    duration: "",
    logs: [],
  }))
}

function findActiveTranscriptId(segments: TranscriptSegment[], currentTime: number): string {
  if (segments.length === 0) {
    return ""
  }
  const active = segments.find(
    (segment) => currentTime >= segment.start && currentTime < segment.end,
  )
  return active ? `${active.start}-${active.end}` : ""
}

function isTerminalTask(status: string | undefined): boolean {
  return Boolean(status && ["completed", "failed", "cancelled"].includes(status))
}

function isRunningTask(status: string | undefined): boolean {
  return Boolean(status && ["queued", "running"].includes(status))
}

function isPausedTask(status: string | undefined): boolean {
  return status === "paused"
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => asString(item).trim()).filter(Boolean)
}

function getTraceStagePayload(trace: VqaTraceResponse | null, stage: string): Record<string, unknown> {
  if (!trace) {
    return {}
  }
  const record = trace.records.find((item) => item.stage === stage)
  return asObject(record?.payload)
}

function buildTraceHitKey(hit: Record<string, unknown>): string {
  const taskId = asString(hit.task_id)
  const text = asString(hit.text).trim().replace(/\s+/g, " ").toLowerCase()
  if (text) {
    return `${taskId}|${text}`
  }
  const imagePath = asString(hit.image_path).trim()
  if (imagePath) {
    return `${taskId}|image:${imagePath}`
  }
  const start = asNumber(hit.start) ?? 0
  const end = asNumber(hit.end) ?? 0
  return `${taskId}|${start.toFixed(2)}-${end.toFixed(2)}`
}

function mergeTraceSourceSets(...groups: unknown[]): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  groups.forEach((group) => {
    asStringArray(group).forEach((item) => {
      if (seen.has(item)) {
        return
      }
      seen.add(item)
      merged.push(item)
    })
  })
  return merged
}

function dedupeTraceHits(hits: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const deduped = new Map<string, Record<string, unknown>>()
  hits.forEach((hit) => {
    const key = buildTraceHitKey(hit)
    const current = deduped.get(key)
    if (!current) {
      deduped.set(key, { ...hit })
      return
    }
    deduped.set(key, {
      ...current,
      dense_score: Math.max(asNumber(current.dense_score) ?? 0, asNumber(hit.dense_score) ?? 0),
      sparse_score: Math.max(asNumber(current.sparse_score) ?? 0, asNumber(hit.sparse_score) ?? 0),
      rrf_score: Math.max(asNumber(current.rrf_score) ?? 0, asNumber(hit.rrf_score) ?? 0),
      rerank_score: Math.max(asNumber(current.rerank_score) ?? 0, asNumber(hit.rerank_score) ?? 0),
      final_score: Math.max(asNumber(current.final_score) ?? 0, asNumber(hit.final_score) ?? 0),
      source_set: mergeTraceSourceSets(current.source_set, hit.source_set),
      image_path: asString(current.image_path) || asString(hit.image_path),
    })
  })
  return Array.from(deduped.values())
}

function getTraceSectionHint(sectionKey: (typeof TRACE_SECTIONS)[number]["key"]): string {
  switch (sectionKey) {
    case "dense_hits":
      return "按语义相似度召回，分数越高说明问题和片段语义越接近。"
    case "sparse_hits":
      return "按关键词命中召回，分数已做可读化归一，便于直接比较强弱。"
    case "rrf_hits":
      return "把 Dense 和 Sparse 候选融合后重新排序，同一片段已在阶段内去重。"
    case "rerank_hits":
      return "最终给模型使用的候选列表，默认不做查询扩展，只按原问题直搜。"
    default:
      return "这里展示当前阶段的去重候选。"
  }
}

function isRetryableVqaStreamError(rawMessage: string): boolean {
  const lowered = rawMessage.trim().toLowerCase()
  return lowered.includes("incomplete chunked read") || lowered.includes("peer closed connection")
}

function getVqaStreamStatusText(event: VqaChatStreamEvent): string {
  switch (event.status) {
    case "retrieving":
      return "正在检索相关片段..."
    case "generating":
      return (event.hit_count ?? 0) > 0 ? "已完成证据检索，正在组织回答..." : "未检索到直接证据，正在组织回答..."
    case "fallback":
      return "流式连接短暂中断，已切换稳定模式补全回答..."
    default:
      return event.message || event.status || ""
  }
}

function getVqaStreamErrorText(event: VqaChatStreamEvent): string {
  const rawMessage = event.error?.message || event.message || ""
  const code = event.error?.code || ""
  if (code === "LLM_DISABLED") {
    return "LLM API Key 未配置，暂时无法执行问答。"
  }
  if (isRetryableVqaStreamError(rawMessage)) {
    return "流式连接中途中断，请稍后重试。"
  }
  return rawMessage || "流式回答失败"
}

function getVqaRequestFailureMessage(error: unknown): string {
  const message = getApiErrorMessage(error, "执行视频问答失败")
  if (isRetryableVqaStreamError(message)) {
    return "流式连接意外中断，请稍后重试。"
  }
  return message
}

function getStepStatusIcon(status: TaskStepItem["status"]) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-status-success" />
    case "processing":
      return <Loader2 className="h-4 w-4 animate-spin text-status-processing" />
    case "error":
      return <AlertCircle className="h-4 w-4 text-status-error" />
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />
  }
}

function getVmPhaseStatusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "已完成"
    case "running":
      return "进行中"
    case "paused":
      return "已暂停"
    case "failed":
      return "失败"
    case "skipped":
      return "跳过"
    default:
      return "待执行"
  }
}

function appendMarkdownSection(base: string, title: string, line: string): string {
  const normalized = base.trim()
  if (!normalized) {
    return `## ${title}\n\n${line}`
  }
  return `${normalized}\n\n## ${title}\n\n${line}`
}

function buildTranscriptSnippet(segment: TranscriptSegment): string {
  return `- ${formatSecondsAsClock(segment.start)} - ${formatSecondsAsClock(segment.end)} ${segment.text}`
}

function cloneTaskSteps(task: TaskDetailResponse): TaskStepItem[] {
  const sourceSteps = task.steps.length > 0 ? task.steps : buildFallbackSteps(task.workflow)
  return sourceSteps.map((step) => ({
    ...step,
    logs: Array.isArray(step.logs) ? [...step.logs] : [],
  }))
}

function getStreamStepId(
  workflow: WorkflowType,
  stage: string,
  substage: string,
  rawType: string,
): string | null {
  if (stage === "A" || stage === "B") {
    return "extract"
  }
  if (stage === "C") {
    return "transcribe"
  }
  if (substage === "transcript_optimize") {
    return "correct"
  }
  if (substage === "fusion_delivery") {
    return workflow === "notes" ? "notes" : "ready"
  }
  if (stage === "D" && rawType === "stage_complete") {
    return workflow === "notes" ? "notes" : "ready"
  }
  return null
}

function deriveCurrentStepId(status: string, steps: TaskStepItem[]): string {
  const activeStep = steps.find((step) => step.status === "processing")
  if (activeStep) {
    return activeStep.id
  }
  if (isTerminalTask(status)) {
    const lastCompleted = [...steps].reverse().find((step) => step.status === "completed")
    return lastCompleted?.id || ""
  }
  const nextStep = steps.find((step) => step.status !== "completed")
  return nextStep?.id || ""
}

function updateStepProgress(
  steps: TaskStepItem[],
  stepId: string,
  status: TaskStepItem["status"],
  progress?: number | null,
): TaskStepItem[] {
  const targetIndex = steps.findIndex((step) => step.id === stepId)
  if (targetIndex < 0) {
    return steps
  }

  const normalizedProgress = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)))
  return steps.map((step, index) => {
    if (index < targetIndex && status === "processing" && step.status !== "error") {
      return { ...step, status: "completed", progress: 100 }
    }
    if (index !== targetIndex) {
      if (status === "processing" && step.status === "processing") {
        return { ...step, status: "pending", progress: 0 }
      }
      return step
    }
    if (status === "processing") {
      return {
        ...step,
        status,
        progress: normalizedProgress == null ? Math.max(step.progress, 1) : Math.max(step.progress, normalizedProgress),
      }
    }
    if (status === "completed") {
      return { ...step, status, progress: 100 }
    }
    if (status === "error") {
      return {
        ...step,
        status,
        progress: normalizedProgress == null ? step.progress : normalizedProgress,
      }
    }
    return { ...step, status, progress: normalizedProgress ?? step.progress }
  })
}

function updateVmPhaseMetrics(
  currentMetrics: Record<string, Record<string, unknown>>,
  event: TaskStreamEvent,
  rawType: string,
): Record<string, Record<string, unknown>> {
  if (rawType === "task_complete" || rawType === "task_failed" || rawType === "task_cancelled") {
    return currentMetrics
  }

  const stage = asString(event.stage).trim()
  const substage = asString(event.substage).trim()
  const timestamp = asString(event.timestamp).trim()
  const nextMetrics: Record<string, Record<string, unknown>> = Object.fromEntries(
    Object.entries(currentMetrics).map(([key, value]) => [key, { ...asObject(value) }]),
  )

  const updateMetric = (key: string, patcher: (metric: Record<string, unknown>) => Record<string, unknown>) => {
    const currentMetric = { ...asObject(nextMetrics[key]) }
    nextMetrics[key] = patcher(currentMetric)
  }

  if (rawType === "progress" && (stage === "A" || stage === "B" || stage === "C")) {
    const metricKey = stage
    updateMetric(metricKey, (metric) => ({
      ...metric,
      status: metric.status === "completed" ? "completed" : "running",
      started_at: asString(metric.started_at) || timestamp,
    }))
    return nextMetrics
  }

  if (rawType === "stage_start" && (stage === "A" || stage === "B" || stage === "C" || stage === "D")) {
    const metricKey = stage
    updateMetric(metricKey, (metric) => ({
      ...metric,
      status: "running",
      started_at: timestamp || metric.started_at,
      completed_at: null,
      reason: null,
    }))
    return nextMetrics
  }

  if (rawType === "stage_complete" && (stage === "A" || stage === "B" || stage === "C" || stage === "D")) {
    const metricKey = stage
    updateMetric(metricKey, (metric) => ({
      ...metric,
      status: "completed",
      completed_at: timestamp || metric.completed_at,
      reason: null,
    }))
    return nextMetrics
  }

  if (substage === "transcript_optimize" && (rawType === "substage_start" || rawType === "substage_complete")) {
    updateMetric("transcript_optimize", (metric) => ({
      ...metric,
      status:
        rawType === "substage_start"
          ? "running"
          : asString(event.status).trim().toLowerCase() === "failed"
            ? "failed"
            : asString(event.status).trim().toLowerCase() === "skipped"
              ? "skipped"
              : "completed",
      started_at: rawType === "substage_start" ? (timestamp || metric.started_at) : metric.started_at,
      completed_at: rawType === "substage_complete" ? (timestamp || metric.completed_at) : null,
      reason: rawType === "substage_complete" ? asString(event.message).trim() || null : null,
    }))
    return nextMetrics
  }

  if (substage === "fusion_delivery" && (rawType === "substage_start" || rawType === "substage_complete")) {
    updateMetric("D", (metric) => ({
      ...metric,
      status:
        rawType === "substage_start"
          ? "running"
          : asString(event.status).trim().toLowerCase() === "failed"
            ? "failed"
            : asString(event.status).trim().toLowerCase() === "skipped"
              ? "skipped"
              : "completed",
      started_at: asString(metric.started_at) || timestamp,
      completed_at: rawType === "substage_complete" ? (timestamp || metric.completed_at) : null,
      reason: rawType === "substage_complete" ? asString(event.message).trim() || null : null,
    }))
    return nextMetrics
  }

  return currentMetrics
}

function applyTaskStreamEvent(current: TaskDetailResponse, event: TaskStreamEvent): TaskDetailResponse {
  const rawType = getRawTaskEventType(event)
  const stage = asString(event.stage).trim()
  const substage = asString(event.substage).trim()
  const overallProgress = asNumber(event["overall_progress"])
  const stageProgress = asNumber(event["stage_progress"])
  const nextSteps = cloneTaskSteps(current)
  const stepId = getStreamStepId(current.workflow, stage, substage, rawType)

  let nextStatus = current.status
  let nextErrorMessage = current.error_message

  if (rawType === "task_complete") {
    nextStatus = "completed"
    nextSteps.forEach((step, index) => {
      nextSteps[index] = { ...step, status: "completed", progress: 100 }
    })
  } else if (rawType === "task_paused") {
    nextStatus = "paused"
  } else if (rawType === "task_cancelled") {
    nextStatus = "cancelled"
  } else if (rawType === "task_failed") {
    nextStatus = "failed"
    nextErrorMessage = asString(event.error || event.message).trim() || nextErrorMessage
    const activeStep = nextSteps.find((step) => step.status === "processing")
    if (activeStep) {
      const failedSteps = updateStepProgress(nextSteps, activeStep.id, "error")
      nextSteps.splice(0, nextSteps.length, ...failedSteps)
    }
  } else if (rawType === "progress") {
    nextStatus = isTerminalTask(current.status) ? current.status : "running"
    if (stepId) {
      const progressedSteps = updateStepProgress(nextSteps, stepId, "processing", stageProgress)
      nextSteps.splice(0, nextSteps.length, ...progressedSteps)
    }
  } else if (rawType === "stage_start" || rawType === "substage_start") {
    nextStatus = isTerminalTask(current.status) ? current.status : "running"
    if (stepId) {
      const progressedSteps = updateStepProgress(nextSteps, stepId, "processing", stageProgress)
      nextSteps.splice(0, nextSteps.length, ...progressedSteps)
    }
  } else if (rawType === "stage_complete" || rawType === "substage_complete") {
    if (stepId) {
      if (rawType === "stage_complete" && stage === "A") {
        const progressedSteps = updateStepProgress(nextSteps, stepId, "processing", 100)
        nextSteps.splice(0, nextSteps.length, ...progressedSteps)
      } else {
        const substageStatus = asString(event.status).trim().toLowerCase()
        const targetStatus =
          substageStatus === "failed" ? "error" : "completed"
        const progressedSteps = updateStepProgress(nextSteps, stepId, targetStatus, stageProgress ?? 100)
        nextSteps.splice(0, nextSteps.length, ...progressedSteps)
      }
    }
  }

  const nextProgress =
    overallProgress == null ? current.progress : Math.max(0, Math.min(100, Math.round(overallProgress)))
  const nextVmPhaseMetrics = updateVmPhaseMetrics(current.vm_phase_metrics, event, rawType)

  return {
    ...current,
    status: nextStatus,
    error_message: nextErrorMessage,
    progress: nextProgress,
    overall_progress: nextProgress,
    steps: nextSteps,
    current_step_id: deriveCurrentStepId(nextStatus, nextSteps),
    vm_phase_metrics: nextVmPhaseMetrics,
  }
}

function buildTranscriptSegmentKey(segment: Pick<TranscriptSegment, "start" | "end">): string {
  return `${Number(segment.start).toFixed(2)}-${Number(segment.end).toFixed(2)}`
}

function mergeTranscriptSegments(
  baseSegments: TranscriptSegment[],
  nextSegments: TranscriptSegment[],
): TranscriptSegment[] {
  const merged = new Map<string, TranscriptSegment>()

  const append = (segment: TranscriptSegment) => {
    const text = asString(segment.text).trim()
    if (!text) {
      return
    }
    const normalized: TranscriptSegment = {
      ...segment,
      start: Number(segment.start),
      end: Number(segment.end),
      text,
    }
    merged.set(buildTranscriptSegmentKey(normalized), normalized)
  }

  baseSegments.forEach(append)
  nextSegments.forEach(append)

  return Array.from(merged.values()).sort((left, right) => left.start - right.start || left.end - right.end)
}

function getRawTaskEventType(event: TaskStreamEvent): string {
  return asString(event.original_type || event.type).trim().toLowerCase()
}

function extractTranscriptSegmentFromEvent(event: TaskStreamEvent): TranscriptSegment | null {
  if (getRawTaskEventType(event) !== "transcript_delta") {
    return null
  }
  const start = asNumber(event["start"])
  const end = asNumber(event["end"])
  const text = asString(event.text).trim()
  if (start === null || end === null || !text) {
    return null
  }
  return { start, end, text }
}

function shouldRecordTaskEvent(event: TaskStreamEvent): boolean {
  return ![
    "transcript_delta",
    "progress",
    "summary_delta",
    "mindmap_delta",
    "transcript_optimized_preview",
    "fusion_prompt_preview",
  ].includes(getRawTaskEventType(event))
}

function shouldTriggerTaskRefresh(event: TaskStreamEvent): boolean {
  return [
    "stage_start",
    "stage_complete",
    "substage_start",
    "substage_complete",
    "log",
    "task_paused",
    "task_complete",
    "task_cancelled",
    "task_failed",
  ].includes(getRawTaskEventType(event))
}

function getTaskStatusSummary(status: string, steps: TaskStepItem[]): string {
  const normalized = asString(status).trim().toLowerCase()
  const activeStep = steps.find((step) => step.status === "processing")
  if (normalized === "completed") {
    return "已完成"
  }
  if (normalized === "failed") {
    return "执行失败"
  }
  if (normalized === "cancelled") {
    return "已取消"
  }
  if (normalized === "paused") {
    return "已暂停"
  }
  if (normalized === "queued") {
    return "排队中"
  }
  if (activeStep) {
    return `${activeStep.name}中`
  }
  return "处理中"
}

function formatTaskEventTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return ""
  }
  return parsed.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatTaskEventBadge(event: TaskStreamEvent): string {
  const substage = asString(event.substage).trim()
  if (substage) {
    return TASK_EVENT_BADGE_LABELS[substage] || substage
  }
  const stage = asString(event.stage).trim()
  if (stage) {
    return VM_PHASE_LABELS[stage] || `阶段 ${stage}`
  }
  return "任务动态"
}

function formatTraceScore(value: unknown): string {
  const score = asNumber(value)
  if (score === null) {
    return "-"
  }
  const absScore = Math.abs(score)
  if (absScore >= 1) {
    return score.toFixed(3)
  }
  if (absScore >= 0.01) {
    return score.toFixed(4)
  }
  if (absScore > 0) {
    return score.toExponential(2)
  }
  return "0"
}

function translateTaskLogMessage(message: string): string {
  const normalized = message.trim()
  if (!normalized) {
    return "当前事件没有附带说明。"
  }

  const stageStartedMatch = normalized.match(/^Stage ([A-D]) started: .+$/)
  if (stageStartedMatch) {
    const stageKey = stageStartedMatch[1]
    return `${VM_PHASE_LABELS[stageKey] || `阶段 ${stageKey}`}已开始`
  }

  const stageCompletedMatch = normalized.match(/^Stage ([A-D]) completed$/)
  if (stageCompletedMatch) {
    const stageKey = stageCompletedMatch[1]
    return `${VM_PHASE_LABELS[stageKey] || `阶段 ${stageKey}`}已完成`
  }

  if (normalized === "Checking local Whisper small model cache...") {
    return "正在检查本地 Whisper small 模型缓存"
  }
  if (normalized === "Whisper small model cache is ready.") {
    return "本地 Whisper small 模型缓存已就绪"
  }
  if (normalized.startsWith("Source type: ")) {
    const sourceType = normalized.slice("Source type: ".length).trim()
    const mapped = sourceType === "local_file" ? "本地文件" : sourceType === "local_path" ? "本地路径" : sourceType === "bilibili" ? "在线视频" : sourceType
    return `已确认输入来源：${mapped}`
  }
  if (normalized.startsWith("Video ready: ")) {
    return `视频源已就绪：${normalized.slice("Video ready: ".length).trim()}`
  }
  if (normalized.startsWith("Converting audio to WAV")) {
    return normalized
      .replace(/^Converting audio to WAV /, "正在提取音频并转换为 WAV ")
      .replace(/\.\.\.$/, "")
  }
  if (normalized.startsWith("Audio conversion completed: ")) {
    return `音频转换完成：${normalized.slice("Audio conversion completed: ".length).trim()}`
  }
  if (normalized.startsWith("Splitting audio into chunks")) {
    return normalized
      .replace(/^Splitting audio into chunks /, "正在切分音频 ")
      .replace(/\.\.\.$/, "")
  }

  const chunkPreparedMatch = normalized.match(
    /^Chunk (\d+)\/(\d+): ([^,]+), start ([\d.]+)s, duration ([\d.]+)s$/,
  )
  if (chunkPreparedMatch) {
    const [, current, total, , startSeconds, durationSeconds] = chunkPreparedMatch
    return `已生成音频分段 ${current}/${total}，起点 ${formatSecondsAsClock(Number(startSeconds))}，时长 ${Number(durationSeconds).toFixed(1)} 秒`
  }

  const chunkTranscribingMatch = normalized.match(/^Transcribing chunk (\d+)\/(\d+): .+$/)
  if (chunkTranscribingMatch) {
    const [, current, total] = chunkTranscribingMatch
    return `正在转写第 ${current}/${total} 段音频`
  }

  const chunkCompletedMatch = normalized.match(/^Chunk (\d+)\/(\d+) transcription completed$/)
  if (chunkCompletedMatch) {
    const [, current, total] = chunkCompletedMatch
    return `第 ${current}/${total} 段音频转写完成`
  }

  if (normalized === "Transcript optimization skipped because correction mode is off.") {
    return "已跳过转写文本优化，直接进入结果整理"
  }
  if (normalized === "Running transcript correction strategy...") {
    return "正在整理和优化转写文本"
  }
  if (normalized.startsWith("Waiting for model runtime lock: ")) {
    return normalized
      .replace(/^Waiting for model runtime lock: /, "正在等待模型执行资源：")
      .replace(/s$/, " 秒")
  }
  if (normalized === "Generating detailed notes and mindmap in parallel...") {
    return "正在并行生成详细笔记和思维导图"
  }
  if (normalized === "Detailed notes and mindmap persisted to local storage") {
    return "笔记、导图和阶段产物已经保存到本地"
  }
  if (normalized === "Rewrite correction completed.") {
    return "转写文本优化完成"
  }
  if (normalized.startsWith("Transcript rewrite skipped for long transcript")) {
    return "转写内容较长，已跳过全文改写以避免长时间停留在文本优化阶段"
  }
  if (normalized.startsWith("Rewrite correction timed out")) {
    return "转写文本优化超时，已回退到原始转写继续后续处理"
  }
  if (normalized.startsWith("Strict correction timed out")) {
    return "分段文本优化超时，已回退到原始转写继续后续处理"
  }

  return normalized
}

function formatTaskEventMessage(event: TaskStreamEvent): string {
  const rawType = getRawTaskEventType(event)
  const stageLabel = formatTaskEventBadge(event)
  if (rawType === "stage_start") {
    return `${stageLabel}已开始`
  }
  if (rawType === "stage_complete") {
    return `${stageLabel}已完成`
  }
  if (rawType === "substage_start") {
    return `${stageLabel}已开始`
  }
  if (rawType === "substage_complete") {
    const status = asString(event["status"]).trim().toLowerCase()
    if (status === "failed") {
      return `${stageLabel}失败：${translateTaskLogMessage(asString(event.message))}`
    }
    if (status === "skipped") {
      return `${stageLabel}已跳过`
    }
    return `${stageLabel}已完成`
  }
  if (rawType === "progress") {
    const stageProgress = asNumber(event["stage_progress"])
    const overallProgress = asNumber(event["overall_progress"])
    if (stageProgress !== null) {
      return `${stageLabel}进度 ${Math.round(stageProgress)}%`
    }
    if (overallProgress !== null) {
      return `任务总进度 ${Math.round(overallProgress)}%`
    }
  }
  if (rawType === "log") {
    return translateTaskLogMessage(asString(event.message))
  }
  if (rawType === "task_complete") {
    return "任务已完成，所有结果已生成"
  }
  if (rawType === "task_cancelled") {
    return "任务已取消"
  }
  if (rawType === "task_paused") {
    return "任务已暂停，可随时继续"
  }
  return translateTaskLogMessage(asString(event.message || event.text || event.title))
}

export function TaskProcessingWorkbench({
  taskId,
  workflow,
  taskTitle,
  onBack,
  onTaskChanged,
  onTaskLoaded,
}: TaskProcessingWorkbenchProps) {
  const [task, setTask] = React.useState<TaskDetailResponse | null>(null)
  const [isInitialLoading, setIsInitialLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState("")
  const [leftTab, setLeftTab] = React.useState<LeftTab>("transcript")
  const [notesTab, setNotesTab] = React.useState<NotesTab>("notes")
  const [vqaTab, setVqaTab] = React.useState<VqaTab>("chat")
  const [question, setQuestion] = React.useState("")
  const [chatHistory, setChatHistory] = React.useState<ChatMessage[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [selectedTraceId, setSelectedTraceId] = React.useState("")
  const [traceCache, setTraceCache] = React.useState<Record<string, VqaTraceResponse>>({})
  const [traceLoadingId, setTraceLoadingId] = React.useState("")
  const [traceError, setTraceError] = React.useState("")
  const [notesDraft, setNotesDraft] = React.useState("")
  const [isEditingNotes, setIsEditingNotes] = React.useState(false)
  const [isSavingNotes, setIsSavingNotes] = React.useState(false)
  const [mindmapHtml, setMindmapHtml] = React.useState("")
  const [mindmapKey, setMindmapKey] = React.useState("")
  const [isMindmapLoading, setIsMindmapLoading] = React.useState(false)
  const [taskEvents, setTaskEvents] = React.useState<TaskStreamEvent[]>([])
  const [liveTranscriptSegments, setLiveTranscriptSegments] = React.useState<TranscriptSegment[]>([])
  const [videoLoadError, setVideoLoadError] = React.useState("")
  const [isCancelling, setIsCancelling] = React.useState(false)
  const [isPausing, setIsPausing] = React.useState(false)
  const [isResuming, setIsResuming] = React.useState(false)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const refreshTimerRef = React.useRef<number | null>(null)
  const chatAbortRef = React.useRef<AbortController | null>(null)
  const hasLoadedTaskRef = React.useRef(false)

  React.useEffect(() => {
    hasLoadedTaskRef.current = false
    setTask(null)
    setErrorMessage("")
    setIsInitialLoading(true)
    setIsRefreshing(false)
    setChatHistory([])
    setQuestion("")
    setSelectedTraceId("")
    setTraceError("")
    setTraceCache({})
    setTaskEvents([])
    setLiveTranscriptSegments([])
    setVideoLoadError("")
    setLeftTab("transcript")
    setNotesTab("notes")
    setVqaTab("chat")
    setMindmapHtml("")
    setMindmapKey("")
  }, [taskId, workflow])

  React.useEffect(() => {
    return () => {
      chatAbortRef.current?.abort()
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  const loadTask = React.useCallback(
    async (options?: { showToastOnError?: boolean; background?: boolean }) => {
      const showToastOnError = options?.showToastOnError ?? true
      const background = options?.background ?? hasLoadedTaskRef.current
      const perfMark = markPerfStart(`task.detail.${taskId}`)
      if (background) {
        setIsRefreshing(true)
      } else {
        setIsInitialLoading(true)
      }
      try {
        const detail = await getTaskDetail(taskId)
        setTask(detail)
        hasLoadedTaskRef.current = true
        setErrorMessage("")
        onTaskLoaded?.(detail)
        if (!isEditingNotes) {
          setNotesDraft(detail.notes_markdown || "")
        }
      } catch (error) {
        const message = getApiErrorMessage(error, "加载任务详情失败")
        setErrorMessage(message)
        if (showToastOnError) {
          toast.error(message)
        }
      } finally {
        logPerfSample(`task.detail.${taskId}`, perfMark)
        if (background) {
          setIsRefreshing(false)
        } else {
          setIsInitialLoading(false)
        }
      }
    },
    [isEditingNotes, onTaskLoaded, taskId],
  )

  React.useEffect(() => {
    void loadTask()
  }, [loadTask])

  React.useEffect(() => {
    if (!task) {
      return
    }
    void onTaskChanged()
  }, [onTaskChanged, task?.status, task?.updated_at])

  const liveTaskId = task?.id || ""
  const liveTaskStatus = task?.status || ""

  React.useEffect(() => {
    if (!liveTaskId || !isRunningTask(liveTaskStatus)) {
      return
    }
    const source = streamTaskEvents(liveTaskId, (event) => {
      const rawType = getRawTaskEventType(event)
      const streamedSegment = extractTranscriptSegmentFromEvent(event)
      if (streamedSegment) {
        setLiveTranscriptSegments((current) => mergeTranscriptSegments(current, [streamedSegment]))
      }
      setTask((current) => (current ? applyTaskStreamEvent(current, event) : current))
      if (shouldRecordTaskEvent(event)) {
        setTaskEvents((current) => [event, ...current].slice(0, 80))
      }
      const shouldRefreshImmediately =
        rawType === "task_complete" ||
        rawType === "task_paused" ||
        rawType === "task_cancelled" ||
        rawType === "task_failed"
      if (shouldRefreshImmediately) {
        if (refreshTimerRef.current !== null) {
          window.clearTimeout(refreshTimerRef.current)
          refreshTimerRef.current = null
        }
        void loadTask({ showToastOnError: false, background: true })
        return
      }
      if (!shouldTriggerTaskRefresh(event) || refreshTimerRef.current !== null) {
        return
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        void loadTask({ showToastOnError: false, background: true })
      }, 450)
    })
    source.onerror = () => source.close()
    return () => {
      source.close()
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [liveTaskId, liveTaskStatus, loadTask])

  React.useEffect(() => {
    const loadMindmap = async () => {
      if (!task || workflow !== "notes" || notesTab !== "mindmap") {
        return
      }
      if (task.status !== "completed") {
        setMindmapHtml("")
        return
      }
      const nextKey = `${task.id}:${task.updated_at}`
      if (mindmapHtml && mindmapKey === nextKey) {
        return
      }
      setIsMindmapLoading(true)
      try {
        const html = await getTaskArtifactText(task.id, "mindmap")
        setMindmapHtml(html)
        setMindmapKey(nextKey)
      } catch (error) {
        toast.error(getApiErrorMessage(error, "加载思维导图预览失败"))
      } finally {
        setIsMindmapLoading(false)
      }
    }
    void loadMindmap()
  }, [mindmapHtml, mindmapKey, notesTab, task, workflow])

  const effectiveTask = task
  const effectiveTitle = effectiveTask?.title || effectiveTask?.source_input || taskTitle
  const steps = effectiveTask?.steps.length ? effectiveTask.steps : buildFallbackSteps(workflow)
  const transcriptSegments = React.useMemo(
    () => mergeTranscriptSegments(effectiveTask?.transcript_segments ?? [], liveTranscriptSegments),
    [effectiveTask?.transcript_segments, liveTranscriptSegments],
  )
  const totalProgress = effectiveTask?.overall_progress ?? 0
  const videoUrl = effectiveTask?.source_local_path ? buildTaskSourceMediaUrl(effectiveTask.id) : ""
  const canEditArtifacts = isTerminalTask(effectiveTask?.status)

  const updateAssistantMessage = React.useCallback(
    (messageId: string, updater: (current: ChatMessage) => ChatMessage) => {
      setChatHistory((current) => current.map((item) => (item.id === messageId ? updater(item) : item)))
    },
    [],
  )

  const jumpToTime = React.useCallback(
    (time: number) => {
      const nextTime = Math.max(0, time)
      if (videoRef.current) {
        videoRef.current.currentTime = nextTime
      }
    },
    [],
  )

  const addItemToResearchBoard = React.useCallback(
    (payload: {
      type: "transcript" | "citation" | "note"
      title: string
      content: string
      start?: number
      end?: number
      source?: string
      sourceSet?: string[]
    }) => {
      addResearchBoardItem({
        taskId,
        taskTitle: effectiveTitle,
        workflow,
        ...payload,
      })
      toast.success("已加入线索篮")
    },
    [effectiveTitle, taskId, workflow],
  )

  const handleAskQuestion = React.useCallback(async () => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || isSearching || !effectiveTask) {
      return
    }
    chatAbortRef.current?.abort()
    const controller = new AbortController()
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    chatAbortRef.current = controller
    setQuestion("")
    setVqaTab("chat")
    setIsSearching(true)
    setChatHistory((current) => [
      ...current,
      { id: userId, role: "user", content: trimmedQuestion, status: "done", citations: [] },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        citations: [],
        statusMessage: "正在检索相关片段...",
      },
    ])
    try {
      await streamChatWithTask(
        { task_id: taskId, question: trimmedQuestion },
        {
          signal: controller.signal,
          onEvent: (event: VqaChatStreamEvent) => {
            updateAssistantMessage(assistantId, (current) => {
              const next = { ...current }
              if (event.trace_id) next.traceId = event.trace_id
              if (event.type === "citations") {
                next.citations = event.citations ?? []
                next.contextTokensApprox = event.context_tokens_approx
              }
              if (event.type === "chunk" && event.delta) {
                next.content += event.delta
                if (!current.content.trim()) {
                  next.statusMessage = ""
                }
              }
              if (event.type === "replace") {
                next.content = event.content || ""
                next.statusMessage = ""
                next.errorMessage = ""
                next.status = "streaming"
              }
              if (event.type === "status") {
                next.statusMessage = getVqaStreamStatusText(event)
                if (event.status === "fallback") {
                  next.errorMessage = ""
                  next.status = "streaming"
                }
              }
              if (event.type === "error") {
                next.status = "error"
                next.errorMessage = getVqaStreamErrorText(event)
              }
              if (event.type === "done") next.status = next.errorMessage ? "error" : "done"
              return next
            })
          },
        },
      )
      updateAssistantMessage(assistantId, (current) => ({
        ...current,
        content: current.content.trim() || current.errorMessage || "未生成回答。",
        status: current.errorMessage ? "error" : "done",
      }))
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        updateAssistantMessage(assistantId, (current) => ({
          ...current,
          content: current.content.trim() || "本次流式回答已停止。",
          status: "done",
          statusMessage: "已手动停止",
        }))
      } else {
        const message = getVqaRequestFailureMessage(error)
        updateAssistantMessage(assistantId, (current) => ({
          ...current,
          content: current.content.trim() || message,
          status: "error",
          errorMessage: message,
        }))
        toast.error(message)
      }
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null
      }
      setIsSearching(false)
    }
  }, [effectiveTask, isSearching, question, taskId, updateAssistantMessage])

  const handleLoadTrace = React.useCallback(
    async (traceId: string) => {
      if (!traceId) {
        return
      }
      setSelectedTraceId(traceId)
      setTraceError("")
      setVqaTab("trace")
      if (traceCache[traceId]) {
        return
      }
      setTraceLoadingId(traceId)
      try {
        const payload = await getChatTrace(traceId)
        setTraceCache((current) => ({ ...current, [traceId]: payload }))
      } catch (error) {
        setTraceError(getApiErrorMessage(error, "加载 Trace 明细失败"))
      } finally {
        setTraceLoadingId("")
      }
    },
    [traceCache],
  )

  const handleCopyTranscript = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(effectiveTask?.transcript_text || "")
      toast.success("转写文本已复制")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "复制转写文本失败"))
    }
  }, [effectiveTask?.transcript_text])

  const handleDownloadArtifact = React.useCallback(
    async (kind: "transcript" | "notes" | "mindmap" | "srt" | "vtt" | "bundle") => {
      try {
        await downloadTaskArtifact(taskId, kind)
      } catch (error) {
        toast.error(getApiErrorMessage(error, "导出产物失败"))
      }
    },
    [taskId],
  )

  const handleDownloadTranscript = React.useCallback(() => {
    void handleDownloadArtifact("transcript")
  }, [handleDownloadArtifact])

  const handleDownloadNotes = React.useCallback(() => {
    void handleDownloadArtifact("notes")
  }, [handleDownloadArtifact])

  const handleExportBundle = React.useCallback(() => {
    void handleDownloadArtifact("bundle")
  }, [handleDownloadArtifact])

  const handleVideoError = React.useCallback((message: string) => {
    setVideoLoadError(message)
  }, [])

  const handleSaveNotes = React.useCallback(async () => {
    if (!canEditArtifacts) {
      toast.error("请等待任务进入终态后再保存笔记")
      return
    }
    setIsSavingNotes(true)
    try {
      const updated = await updateTaskArtifacts(taskId, { notes_markdown: notesDraft })
      setTask(updated)
      setIsEditingNotes(false)
      toast.success("笔记已保存")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "保存笔记失败"))
    } finally {
      setIsSavingNotes(false)
    }
  }, [canEditArtifacts, notesDraft, taskId])

  const handleAddTranscriptToNotes = React.useCallback((segment: TranscriptSegment) => {
    setNotesDraft((current) => appendMarkdownSection(current, "补充引用片段", buildTranscriptSnippet(segment)))
    setIsEditingNotes(true)
    setNotesTab("notes")
    toast.success("已加入笔记草稿")
  }, [])

  const handleAddTranscriptToResearch = React.useCallback(
    (segment: TranscriptSegment) => {
      addItemToResearchBoard({
        type: "transcript",
        title: `转写片段 · ${formatSecondsAsClock(segment.start)}`,
        content: segment.text,
        start: segment.start,
        end: segment.end,
        source: segment.speaker || "transcript",
      })
    },
    [addItemToResearchBoard],
  )

  const handleUseTranscriptAsQuestion = React.useCallback((segment: TranscriptSegment) => {
    setQuestion(`请结合上下文解释这段内容的重点：${segment.text}`)
    setVqaTab("chat")
    toast.success("已把片段设为提问草稿")
  }, [])

  const handleStopAnswer = React.useCallback(() => {
    chatAbortRef.current?.abort()
  }, [])

  const handleCancelTask = React.useCallback(async () => {
    if (!effectiveTask || !isRunningTask(effectiveTask.status)) {
      return
    }
    setIsCancelling(true)
    try {
      await cancelTask(taskId)
      toast.success("已发送取消任务请求")
      await loadTask({ showToastOnError: false })
    } catch (error) {
      if (error instanceof ApiError && error.code === "TASK_ALREADY_FINISHED") {
        await loadTask({ showToastOnError: false })
        toast.success("任务已经结束，界面已同步最新状态")
        return
      }
      toast.error(getApiErrorMessage(error, "取消任务失败"))
    } finally {
      setIsCancelling(false)
    }
  }, [effectiveTask, loadTask, taskId])

  const handlePauseTask = React.useCallback(async () => {
    if (!effectiveTask || !isRunningTask(effectiveTask.status)) {
      return
    }
    setIsPausing(true)
    try {
      await pauseTask(taskId)
      toast.success("任务已暂停")
      await loadTask({ showToastOnError: false })
    } catch (error) {
      toast.error(getApiErrorMessage(error, "暂停任务失败"))
    } finally {
      setIsPausing(false)
    }
  }, [effectiveTask, loadTask, taskId])

  const handleResumeTask = React.useCallback(async () => {
    if (!effectiveTask || !isPausedTask(effectiveTask.status)) {
      return
    }
    setIsResuming(true)
    try {
      await resumeTask(taskId)
      toast.success("任务已继续执行")
      await loadTask({ showToastOnError: false })
    } catch (error) {
      toast.error(getApiErrorMessage(error, "继续任务失败"))
    } finally {
      setIsResuming(false)
    }
  }, [effectiveTask, loadTask, taskId])

  const handleAddCitationToResearch = React.useCallback(
    (citation: VqaCitationItem) => {
      addItemToResearchBoard({
        type: "citation",
        title: `证据片段 · ${formatSecondsAsClock(citation.start)}`,
        content: citation.text,
        start: citation.start,
        end: citation.end,
        source: citation.source,
        sourceSet: citation.source_set || [],
      })
    },
    [addItemToResearchBoard],
  )

  const handleAppendResearchItemToNotes = React.useCallback((item: ResearchBoardItem) => {
    const timeRange =
      typeof item.start === "number" && typeof item.end === "number"
        ? `${formatSecondsAsClock(item.start)} - ${formatSecondsAsClock(item.end)}`
        : typeof item.start === "number"
          ? formatSecondsAsClock(item.start)
          : "未记录时间点"
    const line = `- ${timeRange} ${item.content}`
    setNotesDraft((current) => appendMarkdownSection(current, "补充线索", line))
    setNotesTab("notes")
    setIsEditingNotes(true)
    toast.success("已加入笔记草稿")
  }, [])

  const handleUseResearchItemAsQuestion = React.useCallback((item: ResearchBoardItem) => {
    setQuestion(`请结合上下文解释这段线索：${item.content}`)
    setVqaTab("chat")
    toast.success("已设为提问草稿")
  }, [])

  const evidenceTimelineItems = React.useMemo(() => {
    if (workflow === "notes") {
      return transcriptSegments.map((segment) => ({
        id: `${segment.start}-${segment.end}`,
        title: "转写片段",
        content: segment.text,
        start: segment.start,
        end: segment.end,
        source: segment.speaker || "transcript",
        sourceSet: [] as string[],
        taskTitle: effectiveTitle,
        taskId,
      }))
    }
    return chatHistory
      .flatMap((message) =>
        message.role === "assistant"
          ? message.citations.map((citation, index) => ({
              id: `${message.id}-${citation.doc_id}-${index}`,
              title: citation.task_title || "问答证据",
              content: citation.text,
              start: citation.start,
              end: citation.end,
              source: citation.source,
              sourceSet: citation.source_set || [],
              taskTitle: citation.task_title || effectiveTitle,
              taskId: citation.task_id,
            }))
          : [],
      )
      .sort((left, right) => left.start - right.start)
  }, [chatHistory, effectiveTitle, taskId, transcriptSegments, workflow])

  const selectedTrace = selectedTraceId ? traceCache[selectedTraceId] ?? null : null
  const traceStartedPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "trace_started"), [selectedTrace])
  const traceRetrievalPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "retrieval"), [selectedTrace])
  const traceLlmPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "llm_stream"), [selectedTrace])
  const traceFinishedPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "trace_finished"), [selectedTrace])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <TaskWorkspaceHeader
        effectiveTitle={effectiveTitle}
        workflow={workflow}
        updatedAt={effectiveTask?.updated_at || ""}
        totalProgress={totalProgress}
        errorMessage={effectiveTask?.error_message || ""}
        status={effectiveTask?.status || "queued"}
        steps={steps}
        onBack={onBack}
        isCancelling={isCancelling}
        isPausing={isPausing}
        isResuming={isResuming}
        canPause={isRunningTask(effectiveTask?.status)}
        canResume={isPausedTask(effectiveTask?.status)}
        onCancel={handleCancelTask}
        onPause={handlePauseTask}
        onResume={handleResumeTask}
        canExportBundle={effectiveTask?.status === "completed"}
        onExportBundle={handleExportBundle}
      />

      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={36}>
          <LeftWorkbenchPanel
            workflow={workflow}
            videoUrl={videoUrl}
            videoRef={videoRef}
            fallbackDurationSeconds={effectiveTask?.duration_seconds || 0}
            onSeek={jumpToTime}
            leftTab={leftTab}
            onLeftTabChange={setLeftTab}
            transcriptSegments={transcriptSegments}
            videoErrorMessage={videoLoadError}
            onVideoError={handleVideoError}
            errorMessage={errorMessage}
            isInitialLoading={isInitialLoading}
            isRefreshing={isRefreshing}
            onCopyTranscript={handleCopyTranscript}
            onDownloadTranscript={handleDownloadTranscript}
            onAddTranscriptToNotes={handleAddTranscriptToNotes}
            onUseTranscriptAsQuestion={handleUseTranscriptAsQuestion}
            onAddTranscriptToResearch={handleAddTranscriptToResearch}
            evidenceTimelineItems={evidenceTimelineItems}
            stageMetrics={effectiveTask?.vm_phase_metrics || {}}
            taskEvents={taskEvents}
            artifactTotalBytes={effectiveTask?.artifact_total_bytes || 0}
            artifactCount={effectiveTask?.artifact_index.length || 0}
            taskStatus={effectiveTask?.status || "queued"}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={50} minSize={34}>
          {workflow === "notes" ? (
            <NotesWorkbench
              taskId={taskId}
              effectiveTitle={effectiveTitle}
              notesTab={notesTab}
              onNotesTabChange={setNotesTab}
              summaryMarkdown={effectiveTask?.summary_markdown || ""}
              notesMarkdown={effectiveTask?.notes_markdown || ""}
              notesDraft={notesDraft}
              isEditingNotes={isEditingNotes}
              setIsEditingNotes={setIsEditingNotes}
              setNotesDraft={setNotesDraft}
              canEditArtifacts={canEditArtifacts}
              isSavingNotes={isSavingNotes}
              onSaveNotes={handleSaveNotes}
              onDownloadNotes={handleDownloadNotes}
              onSeek={jumpToTime}
              mindmapHtml={mindmapHtml}
              isMindmapLoading={isMindmapLoading}
              isTaskCompleted={effectiveTask?.status === "completed"}
              onAppendResearchItemToNotes={handleAppendResearchItemToNotes}
            />
          ) : (
            <VqaWorkbench
              taskId={taskId}
              effectiveTitle={effectiveTitle}
              vqaTab={vqaTab}
              onVqaTabChange={setVqaTab}
              chatHistory={chatHistory}
              question={question}
              onQuestionChange={setQuestion}
              isSearching={isSearching}
              onAskQuestion={handleAskQuestion}
              onStopAnswer={handleStopAnswer}
              onSeek={jumpToTime}
              onOpenTrace={handleLoadTrace}
              selectedTrace={selectedTrace}
              selectedTraceId={selectedTraceId}
              traceLoadingId={traceLoadingId}
              traceError={traceError}
              traceStartedPayload={traceStartedPayload}
              traceRetrievalPayload={traceRetrievalPayload}
              traceLlmPayload={traceLlmPayload}
              traceFinishedPayload={traceFinishedPayload}
              onAddCitationToResearch={handleAddCitationToResearch}
              onUseResearchItemAsQuestion={handleUseResearchItemAsQuestion}
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

interface TaskWorkspaceHeaderProps {
  effectiveTitle: string
  workflow: WorkflowType
  updatedAt: string
  totalProgress: number
  errorMessage: string
  status: string
  steps: TaskStepItem[]
  onBack: () => void
  isCancelling: boolean
  isPausing: boolean
  isResuming: boolean
  canPause: boolean
  canResume: boolean
  onCancel: () => void
  onPause: () => void
  onResume: () => void
  canExportBundle: boolean
  onExportBundle: () => void
}

const TaskWorkspaceHeader = React.memo(function TaskWorkspaceHeader({
  effectiveTitle,
  workflow,
  updatedAt,
  totalProgress,
  errorMessage,
  status,
  steps,
  onBack,
  isCancelling,
  isPausing,
  isResuming,
  canPause,
  canResume,
  onCancel,
  onPause,
  onResume,
  canExportBundle,
  onExportBundle,
}: TaskWorkspaceHeaderProps) {
  const statusSummary = getTaskStatusSummary(status, steps)
  return (
    <div className="border-b bg-card/50 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              返回
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <div>
              <h2 className="text-sm font-semibold">{effectiveTitle}</h2>
              <p className="text-xs text-muted-foreground">
                {workflow === "notes" ? "笔记整理工作区" : "视频问答工作区"} · 最近更新时间 {formatDateTime(updatedAt)}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {errorMessage ? <Badge variant="destructive">{errorMessage}</Badge> : null}
          <Badge variant={totalProgress >= 100 ? "default" : "secondary"}>
            {statusSummary} · {Math.round(totalProgress)}%
          </Badge>
          {canPause ? (
            <Button variant="outline" size="sm" disabled={isPausing} onClick={onPause}>
              {isPausing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Pause className="mr-1.5 h-4 w-4" />}
              暂停任务
            </Button>
          ) : null}
          {canResume ? (
            <Button variant="outline" size="sm" disabled={isResuming} onClick={onResume}>
              {isResuming ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              继续任务
            </Button>
          ) : null}
          {canPause ? (
            <Button variant="outline" size="sm" disabled={isCancelling} onClick={onCancel}>
              {isCancelling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
              取消任务
            </Button>
          ) : null}
          {canExportBundle ? (
            <Button variant="outline" size="sm" onClick={onExportBundle}>
              <Download className="mr-1.5 h-4 w-4" />
              导出结果包
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <Progress value={totalProgress} className="h-1.5" />
      </div>
      <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/55 px-3 py-1.5 text-xs">
              {getStepStatusIcon(step.status)}
              <span className={cn(step.status === "processing" && "font-medium text-primary")}>{step.name}</span>
              {step.duration ? <span className="text-muted-foreground">{step.duration}</span> : null}
            </div>
            {index < steps.length - 1 ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
})

interface VideoPreviewPaneProps {
  videoUrl: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  fallbackDurationSeconds: number
  transcriptSegments: TranscriptSegment[]
  videoErrorMessage: string
  onVideoError: (message: string) => void
  onSeek: (seconds: number) => void
  onActiveTranscriptChange: (segmentId: string) => void
}

const VideoPreviewPane = React.memo(function VideoPreviewPane({
  videoUrl,
  videoRef,
  fallbackDurationSeconds,
  transcriptSegments,
  videoErrorMessage,
  onVideoError,
  onSeek,
  onActiveTranscriptChange,
}: VideoPreviewPaneProps) {
  const [currentTime, setCurrentTime] = React.useState(0)
  const [totalDuration, setTotalDuration] = React.useState(fallbackDurationSeconds)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const activeTranscriptRef = React.useRef("")

  const syncActiveTranscript = React.useCallback(
    (time: number) => {
      const nextActiveId = findActiveTranscriptId(transcriptSegments, time)
      if (activeTranscriptRef.current === nextActiveId) {
        return
      }
      activeTranscriptRef.current = nextActiveId
      onActiveTranscriptChange(nextActiveId)
    },
    [onActiveTranscriptChange, transcriptSegments],
  )

  React.useEffect(() => {
    setCurrentTime(0)
    setTotalDuration(fallbackDurationSeconds)
    setIsPlaying(false)
    setIsMuted(false)
    activeTranscriptRef.current = ""
    onActiveTranscriptChange("")
    onVideoError("")

    const node = videoRef.current
    if (!node) {
      return
    }
    node.pause()
    if (videoUrl) {
      node.load()
      return
    }
    node.removeAttribute("src")
    node.load()
  }, [onActiveTranscriptChange, onVideoError, videoRef, videoUrl])

  React.useEffect(() => {
    setTotalDuration((current) => (current > 0 ? current : fallbackDurationSeconds))
  }, [fallbackDurationSeconds])

  React.useEffect(() => {
    syncActiveTranscript(videoRef.current?.currentTime ?? 0)
  }, [syncActiveTranscript, videoRef])

  const handleTogglePlay = React.useCallback(async () => {
    if (!videoRef.current) {
      return
    }
    if (videoRef.current.paused) {
      await videoRef.current.play()
      setIsPlaying(true)
      return
    }
    videoRef.current.pause()
    setIsPlaying(false)
  }, [videoRef])

  const handleSeekDelta = React.useCallback(
    (deltaSeconds: number) => {
      const referenceTime = videoRef.current?.currentTime ?? currentTime
      onSeek(referenceTime + deltaSeconds)
    },
    [currentTime, onSeek, videoRef],
  )

  const handleToggleMute = React.useCallback(() => {
    if (!videoRef.current) {
      return
    }
    videoRef.current.muted = !videoRef.current.muted
    setIsMuted(videoRef.current.muted)
  }, [videoRef])

  const handleFullscreen = React.useCallback(() => {
    if (videoRef.current?.requestFullscreen) {
      void videoRef.current.requestFullscreen()
      return
    }
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen()
      return
    }
    void document.exitFullscreen()
  }, [videoRef])

  return (
    <div className="relative aspect-video shrink-0 bg-black">
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 h-full w-full object-contain"
          preload="metadata"
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
          onDurationChange={(event) => {
            const nextDuration = event.currentTarget.duration || 0
            setTotalDuration(nextDuration || fallbackDurationSeconds)
          }}
          onLoadedMetadata={(event) => {
            const nextDuration = event.currentTarget.duration || 0
            setTotalDuration(nextDuration || fallbackDurationSeconds)
            setIsMuted(event.currentTarget.muted)
          }}
          onTimeUpdate={(event) => {
            const nextTime = event.currentTarget.currentTime
            setCurrentTime(nextTime)
            syncActiveTranscript(nextTime)
          }}
          onSeeked={(event) => {
            const nextTime = event.currentTarget.currentTime
            setCurrentTime(nextTime)
            syncActiveTranscript(nextTime)
          }}
          onCanPlay={() => onVideoError("")}
          onError={() => {
            setCurrentTime(0)
            setTotalDuration(fallbackDurationSeconds)
            onVideoError("当前视频预览加载失败，请检查源文件是否仍可访问。")
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/55">
          当前任务没有可预览的本地视频文件
        </div>
      )}
      {videoUrl && videoErrorMessage ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-6 text-center text-sm text-white/80">
          {videoErrorMessage}
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 to-transparent px-4 py-3">
        <input
          type="range"
          min={0}
          max={totalDuration || fallbackDurationSeconds || 0}
          step={0.1}
          value={Math.min(currentTime, totalDuration || fallbackDurationSeconds || currentTime)}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="mb-3 h-1.5 w-full cursor-pointer accent-primary"
        />
        <div className="flex items-center gap-2 text-white">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => void handleTogglePlay()}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => handleSeekDelta(-10)}>
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => handleSeekDelta(10)}>
            <SkipForward className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums">
            {formatSecondsAsClock(currentTime)} / {formatSecondsAsClock(totalDuration || fallbackDurationSeconds)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={handleToggleMute}>
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={handleFullscreen}>
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})

interface TranscriptSegmentCardProps {
  workflow: WorkflowType
  segment: TranscriptSegment
  isActive: boolean
  onSeek: (seconds: number) => void
  onAddTranscriptToNotes: (segment: TranscriptSegment) => void
  onUseTranscriptAsQuestion: (segment: TranscriptSegment) => void
  onAddTranscriptToResearch: (segment: TranscriptSegment) => void
}

const TranscriptSegmentCard = React.memo(function TranscriptSegmentCard({
  workflow,
  segment,
  isActive,
  onSeek,
  onAddTranscriptToNotes,
  onUseTranscriptAsQuestion,
  onAddTranscriptToResearch,
}: TranscriptSegmentCardProps) {
  return (
    <div
      className={cn(
        "workbench-collection-item rounded-xl border px-3 py-3 transition-colors",
        isActive ? "border-primary/35 bg-primary/8" : "border-border/60 bg-card/45",
      )}
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:min-w-28 lg:flex-col lg:items-start lg:gap-1.5">
          <Badge variant="outline" className="font-mono text-[11px]">
            {formatSecondsAsClock(segment.start)}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            至 {formatSecondsAsClock(segment.end)}
          </span>
          {segment.speaker ? <Badge variant="secondary" className="text-[11px]">{segment.speaker}</Badge> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-sm leading-6">{segment.text}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onSeek(segment.start)}>
              <MapPin className="mr-1.5 h-3.5 w-3.5" />
              定位
            </Button>
            {workflow === "notes" ? (
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onAddTranscriptToNotes(segment)}>
                <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                加入笔记
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onUseTranscriptAsQuestion(segment)}>
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                设为问题
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onAddTranscriptToResearch(segment)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                加入线索篮
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
})

interface LeftWorkbenchPanelProps {
  workflow: WorkflowType
  videoUrl: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  fallbackDurationSeconds: number
  onSeek: (seconds: number) => void
  leftTab: LeftTab
  onLeftTabChange: (value: LeftTab) => void
  transcriptSegments: TranscriptSegment[]
  videoErrorMessage: string
  onVideoError: (message: string) => void
  errorMessage: string
  isInitialLoading: boolean
  isRefreshing: boolean
  onCopyTranscript: () => void | Promise<void>
  onDownloadTranscript: () => void
  onAddTranscriptToNotes: (segment: TranscriptSegment) => void
  onUseTranscriptAsQuestion: (segment: TranscriptSegment) => void
  onAddTranscriptToResearch: (segment: TranscriptSegment) => void
  evidenceTimelineItems: Array<{
    id: string
    title: string
    content: string
    start: number
    taskTitle: string
    source?: string
  }>
  stageMetrics: Record<string, Record<string, unknown>>
  taskEvents: TaskStreamEvent[]
  artifactTotalBytes: number
  artifactCount: number
  taskStatus: string
}

const LeftWorkbenchPanel = React.memo(function LeftWorkbenchPanel({
  workflow,
  videoUrl,
  videoRef,
  fallbackDurationSeconds,
  onSeek,
  leftTab,
  onLeftTabChange,
  transcriptSegments,
  videoErrorMessage,
  onVideoError,
  errorMessage,
  isInitialLoading,
  isRefreshing,
  onCopyTranscript,
  onDownloadTranscript,
  onAddTranscriptToNotes,
  onUseTranscriptAsQuestion,
  onAddTranscriptToResearch,
  evidenceTimelineItems,
  stageMetrics,
  taskEvents,
  artifactTotalBytes,
  artifactCount,
  taskStatus,
}: LeftWorkbenchPanelProps) {
  const [activeTranscriptId, setActiveTranscriptId] = React.useState("")

  React.useEffect(() => {
    setActiveTranscriptId("")
  }, [videoUrl])

  const handleActiveTranscriptChange = React.useCallback((nextActiveId: string) => {
    setActiveTranscriptId((current) => (current === nextActiveId ? current : nextActiveId))
  }, [])

  const handleSeekWithTranscriptSync = React.useCallback(
    (seconds: number) => {
      const nextTime = Math.max(0, seconds)
      setActiveTranscriptId((current) => {
        const nextActiveId = findActiveTranscriptId(transcriptSegments, nextTime)
        return current === nextActiveId ? current : nextActiveId
      })
      onSeek(nextTime)
    },
    [onSeek, transcriptSegments],
  )

  return (
    <div className="flex h-full min-h-0 flex-col border-r">
      <VideoPreviewPane
        videoUrl={videoUrl}
        videoRef={videoRef}
        fallbackDurationSeconds={fallbackDurationSeconds}
        transcriptSegments={transcriptSegments}
        videoErrorMessage={videoErrorMessage}
        onVideoError={onVideoError}
        onSeek={handleSeekWithTranscriptSync}
        onActiveTranscriptChange={handleActiveTranscriptChange}
      />

      <Tabs value={leftTab} onValueChange={(value) => onLeftTabChange(value as LeftTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="transcript" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">转写片段</TabsTrigger>
          <TabsTrigger value="evidence" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">证据时间轴</TabsTrigger>
          <TabsTrigger value="stage" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">阶段输出</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h3 className="text-sm font-medium">转写文本</h3>
                <p className="text-xs text-muted-foreground">支持定位视频、加入笔记与线索篮。</p>
              </div>
              <div className="flex items-center gap-1">
                {isRefreshing ? <Badge variant="secondary">同步中</Badge> : null}
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void onCopyTranscript()}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  复制
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onDownloadTranscript}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  导出
                </Button>
              </div>
            </div>
            <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
              <div className="space-y-3 p-4">
                {errorMessage ? <div className="rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm text-destructive">{errorMessage}</div> : null}
                {isInitialLoading && transcriptSegments.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">正在加载任务详情...</div> : null}
                {!isInitialLoading && transcriptSegments.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                    {taskStatus === "running" || taskStatus === "queued"
                      ? "正在转写和整理内容，识别片段会实时出现在这里。"
                      : "当前还没有可展示的转写结果。"}
                  </div>
                ) : null}
                {transcriptSegments.map((segment) => {
                  const segmentId = `${segment.start}-${segment.end}`
                  return (
                    <TranscriptSegmentCard
                      key={segmentId}
                      workflow={workflow}
                      segment={segment}
                      isActive={activeTranscriptId === segmentId}
                      onSeek={handleSeekWithTranscriptSync}
                      onAddTranscriptToNotes={onAddTranscriptToNotes}
                      onUseTranscriptAsQuestion={onUseTranscriptAsQuestion}
                      onAddTranscriptToResearch={onAddTranscriptToResearch}
                    />
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        <TabsContent value="evidence" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
            <div className="space-y-3 p-4">
              {evidenceTimelineItems.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{workflow === "notes" ? "当前还没有时间轴内容。" : "先发起一次视频问答，这里会自动汇总命中证据。"}</div> : null}
              {evidenceTimelineItems.map((item) => (
                <div key={item.id} className="workbench-collection-item rounded-2xl border border-border/70 bg-card/65 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{item.title}</span>
                        <Badge variant="outline">{item.source || "timeline"}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{item.taskTitle}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => onSeek(item.start)}>
                      <MapPin className="mr-1.5 h-3.5 w-3.5" />
                      {formatSecondsAsClock(item.start)}
                    </Button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="stage" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
            <div className="space-y-4 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-border/70 bg-card/65 p-4"><p className="text-xs text-muted-foreground">任务状态</p><p className="mt-2 text-sm font-semibold">{getTaskStatusSummary(taskStatus, [])}</p></div>
                <div className="rounded-2xl border border-border/70 bg-card/65 p-4"><p className="text-xs text-muted-foreground">产物体积</p><p className="mt-2 text-sm font-semibold">{formatBytes(artifactTotalBytes)}</p></div>
                <div className="rounded-2xl border border-border/70 bg-card/65 p-4"><p className="text-xs text-muted-foreground">产物索引</p><p className="mt-2 text-sm font-semibold">{artifactCount} 项</p></div>
              </div>
              <Accordion type="single" collapsible className="rounded-2xl border border-border/70 bg-card/65 px-4">
                {Object.entries(stageMetrics).map(([key, value]) => {
                  const phase = asObject(value)
                  return (
                    <AccordionItem key={key} value={key}>
                      <AccordionTrigger>
                        <div className="flex flex-1 items-center justify-between gap-3 text-left">
                          <div>
                            <p className="text-sm font-medium">{VM_PHASE_LABELS[key] || key}</p>
                            <p className="text-xs text-muted-foreground">{asString(phase.reason) || "没有记录异常原因"}</p>
                          </div>
                          <Badge variant="secondary">{getVmPhaseStatusLabel(asString(phase.status))}</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-xs text-muted-foreground">
                          <p>开始时间 {asString(phase.started_at) || "-"}</p>
                          <p>结束时间 {asString(phase.completed_at) || "-"}</p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )
                })}
              </Accordion>
              <div className="rounded-2xl border border-border/70 bg-card/65 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-medium">最近阶段动态</h4>
                    <p className="mt-1 text-xs text-muted-foreground">仅保留关键阶段和进度更新，避免原始调试事件干扰阅读。</p>
                  </div>
                  {isRefreshing ? <Badge variant="secondary">同步中</Badge> : null}
                </div>
                <div className="mt-3 space-y-2">
                  {taskEvents.length > 0 ? taskEvents.map((event, index) => (
                    <div key={`${event.timestamp}-${index}`} className="workbench-collection-item rounded-xl border border-border/60 bg-background/55 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge variant="outline">{formatTaskEventBadge(event)}</Badge>
                        {formatTaskEventTimestamp(event.timestamp) ? <span className="text-muted-foreground">{formatTaskEventTimestamp(event.timestamp)}</span> : null}
                      </div>
                      <p className="mt-2 text-sm leading-6">{formatTaskEventMessage(event)}</p>
                    </div>
                  )) : <p className="text-sm text-muted-foreground">当前还没有可展示的阶段动态。</p>}
                </div>
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
})

interface NotesWorkbenchProps {
  taskId: string
  effectiveTitle: string
  notesTab: NotesTab
  onNotesTabChange: (value: NotesTab) => void
  summaryMarkdown: string
  notesMarkdown: string
  notesDraft: string
  isEditingNotes: boolean
  setIsEditingNotes: (value: boolean) => void
  setNotesDraft: React.Dispatch<React.SetStateAction<string>>
  canEditArtifacts: boolean
  isSavingNotes: boolean
  onSaveNotes: () => void | Promise<void>
  onDownloadNotes: () => void
  onSeek: (seconds: number) => void
  mindmapHtml: string
  isMindmapLoading: boolean
  isTaskCompleted: boolean
  onAppendResearchItemToNotes: (item: ResearchBoardItem) => void
}

const NotesWorkbench = React.memo(function NotesWorkbench({
  taskId,
  effectiveTitle,
  notesTab,
  onNotesTabChange,
  summaryMarkdown,
  notesMarkdown,
  notesDraft,
  isEditingNotes,
  setIsEditingNotes,
  setNotesDraft,
  canEditArtifacts,
  isSavingNotes,
  onSaveNotes,
  onDownloadNotes,
  onSeek,
  mindmapHtml,
  isMindmapLoading,
  isTaskCompleted,
  onAppendResearchItemToNotes,
}: NotesWorkbenchProps) {
  const markdownColorMode =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"

  return (
    <Tabs value={notesTab} onValueChange={(value) => onNotesTabChange(value as NotesTab)} className="workbench-detail-pane notes-workbench-pane flex h-full min-h-0 flex-col">
      <TabsList className="workbench-detail-tabs w-full justify-start rounded-none border-b bg-transparent p-0">
        <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">Markdown 工作区</TabsTrigger>
        <TabsTrigger value="mindmap" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">思维导图</TabsTrigger>
        <TabsTrigger value="research" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">线索篮</TabsTrigger>
      </TabsList>

      <TabsContent value="notes" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
          <div className="space-y-4 p-4">
            <div className="notes-workbench-actions flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={!canEditArtifacts} onClick={() => setIsEditingNotes(true)}>
                <Edit3 className="mr-1.5 h-4 w-4" />
                编辑笔记
              </Button>
              <Button variant="outline" size="sm" disabled={!isTaskCompleted} onClick={onDownloadNotes}>
                <Download className="mr-1.5 h-4 w-4" />
                导出 Markdown
              </Button>
            </div>
            <div className="notes-workbench-section rounded-2xl border border-border/70 bg-card/65 p-4">
              <h3 className="mb-3 text-sm font-medium">结构化摘要</h3>
              <MarkdownArtifactViewer taskId={taskId} markdown={summaryMarkdown} emptyMessage="当前还没有生成摘要内容" className="artifact-markdown-viewer-shell" onSeek={onSeek} />
            </div>
            <div className="notes-workbench-section rounded-2xl border border-border/70 bg-card/65 p-4">
              <h3 className="mb-3 text-sm font-medium">笔记 Markdown</h3>
              <MarkdownArtifactViewer taskId={taskId} markdown={notesMarkdown} emptyMessage="当前还没有生成笔记内容" className="artifact-markdown-viewer-shell" onSeek={onSeek} />
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="mindmap" className="workbench-pane-padded mt-0 min-h-0 flex-1 p-4">
        {isMindmapLoading ? <div className="workbench-pane-state flex h-full items-center justify-center rounded-2xl border border-border/70 bg-card/65 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在载入思维导图...</div> : null}
        {!isMindmapLoading && mindmapHtml ? <iframe title={`${effectiveTitle}-mindmap`} srcDoc={mindmapHtml} className="workbench-pane-frame h-full w-full rounded-2xl border border-border/70 bg-background" /> : null}
        {!isMindmapLoading && !mindmapHtml ? <div className="workbench-pane-state flex h-full items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">{isTaskCompleted ? "当前没有可展示的思维导图结果。" : "请等待任务完成后再预览思维导图。"}</div> : null}
      </TabsContent>

      <TabsContent value="research" className="workbench-pane-padded mt-0 min-h-0 flex-1">
        <ResearchBoardPanel onSeek={onSeek} onAppendToNotes={onAppendResearchItemToNotes} />
      </TabsContent>
      <Dialog open={isEditingNotes} onOpenChange={(open) => {
        if (!open) {
          setIsEditingNotes(false)
          setNotesDraft(notesMarkdown || "")
          return
        }
        setIsEditingNotes(true)
      }}>
        <DialogContent className="max-h-[80vh] w-[min(96vw,144rem)] max-w-[min(96vw,144rem)] overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>编辑 Markdown 笔记</DialogTitle>
            <DialogDescription>左侧修改内容，右侧实时预览。时间戳和图片链接会保持与工作区一致的渲染规则。</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-4 pt-4">
            <PromptMarkdownEditor
              value={notesDraft}
              colorMode={markdownColorMode}
              height={360}
              placeholder="在这里编辑任务笔记..."
              onChange={setNotesDraft}
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => {
                setIsEditingNotes(false)
                setNotesDraft(notesMarkdown || "")
              }}
            >
              取消
            </Button>
            <Button disabled={isSavingNotes} onClick={() => void onSaveNotes()}>
              {isSavingNotes ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Tabs>
  )
})

const VqaWorkbench = React.memo(function VqaWorkbench({
  taskId,
  effectiveTitle,
  vqaTab,
  onVqaTabChange,
  chatHistory,
  question,
  onQuestionChange,
  isSearching,
  onAskQuestion,
  onStopAnswer,
  onSeek,
  onOpenTrace,
  selectedTrace,
  selectedTraceId,
  traceLoadingId,
  traceError,
  traceStartedPayload,
  traceRetrievalPayload,
  traceLlmPayload,
  traceFinishedPayload,
  onAddCitationToResearch,
  onUseResearchItemAsQuestion,
}: VqaWorkbenchProps) {
  const [previewImage, setPreviewImage] = React.useState<{ src: string; title: string } | null>(null)

  return (
    <Tabs value={vqaTab} onValueChange={(value) => onVqaTabChange(value as VqaTab)} className="workbench-detail-pane vqa-workbench-pane flex h-full min-h-0 flex-col">
      <TabsList className="workbench-detail-tabs w-full justify-start rounded-none border-b bg-transparent p-0">
        <TabsTrigger value="chat" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">流式问答</TabsTrigger>
        <TabsTrigger value="trace" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">Trace Theater</TabsTrigger>
        <TabsTrigger value="research" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">线索篮</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
            <div className="space-y-4 p-4">
              {chatHistory.length === 0 ? <div className="workbench-pane-state rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">开始提问，系统会以流式方式输出回答和证据。</div> : null}
              {chatHistory.map((message) => (
                <div key={message.id} data-role={message.role} className={cn("vqa-chat-message workbench-collection-item flex gap-3", message.role === "user" && "justify-end")}>
                  {message.role === "assistant" ? <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">{message.status === "streaming" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</div> : null}
                  <div className={cn("vqa-chat-bubble max-w-[88%] space-y-3 rounded-2xl p-4", message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border/70 bg-card/70")}>
                    {message.role === "assistant" ? (
                      message.status === "streaming" && !message.content.trim() ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <span>{message.statusMessage || "正在准备回答..."}</span>
                          </div>
                          <div className="space-y-2">
                            <div className="h-2.5 w-32 rounded-full bg-muted/90 animate-pulse" />
                            <div className="h-2.5 w-56 rounded-full bg-muted/70 animate-pulse" />
                            <div className="flex items-center gap-1 pt-1">
                              {[0, 1, 2].map((dot) => (
                                <span
                                  key={`${message.id}-dot-${dot}`}
                                  className="h-1.5 w-1.5 rounded-full bg-primary/65 animate-pulse"
                                  style={{ animationDelay: `${dot * 140}ms` }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <MarkdownArtifactViewer
                          taskId={taskId}
                          markdown={message.content}
                          emptyMessage=""
                          className="min-w-0"
                          onSeek={onSeek}
                        />
                      )
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                    )}
                    {message.role === "assistant" ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {message.traceId ? <Badge variant="outline">检索链路: {message.traceId}</Badge> : null}
                          {message.contextTokensApprox ? <Badge variant="secondary">上下文约 {message.contextTokensApprox} tokens</Badge> : null}
                          {message.statusMessage && !(message.status === "streaming" && !message.content.trim()) ? (
                            <Badge variant="secondary">{message.statusMessage}</Badge>
                          ) : null}
                          {message.errorMessage ? <Badge variant="destructive">{message.errorMessage}</Badge> : null}
                        </div>
                        {message.traceId ? <Button variant="outline" size="sm" onClick={() => void onOpenTrace(message.traceId || "")}><Search className="mr-1.5 h-3.5 w-3.5" />查看检索链路</Button> : null}
                        {message.citations.length > 0 ? (
                          <div className="vqa-citation-list space-y-3">
                            {message.citations.map((citation, index) => (
                              <div key={`${message.id}-${citation.doc_id}-${index}`} className="workbench-collection-item rounded-xl border border-border/60 bg-background/55 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium">{citation.task_title || effectiveTitle}</span>
                                    <Badge variant="outline">{citation.source}</Badge>
                                    <Badge variant="secondary">{formatSecondsAsClock(citation.start)} - {formatSecondsAsClock(citation.end)}</Badge>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={() => onSeek(citation.start)}><MapPin className="mr-1.5 h-3.5 w-3.5" />跳转</Button>
                                    <Button variant="ghost" size="sm" onClick={() => onAddCitationToResearch(citation)}>
                                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                                      加入线索篮
                                    </Button>
                                  </div>
                                </div>
                                <div className="vqa-citation-layout mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_8rem]">
                                  <p className="whitespace-pre-wrap text-sm leading-6">{citation.text}</p>
                                  {citation.image_path ? (
                                    <button
                                      type="button"
                                      className="group block overflow-hidden rounded-xl"
                                      onClick={() =>
                                        setPreviewImage({
                                          src: buildTaskArtifactFileUrl(citation.task_id, citation.image_path),
                                          title: `${citation.task_title || effectiveTitle} · ${formatSecondsAsClock(citation.start)}`,
                                        })
                                      }
                                    >
                                      <img
                                        src={buildTaskArtifactFileUrl(citation.task_id, citation.image_path)}
                                        alt={citation.task_title || effectiveTitle}
                                        className="h-24 w-full rounded-xl border border-border/70 object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                        loading="lazy"
                                      />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="border-t px-4 py-4">
            <div className="vqa-chat-composer-row flex gap-2">
              <Input value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder="输入你的问题，系统会实时输出回答..." onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void onAskQuestion() } }} />
              {isSearching ? <Button variant="outline" onClick={onStopAnswer}><Square className="h-4 w-4" /></Button> : <Button onClick={() => void onAskQuestion()} disabled={!question.trim()}><Send className="h-4 w-4" /></Button>}
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="trace" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {!selectedTraceId ? <div className="workbench-pane-state rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">先在问答卡片里打开一条检索链路，这里会展示完整的召回、融合和回答过程。</div> : null}
            {traceError ? <div className="workbench-pane-state rounded-2xl border border-destructive/30 bg-destructive/6 p-4 text-sm text-destructive">{traceError}</div> : null}
            {selectedTraceId && traceLoadingId === selectedTraceId ? <div className="workbench-pane-state flex items-center justify-center rounded-2xl border border-border/70 bg-card/65 p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载 Trace 明细...</div> : null}
            {selectedTrace ? (
              <>
                <div className="workbench-pane-section rounded-2xl border border-border/70 bg-card/65 p-4">
                  <h3 className="text-sm font-medium">Trace 摘要</h3>
                  <p className="mt-2 text-xs text-muted-foreground">链路 ID: {selectedTrace.trace_id}</p>
                  <div className="vqa-trace-summary-grid mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">问题</p><p className="mt-1 text-sm">{asString(asObject(traceStartedPayload.metadata).query_text) || "未记录问题文本"}</p></div>
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">检索策略</p><p className="mt-1 text-sm">原问题直搜，不做查询扩展</p></div>
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">候选处理</p><p className="mt-1 text-sm">阶段内同文片段已去重</p></div>
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">完成状态</p><p className="mt-1 text-sm">{asString(traceFinishedPayload.ok) === "True" || asString(traceFinishedPayload.ok) === "true" ? "已完成" : asString(traceFinishedPayload.ok) ? "执行异常" : "未记录"}</p></div>
                  </div>
                </div>
                <Accordion type="single" collapsible className="rounded-2xl border border-border/70 bg-card/65 px-4">
                  {TRACE_SECTIONS.map((section) => {
                    const hits = dedupeTraceHits(asRecordArray(traceRetrievalPayload[section.key]))
                    return (
                      <AccordionItem key={section.key} value={section.key}>
                        <AccordionTrigger>
                          <div className="flex flex-1 items-center justify-between gap-3 text-left">
                            <div>
                              <p className="text-sm font-medium">{section.label}</p>
                              <p className="text-xs text-muted-foreground">{getTraceSectionHint(section.key)} 当前共 {hits.length} 条去重候选。</p>
                            </div>
                            <Badge variant="secondary">分数越大越相关</Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3">
                            {hits.map((hit, index) => (
                              <div key={`${section.key}-${index}-${asString(hit.doc_id)}`} className="workbench-collection-item rounded-xl border border-border/60 bg-background/55 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{asString(hit.task_title) || "未命名任务"}</span>
                                  <Badge variant="outline">{asString(hit.source) || "evidence"}</Badge>
                                  <Badge variant="secondary">分数 {formatTraceScore(hit[section.scoreKey])}</Badge>
                                  {asStringArray(hit.source_set).map((entry) => (
                                    <Badge key={`${section.key}-${index}-${entry}`} variant="outline">{entry}</Badge>
                                  ))}
                                </div>
                                <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_9rem]">
                                  <p className="whitespace-pre-wrap text-sm leading-6">{asString(hit.text)}</p>
                                  {asString(hit.image_path) ? (
                                    <button
                                      type="button"
                                      className="group block overflow-hidden rounded-xl"
                                      onClick={() =>
                                        setPreviewImage({
                                          src: buildTaskArtifactFileUrl(asString(hit.task_id) || taskId, asString(hit.image_path)),
                                          title: `${asString(hit.task_title) || effectiveTitle} · ${formatSecondsAsClock(asNumber(hit.start) || 0)}`,
                                        })
                                      }
                                    >
                                      <img
                                        src={buildTaskArtifactFileUrl(asString(hit.task_id) || taskId, asString(hit.image_path))}
                                        alt={asString(hit.task_title) || effectiveTitle}
                                        className="h-24 w-full rounded-xl border border-border/70 object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                        loading="lazy"
                                      />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                            {hits.length === 0 ? <p className="text-sm text-muted-foreground">这一阶段还没有可展示的命中记录。</p> : null}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
                <div className="workbench-pane-section rounded-2xl border border-border/70 bg-card/65 p-4">
                  <h3 className="text-sm font-medium">模型完成阶段</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{asString(traceLlmPayload.answer_preview) || "未记录回答预览"}</p>
                </div>
              </>
            ) : null}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="research" className="workbench-pane-padded mt-0 min-h-0 flex-1">
        <ResearchBoardPanel onSeek={onSeek} onUseAsQuestion={onUseResearchItemAsQuestion} />
      </TabsContent>
      <Dialog open={Boolean(previewImage)} onOpenChange={(open) => { if (!open) { setPreviewImage(null) } }}>
        <DialogContent className="max-w-[min(92vw,72rem)] p-0">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>证据画面预览</DialogTitle>
            <DialogDescription>{previewImage?.title || "点击证据缩略图后可在这里查看大图。"}</DialogDescription>
          </DialogHeader>
          <div className="bg-black/90 p-4">
            {previewImage ? <img src={previewImage.src} alt={previewImage.title} className="mx-auto max-h-[78vh] w-auto max-w-full rounded-xl object-contain" /> : null}
          </div>
        </DialogContent>
      </Dialog>
    </Tabs>
  )
})

interface VqaWorkbenchProps {
  taskId: string
  effectiveTitle: string
  vqaTab: VqaTab
  onVqaTabChange: (value: VqaTab) => void
  chatHistory: ChatMessage[]
  question: string
  onQuestionChange: (value: string) => void
  isSearching: boolean
  onAskQuestion: () => void | Promise<void>
  onStopAnswer: () => void
  onSeek: (seconds: number) => void
  onOpenTrace: (traceId: string) => void | Promise<void>
  selectedTrace: VqaTraceResponse | null
  selectedTraceId: string
  traceLoadingId: string
  traceError: string
  traceStartedPayload: Record<string, unknown>
  traceRetrievalPayload: Record<string, unknown>
  traceLlmPayload: Record<string, unknown>
  traceFinishedPayload: Record<string, unknown>
  onAddCitationToResearch: (citation: VqaCitationItem) => void
  onUseResearchItemAsQuestion: (item: ResearchBoardItem) => void
}
