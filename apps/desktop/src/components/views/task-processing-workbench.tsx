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
  Square,
  UserRound,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VirtualizedList } from "@/components/ui/virtualized-list"
import { PromptMarkdownEditor } from "@/components/editors/prompt-markdown-editor"
import { MarkdownArtifactViewer } from "@/components/ui/markdown-artifact-viewer"
import {
  ApiError,
  buildTaskSourceMediaUrl,
  cancelTask,
  downloadTaskArtifact,
  getApiErrorMessage,
  getChatTrace,
  getTaskArtifactFileJson,
  getTaskArtifactFileText,
  getTaskArtifactText,
  getTaskDetail,
  pauseTask,
  resumeTask,
  streamChatWithTask,
  streamTaskEvents,
  updateTaskArtifacts,
} from "@/lib/api"
import { formatBytes, formatDateTime, formatSecondsAsClock } from "@/lib/format"
import {
  buildTranscriptSegmentKey,
  getVqaStreamErrorText,
  getVqaStreamStatusText,
  isRetryableVqaStreamError,
  normalizeCorrectionPreviewMode,
  resolveDisplayedCorrectionSegments,
} from "@/lib/task-processing-runtime-helpers"
import {
  getTaskProcessingRuntimeState,
  mergeTaskAndLiveTranscriptSegments,
  useTaskProcessingRuntimeStore,
} from "@/stores/task-processing-runtime-store"
import type {
  RuntimeCorrectionPreviewMode as CorrectionPreviewMode,
  RuntimeChatMessage,
} from "@/stores/task-processing-runtime-types"
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
import { useShallow } from "zustand/react/shallow"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface TaskProcessingWorkbenchProps {
  taskId: string
  workflow: WorkflowType
  taskTitle: string
  onBack: () => void
  onTaskChanged: () => void
  onTaskLoaded?: (task: TaskDetailResponse) => void
}

interface StageChunkIndexEntry {
  relative_path?: string
}

interface StageChunkIndexPayload {
  mode?: string
  fallback_used?: boolean
  chunks?: StageChunkIndexEntry[]
}

interface VqaCitationImageEvidencePayload {
  frame_path?: string
  frame_uri?: string
  frame_index?: number
  frame_timestamp?: number
  width?: number
  height?: number
  thumbnail_uri?: string
}

type LeftTab = "transcript" | "correction" | "evidence" | "stage"
type NotesTab = "notes" | "mindmap"
type VqaTab = "chat" | "trace"

const EMPTY_TRANSCRIPT_SEGMENTS: TranscriptSegment[] = []

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
    { id: "transcript_vectorize", name: "文本向量化" },
    { id: "frame_extract", name: "视频抽帧" },
    { id: "frame_semantic", name: "画面语义识别" },
    { id: "multimodal_fusion", name: "多模态融合与就绪" },
  ],
}

const VM_PHASE_LABELS: Record<string, string> = {
  A: "阶段 A · 音频提取",
  B: "阶段 B · 媒体预处理",
  C: "阶段 C · 语音转写",
  transcript_optimize: "阶段 D1 · 文本优化",
  transcript_vectorize: "阶段 D2 · 文本向量化",
  frame_extract: "阶段 D3 · 视频抽帧",
  frame_semantic: "阶段 D4 · 画面语义识别",
  frame_vectorize: "阶段 D5 · 画面语义向量化",
  multimodal_index_fusion: "阶段 D6 · 多模态融合索引",
  multimodal_prewarm: "阶段 D6 · 多模态融合索引",
  fusion_delivery: "阶段 D7 · 结果交付",
  D: "阶段 D · 多模态交付",
}

const TASK_EVENT_BADGE_LABELS: Record<string, string> = {
  transcript_optimize: "文本优化",
  transcript_vectorize: "文本向量化",
  frame_extract: "视频抽帧",
  frame_semantic: "画面语义识别",
  frame_vectorize: "画面语义向量化",
  multimodal_index_fusion: "多模态融合索引",
  multimodal_prewarm: "多模态融合索引",
  fusion_delivery: "结果交付",
}

const VQA_SUBSTAGE_TO_STEP_ID: Record<string, string> = {
  transcript_vectorize: "transcript_vectorize",
  frame_extract: "frame_extract",
  frame_semantic: "frame_semantic",
  frame_vectorize: "frame_semantic",
  multimodal_index_fusion: "multimodal_fusion",
  multimodal_prewarm: "multimodal_fusion",
  fusion_delivery: "multimodal_fusion",
}

const TRACE_SECTIONS = [
  { key: "hits", label: "检索命中", scoreKey: "final_score" },
] as const

const VQA_CHAT_SESSION_STORAGE_KEY_PREFIX = "vidgnost:vqa-chat-session:v1"
const VQA_CHAT_MAX_TURNS = 15
const VQA_TRACE_CACHE_MAX_ITEMS = 8
const TRANSCRIPT_SCROLL_BREAK_THRESHOLD_PX = 120
const TRANSCRIPT_SCROLL_RESTORE_THRESHOLD_PX = 24

interface PersistedVqaSession {
  chatHistory: RuntimeChatMessage[]
  selectedTraceId: string
  traceCache: Record<string, VqaTraceResponse>
}

function canUseClientStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function buildVqaChatSessionStorageKey(taskId: string): string {
  return `${VQA_CHAT_SESSION_STORAGE_KEY_PREFIX}:${taskId}`
}

function sanitizeVqaCitationItem(value: unknown): VqaCitationItem | null {
  const payload = asObject(value)
  const docId = asString(payload.doc_id).trim()
  const taskId = asString(payload.task_id).trim()
  if (!docId || !taskId) {
    return null
  }
  const imageEvidencePayload = asObject(payload.image_evidence)
  const imageEvidence: VqaCitationImageEvidencePayload | undefined =
    Object.keys(imageEvidencePayload).length > 0
      ? {
        frame_path: asString(imageEvidencePayload.frame_path).trim() || undefined,
        frame_uri: asString(imageEvidencePayload.frame_uri).trim() || undefined,
        frame_index: asNumber(imageEvidencePayload.frame_index) ?? undefined,
        frame_timestamp: asNumber(imageEvidencePayload.frame_timestamp) ?? undefined,
        width: asNumber(imageEvidencePayload.width) ?? undefined,
        height: asNumber(imageEvidencePayload.height) ?? undefined,
        thumbnail_uri: asString(imageEvidencePayload.thumbnail_uri).trim() || undefined,
      }
      : undefined
  return {
    doc_id: docId,
    task_id: taskId,
    task_title: asString(payload.task_title),
    source: asString(payload.source),
    source_set: asStringArray(payload.source_set),
    start: asNumber(payload.start) ?? 0,
    end: asNumber(payload.end) ?? 0,
    text: asString(payload.text),
    citation_type:
      asString(payload.citation_type).trim() === "image"
        ? "image"
        : asString(payload.citation_type).trim() === "transcript"
          ? "transcript"
          : undefined,
    image_path: asString(payload.image_path).trim() || undefined,
    visual_text: asString(payload.visual_text).trim() || undefined,
    image_evidence: imageEvidence,
  }
}

function sanitizeRuntimeChatMessage(value: unknown): RuntimeChatMessage | null {
  const payload = asObject(value)
  const id = asString(payload.id).trim()
  const role = asString(payload.role).trim()
  if (!id || (role !== "user" && role !== "assistant")) {
    return null
  }
  const status = asString(payload.status).trim()
  return {
    id,
    role,
    content: asString(payload.content),
    status: status === "error" ? "error" : "done",
    citations: asRecordArray(payload.citations)
      .map((item) => sanitizeVqaCitationItem(item))
      .filter((item): item is VqaCitationItem => item !== null),
    traceId: asString(payload.traceId).trim() || undefined,
    contextTokensApprox: asNumber(payload.contextTokensApprox) ?? undefined,
    statusMessage: asString(payload.statusMessage).trim() || undefined,
    errorMessage: asString(payload.errorMessage).trim() || undefined,
  }
}

function sanitizeVqaTraceRecord(
  value: unknown,
): VqaTraceResponse["records"][number] | null {
  const payload = asObject(value)
  if (Object.keys(payload).length === 0) {
    return null
  }
  const nextRecord: Record<string, unknown> = { ...payload }
  if (asString(payload.stage).trim() === "retrieval") {
    const rawStagePayload = asObject(payload.payload)
    nextRecord.payload = {
      ...rawStagePayload,
      hits: asRecordArray(rawStagePayload.hits).map((item) => ({ ...item })),
    }
  }
  return nextRecord as VqaTraceResponse["records"][number]
}

function sanitizeVqaTraceResponse(value: unknown): VqaTraceResponse | null {
  const payload = asObject(value)
  const traceId = asString(payload.trace_id).trim()
  if (!traceId) {
    return null
  }
  return {
    trace_id: traceId,
    records: Array.isArray(payload.records)
      ? payload.records
        .map((item) => sanitizeVqaTraceRecord(item))
        .filter((item): item is VqaTraceResponse["records"][number] => item !== null)
      : [],
  }
}

function hasActiveAssistantStream(messages: RuntimeChatMessage[]): boolean {
  return messages.some((message) => message.role === "assistant" && message.status === "streaming")
}

function readPersistedVqaSession(taskId: string): PersistedVqaSession {
  if (!canUseClientStorage()) {
    return { chatHistory: [], selectedTraceId: "", traceCache: {} }
  }
  try {
    const raw = window.localStorage.getItem(buildVqaChatSessionStorageKey(taskId))
    if (!raw) {
      return { chatHistory: [], selectedTraceId: "", traceCache: {} }
    }
    const parsed = JSON.parse(raw) as unknown
    const payload = asObject(parsed)
    const chatHistory = Array.isArray(payload.chatHistory)
      ? payload.chatHistory
        .map((item) => sanitizeRuntimeChatMessage(item))
        .filter((item): item is RuntimeChatMessage => item !== null)
      : []
    const traceCache = limitTraceCacheEntries(Object.fromEntries(
      Object.entries(asObject(payload.traceCache))
        .map(([key, value]) => [key, sanitizeVqaTraceResponse(value)] as const)
        .filter((entry): entry is readonly [string, VqaTraceResponse] => entry[1] !== null),
    ), asString(payload.selectedTraceId).trim())
    const selectedTraceId = asString(payload.selectedTraceId).trim()
    return {
      chatHistory,
      selectedTraceId: selectedTraceId && traceCache[selectedTraceId] ? selectedTraceId : "",
      traceCache,
    }
  } catch {
    return { chatHistory: [], selectedTraceId: "", traceCache: {} }
  }
}

function persistVqaSession(taskId: string, payload: PersistedVqaSession): void {
  if (!canUseClientStorage()) {
    return
  }
  try {
    const normalizedTraceCache = limitTraceCacheEntries(payload.traceCache, payload.selectedTraceId)
    const hasContent =
      payload.chatHistory.length > 0 ||
      Boolean(payload.selectedTraceId) ||
      Object.keys(normalizedTraceCache).length > 0
    if (!hasContent) {
      window.localStorage.removeItem(buildVqaChatSessionStorageKey(taskId))
      return
    }
    window.localStorage.setItem(buildVqaChatSessionStorageKey(taskId), JSON.stringify({
      ...payload,
      traceCache: normalizedTraceCache,
    }))
  } catch {
    return
  }
}

function limitTraceCacheEntries(
  traceCache: Record<string, VqaTraceResponse>,
  preferredTraceId = "",
): Record<string, VqaTraceResponse> {
  const entries = Object.entries(traceCache)
  if (entries.length <= VQA_TRACE_CACHE_MAX_ITEMS) {
    return traceCache
  }

  const protectedKeys = new Set([preferredTraceId].filter(Boolean))
  const nextEntries = [...entries]
  while (nextEntries.length > VQA_TRACE_CACHE_MAX_ITEMS) {
    const removableIndex = nextEntries.findIndex(([traceId]) => !protectedKeys.has(traceId))
    if (removableIndex < 0) {
      break
    }
    nextEntries.splice(removableIndex, 1)
  }
  return Object.fromEntries(nextEntries)
}

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
      rerank_score: Math.max(asNumber(current.rerank_score) ?? 0, asNumber(hit.rerank_score) ?? 0),
      final_score: Math.max(asNumber(current.final_score) ?? 0, asNumber(hit.final_score) ?? 0),
      source_set: mergeTraceSourceSets(current.source_set, hit.source_set),
    })
  })
  return Array.from(deduped.values())
}

function getTraceSectionHint(sectionKey: (typeof TRACE_SECTIONS)[number]["key"]): string {
  switch (sectionKey) {
    case "hits":
      return "当前展示最终用于回答生成的统一检索命中，链路融合 transcript 与 frame semantic 证据，默认不做查询扩展。"
    default:
      return "这里展示当前阶段的去重候选。"
  }
}

function isImageCitation(citation: VqaCitationItem): boolean {
  return citation.citation_type === "image" || citation.source === "frame_semantic" || citation.source_set.includes("frame_semantic")
}

function getCitationPrimaryLabel(citation: VqaCitationItem): string {
  if (isImageCitation(citation)) {
    return "画面语义证据"
  }
  return "转写证据"
}

function getCitationSupportingText(citation: VqaCitationItem): string {
  if (citation.visual_text) {
    return citation.visual_text
  }
  if (isImageCitation(citation)) {
    return citation.text
  }
  return ""
}

function getCitationFrameReference(citation: VqaCitationItem): string {
  const imageEvidence = citation.image_evidence as VqaCitationImageEvidencePayload | undefined
  const parts: string[] = []
  if (typeof imageEvidence?.frame_index === "number") {
    parts.push(`帧 #${imageEvidence.frame_index}`)
  }
  if (typeof imageEvidence?.frame_timestamp === "number") {
    parts.push(`帧时间 ${formatSecondsAsClock(imageEvidence.frame_timestamp)}`)
  }
  if (imageEvidence?.frame_path) {
    parts.push(imageEvidence.frame_path)
  } else if (imageEvidence?.frame_uri) {
    parts.push(imageEvidence.frame_uri)
  } else if (citation.image_path) {
    parts.push(citation.image_path)
  }
  return parts.join(" · ")
}

function getTraceRetrievalStrategyText(traceStartedPayload: Record<string, unknown>): string {
  const configSnapshot = asObject(traceStartedPayload.config_snapshot)
  const retrieval = asObject(configSnapshot.retrieval)
  const mode = asString(retrieval.mode).trim()
  if (mode === "vector-index") {
    return "原问题直搜，不做查询扩展；统一向量索引融合 transcript 与 frame semantic。"
  }
  return "原问题直搜，不做查询扩展；当前链路使用统一多模态检索。"
}

function getTraceCandidateHandlingText(traceRetrievalPayload: Record<string, unknown>): string {
  const hits = asRecordArray(traceRetrievalPayload.hits)
  const sourceKinds = new Set(
    hits.flatMap((hit) => {
      const sourceSet = asStringArray(hit.source_set)
      if (sourceSet.length > 0) {
        return sourceSet
      }
      const source = asString(hit.source).trim()
      return source ? [source] : []
    }),
  )
  if (sourceKinds.has("transcript") && sourceKinds.has("frame_semantic")) {
    return "候选已按片段去重，并融合 transcript 与 frame semantic 的最终命中。"
  }
  if (sourceKinds.has("frame_semantic")) {
    return "候选已按片段去重，当前结果以 frame semantic 证据为主。"
  }
  return "候选已按片段去重，当前结果以 transcript 证据为主。"
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
  if (workflow === "vqa") {
    const mapped = VQA_SUBSTAGE_TO_STEP_ID[substage]
    if (mapped) {
      return mapped
    }
  }
  if (stage === "D" && rawType === "stage_complete") {
    return workflow === "notes" ? "notes" : "multimodal_fusion"
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

  const dMetricKey = [
    "transcript_vectorize",
    "frame_extract",
    "frame_semantic",
    "frame_vectorize",
    "multimodal_index_fusion",
    "multimodal_prewarm",
    "fusion_delivery",
  ].includes(substage)
    ? substage
    : null

  if (dMetricKey && (rawType === "substage_start" || rawType === "substage_complete")) {
    updateMetric(dMetricKey, (metric) => ({
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
    if (dMetricKey === "fusion_delivery" || dMetricKey === "multimodal_index_fusion" || dMetricKey === "multimodal_prewarm") {
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
    }
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
  const explicitSubstage = asString(event.substage).trim()
  const inferredSubstage =
    !explicitSubstage && asString(event.stage).trim() === "D"
      ? inferTranscriptOptimizeSubstageFromMessage(asString(event.message || event.text || event.title))
      : ""
  const substage = explicitSubstage || inferredSubstage
  if (substage) {
    return TASK_EVENT_BADGE_LABELS[substage] || substage
  }
  const stage = asString(event.stage).trim()
  if (stage) {
    return VM_PHASE_LABELS[stage] || `阶段 ${stage}`
  }
  return "任务动态"
}

function inferTranscriptOptimizeSubstageFromMessage(message: string): string {
  const normalized = message.trim()
  if (!normalized) {
    return ""
  }
  if (
    normalized === "Transcript optimization skipped because correction mode is off." ||
    normalized === "Running transcript correction strategy..." ||
    normalized.startsWith("Transcript rewrite skipped for long transcript") ||
    normalized.startsWith("Rewrite correction timed out") ||
    normalized.startsWith("Strict correction timed out") ||
    normalized === "Rewrite correction completed." ||
    normalized === "Strict correction completed with timeline preserved."
  ) {
    return "transcript_optimize"
  }
  if (
    normalized.includes("transcript vector") ||
    normalized.includes("文本向量化")
  ) {
    return "transcript_vectorize"
  }
  if (
    normalized.includes("extract frame") ||
    normalized.includes("视频抽帧")
  ) {
    return "frame_extract"
  }
  if (
    normalized.includes("frame semantic") ||
    normalized.includes("画面语义")
  ) {
    return "frame_semantic"
  }
  if (
    normalized.includes("multimodal index fusion") ||
    normalized.includes("多模态融合索引")
  ) {
    return "multimodal_index_fusion"
  }
  if (
    normalized === "多模态预热入口已就绪" ||
    normalized.includes("multimodal") ||
    normalized.includes("多模态预热")
  ) {
    return "multimodal_prewarm"
  }
  return ""
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
  if (normalized === "多模态预热入口已就绪") {
    return "多模态问答预热已完成，可直接复用 transcript 与 frame semantic 索引"
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
    return "全文润色完成，后续结果会基于润色后的文本生成"
  }
  if (normalized === "Strict correction completed with timeline preserved.") {
    return "逐段纠错完成，已保留原时间轴位置"
  }
  if (normalized.startsWith("Transcript rewrite skipped for long transcript")) {
    return "转写内容较长，本次未执行全文润色，后续结果会直接基于当前转写生成，以缩短等待时间"
  }
  if (normalized.startsWith("Rewrite correction timed out")) {
    return "全文润色等待超时，已直接使用当前转写继续后续处理"
  }
  if (normalized.startsWith("Strict correction timed out")) {
    return "逐段纠错等待超时，已直接使用当前转写继续后续处理"
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

function formatPreciseSecondsAsClock(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const wholeSeconds = Math.floor(safeSeconds)
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const secs = wholeSeconds % 60
  const millis = Math.round((safeSeconds - wholeSeconds) * 1000)
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

function extractChunkRelativePaths(payload: StageChunkIndexPayload | null): string[] {
  if (!payload || !Array.isArray(payload.chunks)) {
    return []
  }
  return payload.chunks
    .map((chunk) => asString(chunk?.relative_path).trim())
    .filter(Boolean)
}

async function loadStageChunkSegments(
  targetTaskId: string,
  paths: string[],
): Promise<TranscriptSegment[]> {
  if (!paths.length) {
    return []
  }
  const payloads = await Promise.all(
    paths.map((relativePath) =>
      getTaskArtifactFileJson<{ segments?: TranscriptSegment[] }>(targetTaskId, relativePath),
    ),
  )
  return mergeTranscriptSegments(
    [],
    payloads.flatMap((payload) => (Array.isArray(payload.segments) ? payload.segments : [])),
  )
}

const TaskProcessingNotesRuntimeEffects = React.memo(function TaskProcessingNotesRuntimeEffects({
  leftTab,
  effectiveTask,
  transcriptOptimizeStatus,
}: {
  leftTab: LeftTab
  effectiveTask: TaskDetailResponse | null
  transcriptOptimizeStatus: string
}) {
  const {
    taskTranscriptSegments,
    liveTranscript,
    rawTranscriptSegments,
    setRawTranscriptSegments,
    setPersistedRawTranscriptSegments,
    setPersistedCorrectionArtifacts,
    setIsCorrectionPreviewLoading,
  } = useTaskProcessingRuntimeStore(
    useShallow((state) => ({
      taskTranscriptSegments: state.task?.transcript_segments ?? EMPTY_TRANSCRIPT_SEGMENTS,
      liveTranscript: state.liveTranscript,
      rawTranscriptSegments: state.rawTranscriptSegments,
      setRawTranscriptSegments: state.setRawTranscriptSegments,
      setPersistedRawTranscriptSegments: state.setPersistedRawTranscriptSegments,
      setPersistedCorrectionArtifacts: state.setPersistedCorrectionArtifacts,
      setIsCorrectionPreviewLoading: state.setIsCorrectionPreviewLoading,
    })),
  )
  const transcriptSegments = React.useMemo(
    () => mergeTaskAndLiveTranscriptSegments(taskTranscriptSegments, liveTranscript),
    [liveTranscript, taskTranscriptSegments],
  )

  React.useEffect(() => {
    if (!effectiveTask) {
      return
    }
    if (transcriptOptimizeStatus && transcriptOptimizeStatus !== "pending") {
      return
    }
    setRawTranscriptSegments((current) => {
      const next = mergeTranscriptSegments([], transcriptSegments)
      if (
        current.length === next.length &&
        current.every(
          (item, index) =>
            item.start === next[index]?.start &&
            item.end === next[index]?.end &&
            item.text === next[index]?.text,
        )
      ) {
        return current
      }
      return next
    })
  }, [
    effectiveTask,
    setRawTranscriptSegments,
    transcriptOptimizeStatus,
    transcriptSegments,
  ])

  React.useEffect(() => {
    if (leftTab !== "correction" || !effectiveTask) {
      return
    }
    let cancelled = false
    setIsCorrectionPreviewLoading(true)

    const loadPersistedCorrectionArtifacts = async () => {
      const taskIdValue = effectiveTask.id
      const correctionIndexResult = await getTaskArtifactFileJson<StageChunkIndexPayload>(
        taskIdValue,
        "D/transcript-optimize/index.json",
      ).catch(() => null)
      const correctionTextResult = await getTaskArtifactFileText(
        taskIdValue,
        "D/transcript-optimize/full.txt",
      ).catch(() => "")
      const rawTranscriptIndexResult = await getTaskArtifactFileJson<StageChunkIndexPayload>(
        taskIdValue,
        "C/transcript/index.json",
      ).catch(() => null)

      if (cancelled) {
        return
      }

      setPersistedCorrectionArtifacts({
        mode: normalizeCorrectionPreviewMode(correctionIndexResult?.mode),
        fallbackUsed: Boolean(correctionIndexResult?.fallback_used),
        text: correctionTextResult,
      })

      if (rawTranscriptSegments.length > 0) {
        setPersistedRawTranscriptSegments(rawTranscriptSegments)
      } else {
        const rawChunkPaths = extractChunkRelativePaths(rawTranscriptIndexResult)
        if (rawChunkPaths.length > 0) {
          const nextSegments = await loadStageChunkSegments(taskIdValue, rawChunkPaths).catch(() => [])
          if (!cancelled) {
            setPersistedRawTranscriptSegments(nextSegments)
          }
        }
      }
    }

    void loadPersistedCorrectionArtifacts().finally(() => {
      if (!cancelled) {
        setIsCorrectionPreviewLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    effectiveTask,
    leftTab,
    rawTranscriptSegments,
    setIsCorrectionPreviewLoading,
    setPersistedCorrectionArtifacts,
    setPersistedRawTranscriptSegments,
  ])

  return null
})

export function TaskProcessingWorkbench({
  taskId,
  workflow,
  taskTitle,
  onBack,
  onTaskChanged,
  onTaskLoaded,
}: TaskProcessingWorkbenchProps) {
  const [leftTab, setLeftTab] = React.useState<LeftTab>("transcript")
  const [notesTab, setNotesTab] = React.useState<NotesTab>("notes")
  const [vqaTab, setVqaTab] = React.useState<VqaTab>("chat")
  const [question, setQuestion] = React.useState("")
  const [videoLoadError, setVideoLoadError] = React.useState("")
  const [notesDraft, setNotesDraft] = React.useState("")
  const [isEditingNotes, setIsEditingNotes] = React.useState(false)
  const [isSavingNotes, setIsSavingNotes] = React.useState(false)
  const [mindmapHtml, setMindmapHtml] = React.useState("")
  const [mindmapKey, setMindmapKey] = React.useState("")
  const [isMindmapLoading, setIsMindmapLoading] = React.useState(false)
  const [isCancelling, setIsCancelling] = React.useState(false)
  const [isPausing, setIsPausing] = React.useState(false)
  const [isResuming, setIsResuming] = React.useState(false)
  const [isWorkbenchResizing, setIsWorkbenchResizing] = React.useState(false)
  const [isChatLimitConfirmOpen, setIsChatLimitConfirmOpen] = React.useState(false)
  const [pendingQuestionAfterReset, setPendingQuestionAfterReset] = React.useState("")
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const refreshTimerRef = React.useRef<number | null>(null)
  const persistVqaSessionTimerRef = React.useRef<number | null>(null)
  const chatAbortRef = React.useRef<AbortController | null>(null)
  const hasLoadedTaskRef = React.useRef(false)
  const hasHydratedPersistedVqaSessionRef = React.useRef(false)
  const latestPersistedVqaSessionRef = React.useRef<PersistedVqaSession | null>(null)
  const isEditingNotesRef = React.useRef(isEditingNotes)
  const onTaskLoadedRef = React.useRef(onTaskLoaded)
  const loadTaskRequestIdRef = React.useRef(0)
  const isWorkbenchMountedRef = React.useRef(true)
  const eventQueueRef = React.useRef<TaskStreamEvent[]>([])
  const eventFrameRef = React.useRef<number | null>(null)

  const {
    task,
    chatHistory,
    isInitialLoading,
    isRefreshing,
    taskErrorMessage,
    resetRuntime,
    resetChat,
    setLoadingState,
    setTask,
    setTaskErrorMessage,
    updateTask,
    applyTaskEventBatch,
    appendChatMessages,
    setChatStreaming,
    upsertChatMessage,
    setSelectedTraceId,
    selectedTraceId,
    setTraceLoadingId,
    setTraceError,
    traceCache,
    upsertTraceCache,
    clearTraceCache,
  } = useTaskProcessingRuntimeStore(
    useShallow((state) => ({
      task: state.task,
      chatHistory: state.chatHistory,
      isInitialLoading: state.isInitialLoading,
      isRefreshing: state.isRefreshing,
      taskErrorMessage: state.taskErrorMessage,
      resetRuntime: state.resetRuntime,
      resetChat: state.resetChat,
      setLoadingState: state.setLoadingState,
      setTask: state.setTask,
      setTaskErrorMessage: state.setTaskErrorMessage,
      updateTask: state.updateTask,
      applyTaskEventBatch: state.applyTaskEventBatch,
      appendChatMessages: state.appendChatMessages,
      setChatStreaming: state.setChatStreaming,
      upsertChatMessage: state.upsertChatMessage,
      setSelectedTraceId: state.setSelectedTraceId,
      selectedTraceId: state.selectedTraceId,
      setTraceLoadingId: state.setTraceLoadingId,
      setTraceError: state.setTraceError,
      traceCache: state.traceCache,
      upsertTraceCache: state.upsertTraceCache,
      clearTraceCache: state.clearTraceCache,
    })),
  )

  React.useEffect(() => {
    isEditingNotesRef.current = isEditingNotes
  }, [isEditingNotes])

  React.useEffect(() => {
    onTaskLoadedRef.current = onTaskLoaded
  }, [onTaskLoaded])

  React.useEffect(() => {
    isWorkbenchMountedRef.current = true
    return () => {
      isWorkbenchMountedRef.current = false
      loadTaskRequestIdRef.current += 1
    }
  }, [])

  React.useEffect(() => {
    loadTaskRequestIdRef.current += 1
    hasLoadedTaskRef.current = false
    hasHydratedPersistedVqaSessionRef.current = false
    resetRuntime()
    setLeftTab("transcript")
    setNotesTab("notes")
    setVqaTab("chat")
    setQuestion("")
    setVideoLoadError("")
    setMindmapHtml("")
    setMindmapKey("")
    setNotesDraft("")
    setPendingQuestionAfterReset("")
    setIsChatLimitConfirmOpen(false)
    if (eventFrameRef.current !== null) {
      window.cancelAnimationFrame(eventFrameRef.current)
      eventFrameRef.current = null
    }
    eventQueueRef.current = []
  }, [taskId, workflow])

  React.useEffect(() => {
    return () => {
      chatAbortRef.current?.abort()
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
      if (persistVqaSessionTimerRef.current !== null) {
        window.clearTimeout(persistVqaSessionTimerRef.current)
        persistVqaSessionTimerRef.current = null
      }
      if (workflow === "vqa" && latestPersistedVqaSessionRef.current) {
        persistVqaSession(taskId, latestPersistedVqaSessionRef.current)
      }
      if (eventFrameRef.current !== null) {
        window.cancelAnimationFrame(eventFrameRef.current)
      }
    }
  }, [taskId, workflow])

  const loadTask = React.useCallback(
    async (options?: { showToastOnError?: boolean; background?: boolean }) => {
      const requestId = loadTaskRequestIdRef.current + 1
      loadTaskRequestIdRef.current = requestId
      const showToastOnError = options?.showToastOnError ?? true
      const background = options?.background ?? hasLoadedTaskRef.current

      const isActiveRequest = () =>
        isWorkbenchMountedRef.current && requestId === loadTaskRequestIdRef.current

      setLoadingState({
        isInitialLoading: background ? undefined : true,
        isRefreshing: background,
      })
      let nextDetail: TaskDetailResponse | null = null
      try {
        const detail = await getTaskDetail(taskId)
        if (!isActiveRequest()) {
          return null
        }
        setTask(detail)
        setTaskErrorMessage("")
        hasLoadedTaskRef.current = true
        onTaskLoadedRef.current?.(detail)
        if (!isEditingNotesRef.current) {
          setNotesDraft(detail.notes_markdown || "")
        }
        nextDetail = detail
      } catch (error) {
        if (!isActiveRequest()) {
          return null
        }
        const message = getApiErrorMessage(error, "加载任务详情失败")
        setTaskErrorMessage(message)
        if (showToastOnError) {
          toast.error(message)
        }
        return null
      } finally {
        if (isActiveRequest()) {
          setLoadingState({
            isInitialLoading: false,
            isRefreshing: false,
          })
        }
      }
      return nextDetail
    },
    [setLoadingState, setTask, setTaskErrorMessage, taskId],
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

  React.useEffect(() => {
    if (workflow !== "vqa") {
      return
    }
    const persistedSession = readPersistedVqaSession(taskId)
    resetChat()
    clearTraceCache()
    if (persistedSession.chatHistory.length > 0) {
      appendChatMessages(persistedSession.chatHistory)
    }
    Object.entries(persistedSession.traceCache).forEach(([traceId, payload]) => {
      upsertTraceCache(traceId, payload)
    })
    if (persistedSession.selectedTraceId) {
      setSelectedTraceId(persistedSession.selectedTraceId)
    }
    hasHydratedPersistedVqaSessionRef.current = true
  }, [appendChatMessages, clearTraceCache, resetChat, setSelectedTraceId, taskId, upsertTraceCache, workflow])

  React.useEffect(() => {
    if (workflow !== "vqa" || !hasHydratedPersistedVqaSessionRef.current) {
      return
    }
    latestPersistedVqaSessionRef.current = {
      chatHistory,
      selectedTraceId,
      traceCache,
    }
    if (persistVqaSessionTimerRef.current !== null) {
      window.clearTimeout(persistVqaSessionTimerRef.current)
    }
    persistVqaSessionTimerRef.current = window.setTimeout(() => {
      persistVqaSession(taskId, latestPersistedVqaSessionRef.current || {
        chatHistory,
        selectedTraceId,
        traceCache,
      })
      persistVqaSessionTimerRef.current = null
    }, 180)
    return () => {
      if (persistVqaSessionTimerRef.current !== null) {
        window.clearTimeout(persistVqaSessionTimerRef.current)
        persistVqaSessionTimerRef.current = null
      }
    }
  }, [chatHistory, selectedTraceId, taskId, traceCache, workflow])

  const liveTaskId = task?.id || ""
  const liveTaskStatus = task?.status || ""

  React.useEffect(() => {
    if (!liveTaskId || !isRunningTask(liveTaskStatus)) {
      return
    }
    const flushQueuedEvents = () => {
      eventFrameRef.current = null
      if (eventQueueRef.current.length === 0) {
        return
      }
      const batch = eventQueueRef.current.splice(0, eventQueueRef.current.length)
      React.startTransition(() => {
        applyTaskEventBatch(batch)
      })
    }
    const source = streamTaskEvents(liveTaskId, (event) => {
      const rawType = getRawTaskEventType(event)
      eventQueueRef.current.push(event)
      if (eventFrameRef.current === null) {
        eventFrameRef.current = window.requestAnimationFrame(flushQueuedEvents)
      }
      const shouldRefreshImmediately =
        rawType === "task_complete" ||
        rawType === "task_paused" ||
        rawType === "task_cancelled" ||
        rawType === "task_failed"
      if (shouldRefreshImmediately) {
        flushQueuedEvents()
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
      if (eventFrameRef.current !== null) {
        window.cancelAnimationFrame(eventFrameRef.current)
        eventFrameRef.current = null
      }
      eventQueueRef.current = []
    }
  }, [applyTaskEventBatch, liveTaskId, liveTaskStatus, loadTask])

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
  const totalProgress = effectiveTask?.overall_progress ?? 0
  const videoUrl = effectiveTask?.source_local_path ? buildTaskSourceMediaUrl(effectiveTask.id) : ""
  const canEditArtifacts = isTerminalTask(effectiveTask?.status)
  const transcriptOptimizeStatus = asString(effectiveTask?.vm_phase_metrics?.transcript_optimize?.status).trim().toLowerCase()
  const closeStreamingAssistantMessages = React.useCallback((statusMessage: string) => {
    const { chatHistory: currentChatHistory } = getTaskProcessingRuntimeState()
    currentChatHistory
      .filter((message) => message.role === "assistant" && message.status === "streaming")
      .forEach((message) => {
        upsertChatMessage(message.id, (current) => ({
          ...current,
          content: current.content.trim() || "本次流式回答已停止。",
          status: current.errorMessage ? "error" : "done",
          statusMessage,
        }))
      })
  }, [upsertChatMessage])

  const jumpToTime = React.useCallback(
    (time: number) => {
      const nextTime = Math.max(0, time)
      if (videoRef.current) {
        videoRef.current.currentTime = nextTime
      }
    },
    [],
  )

  const executeAskQuestion = React.useCallback(async (
    questionText: string,
    options?: { resetBeforeSend?: boolean },
  ) => {
    const trimmedQuestion = questionText.trim()
    const runtimeState = getTaskProcessingRuntimeState()
    if (!trimmedQuestion || runtimeState.isChatStreaming || hasActiveAssistantStream(runtimeState.chatHistory) || !effectiveTask) {
      return
    }
    if (options?.resetBeforeSend) {
      resetChat()
      clearTraceCache()
    }
    chatAbortRef.current?.abort()
    const controller = new AbortController()
    const userId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()
    chatAbortRef.current = controller
    setQuestion("")
    setVqaTab("chat")
    setChatStreaming(true)
    appendChatMessages([
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
            upsertChatMessage(assistantId, (current) => {
              const next = { ...current }
              if (event.trace_id) next.traceId = asString(event.trace_id).trim() || undefined
              if (event.type === "citations") {
                next.citations = asRecordArray(event.citations)
                  .map((item) => sanitizeVqaCitationItem(item))
                  .filter((item): item is VqaCitationItem => item !== null)
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
              if (event.type === "done") {
                next.status = next.errorMessage ? "error" : "done"
              }
              return next
            })
          },
        },
      )
      upsertChatMessage(assistantId, (current) => ({
        ...current,
        content: current.content.trim() || current.errorMessage || "未生成回答。",
        status: current.errorMessage ? "error" : "done",
      }))
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        upsertChatMessage(assistantId, (current) => ({
          ...current,
          content: current.content.trim() || "本次流式回答已停止。",
          status: "done",
          statusMessage: "已手动停止",
        }))
      } else {
        const message = getVqaRequestFailureMessage(error)
        upsertChatMessage(assistantId, (current) => ({
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
      setChatStreaming(false)
    }
  }, [
    appendChatMessages,
    clearTraceCache,
    effectiveTask,
    resetChat,
    setChatStreaming,
    setQuestion,
    setVqaTab,
    taskId,
    upsertChatMessage,
  ])

  const handleAskQuestion = React.useCallback(async () => {
    const trimmedQuestion = question.trim()
    const runtimeState = getTaskProcessingRuntimeState()
    if (!trimmedQuestion || runtimeState.isChatStreaming || hasActiveAssistantStream(runtimeState.chatHistory) || !effectiveTask) {
      return
    }
    const userTurnCount = chatHistory.filter((message) => message.role === "user").length
    if (userTurnCount >= VQA_CHAT_MAX_TURNS) {
      setPendingQuestionAfterReset(trimmedQuestion)
      setIsChatLimitConfirmOpen(true)
      return
    }
    await executeAskQuestion(trimmedQuestion)
  }, [chatHistory, effectiveTask, executeAskQuestion, question])

  const handleConfirmChatResetAndContinue = React.useCallback(() => {
    const nextQuestion = pendingQuestionAfterReset.trim()
    setIsChatLimitConfirmOpen(false)
    setPendingQuestionAfterReset("")
    if (!nextQuestion) {
      return
    }
    void executeAskQuestion(nextQuestion, { resetBeforeSend: true })
  }, [executeAskQuestion, pendingQuestionAfterReset])

  const handleLoadTrace = React.useCallback(
    async (traceId: string) => {
      if (!traceId) {
        return
      }
      setSelectedTraceId(traceId)
      setTraceError("")
      setVqaTab("trace")
      if (getTaskProcessingRuntimeState().traceCache[traceId]) {
        return
      }
      setTraceLoadingId(traceId)
      try {
        const payload = await getChatTrace(traceId)
        const sanitizedPayload = sanitizeVqaTraceResponse(payload)
        if (!sanitizedPayload) {
          throw new Error("Trace 数据格式无效")
        }
        upsertTraceCache(traceId, sanitizedPayload)
      } catch (error) {
        setTraceError(getApiErrorMessage(error, "加载 Trace 明细失败"))
      } finally {
        setTraceLoadingId("")
      }
    },
    [setSelectedTraceId, setTraceError, setTraceLoadingId, setVqaTab, upsertTraceCache],
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
        if (kind === "notes") {
          toast.success("Markdown 导出完成，文件已开始下载")
          return
        }
        if (kind === "bundle") {
          toast.success("结果包导出完成，文件已开始下载")
        }
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
  }, [setVideoLoadError])

  const handleSaveNotes = React.useCallback(async () => {
    if (!canEditArtifacts) {
      toast.error("请等待任务进入终态后再保存笔记")
      return
    }
    setIsSavingNotes(true)
    try {
      const updated = await updateTaskArtifacts(taskId, { notes_markdown: notesDraft })
      updateTask(() => updated)
      setIsEditingNotes(false)
      toast.success("笔记已保存")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "保存笔记失败"))
    } finally {
      setIsSavingNotes(false)
    }
  }, [canEditArtifacts, notesDraft, taskId, updateTask])

  const handleAddTranscriptToNotes = React.useCallback((segment: TranscriptSegment) => {
    setNotesDraft((current) => appendMarkdownSection(current, "补充引用片段", buildTranscriptSnippet(segment)))
    setIsEditingNotes(true)
    setNotesTab("notes")
    toast.success("已加入笔记草稿")
  }, [])

  const handleUseTranscriptAsQuestion = React.useCallback((segment: TranscriptSegment) => {
    setQuestion(`请结合上下文解释这段内容的重点：${segment.text}`)
    setVqaTab("chat")
    toast.success("已把片段设为提问草稿")
  }, [])

  const handleStopAnswer = React.useCallback(() => {
    chatAbortRef.current?.abort()
    setChatStreaming(false)
    closeStreamingAssistantMessages("已手动停止")
  }, [closeStreamingAssistantMessages, setChatStreaming])

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

  return (
    <div
      data-layout-interacting={isWorkbenchResizing ? "true" : "false"}
      className="task-processing-workbench-shell flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <TaskProcessingNotesRuntimeEffects
        leftTab={leftTab}
        effectiveTask={effectiveTask}
        transcriptOptimizeStatus={transcriptOptimizeStatus}
      />
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
            taskId={taskId}
            effectiveTitle={effectiveTitle}
            videoUrl={videoUrl}
            videoRef={videoRef}
            fallbackDurationSeconds={effectiveTask?.duration_seconds || 0}
            onSeek={jumpToTime}
            leftTab={leftTab}
            onLeftTabChange={setLeftTab}
            videoErrorMessage={videoLoadError}
            onVideoError={handleVideoError}
            errorMessage={taskErrorMessage}
            isInitialLoading={isInitialLoading}
            isRefreshing={isRefreshing}
            onCopyTranscript={handleCopyTranscript}
            onDownloadTranscript={handleDownloadTranscript}
            onAddTranscriptToNotes={handleAddTranscriptToNotes}
            onUseTranscriptAsQuestion={handleUseTranscriptAsQuestion}
            correctionStatus={transcriptOptimizeStatus}
            stageMetrics={effectiveTask?.vm_phase_metrics || {}}
            artifactTotalBytes={effectiveTask?.artifact_total_bytes || 0}
            artifactCount={effectiveTask?.artifact_index.length || 0}
            taskStatus={effectiveTask?.status || "queued"}
          />
        </ResizablePanel>

        <ResizableHandle withHandle onDragging={setIsWorkbenchResizing} />

        <ResizablePanel defaultSize={50} minSize={34}>
          {isInitialLoading && !effectiveTask ? (
            <TaskWorkbenchDetailLoading workflow={workflow} />
          ) : !effectiveTask ? (
            <TaskWorkbenchDetailState message={taskErrorMessage || "任务详情暂时不可用，请稍后重试。"} />
          ) : workflow === "notes" ? (
            <NotesWorkbench
              taskId={taskId}
              effectiveTitle={effectiveTitle}
              notesTab={notesTab}
              onNotesTabChange={setNotesTab}
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
            />
          ) : (
            <VqaWorkbench
              taskId={taskId}
              effectiveTitle={effectiveTitle}
              vqaTab={vqaTab}
              onVqaTabChange={setVqaTab}
              question={question}
              onQuestionChange={setQuestion}
              onAskQuestion={handleAskQuestion}
              onStopAnswer={handleStopAnswer}
              onSeek={jumpToTime}
              onOpenTrace={handleLoadTrace}
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      <ConfirmDialog
        open={isChatLimitConfirmOpen}
        onOpenChange={(open) => {
          setIsChatLimitConfirmOpen(open)
          if (!open) {
            setPendingQuestionAfterReset("")
          }
        }}
        title="对话轮次即将重置"
        description={`当前流式问答最多保留 ${VQA_CHAT_MAX_TURNS} 轮提问记录。继续发送后，将自动清空现有对话内容并开始新一轮会话，是否继续？`}
        confirmLabel="继续并清空"
        cancelLabel="取消"
        onConfirm={handleConfirmChatResetAndContinue}
      />
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
            <Button variant="outline" size="sm" className="task-workbench-primary-action" onClick={onExportBundle}>
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
}

function TranscriptActionIconButton({
  label,
  onClick,
  variant = "ghost",
  className,
  children,
}: {
  label: string
  onClick: () => void
  variant?: "ghost" | "outline"
  className?: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size="icon"
          className={cn("transcript-segment-icon-button h-8 w-8 rounded-lg text-muted-foreground", className)}
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

const TranscriptSegmentCard = React.memo(function TranscriptSegmentCard({
  workflow,
  segment,
  isActive,
  onSeek,
  onAddTranscriptToNotes,
  onUseTranscriptAsQuestion,
}: TranscriptSegmentCardProps) {
  return (
    <div
      className={cn(
        "workbench-collection-item transcript-segment-card rounded-xl border px-4 py-3.5 transition-colors",
        isActive
          ? "border-primary/35 bg-primary/8 shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
          : "border-border/60 bg-card/45",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="transcript-segment-timestamp inline-flex items-center rounded-full border border-primary/20 bg-primary/[0.08] px-2.5 py-1 font-mono text-[11px] font-semibold leading-none tracking-[0.06em] text-primary">
              {formatPreciseSecondsAsClock(segment.start)} - {formatPreciseSecondsAsClock(segment.end)}
            </span>
            {segment.speaker ? <Badge variant="secondary" className="text-[11px]">{segment.speaker}</Badge> : null}
          </div>
          <p className="mt-2.5 whitespace-pre-wrap text-sm leading-6">{segment.text}</p>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <TranscriptActionIconButton label="定位到视频时间点" onClick={() => onSeek(segment.start)}>
            <MapPin className="h-4 w-4" />
          </TranscriptActionIconButton>
          {workflow === "notes" ? (
            <TranscriptActionIconButton label="加入笔记草稿" onClick={() => onAddTranscriptToNotes(segment)}>
              <Edit3 className="h-4 w-4" />
            </TranscriptActionIconButton>
          ) : (
            <TranscriptActionIconButton label="设为问答问题" onClick={() => onUseTranscriptAsQuestion(segment)}>
              <MessageSquare className="h-4 w-4" />
            </TranscriptActionIconButton>
          )}
        </div>
      </div>
    </div>
  )
})

function CorrectionSegmentSurface({
  label,
  segment,
  placeholder,
  tone = "neutral",
}: {
  label: string
  segment: TranscriptSegment | null
  placeholder: string
  tone?: "neutral" | "accent"
}) {
  return (
    <div
      className={cn(
        "transcript-correction-surface rounded-xl border px-4 py-3.5",
        tone === "accent" ? "border-primary/20 bg-primary/[0.04]" : "border-border/60 bg-card/45",
      )}
    >
      <div className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground">{label}</div>
      {segment ? (
        <>
          <p className="mt-2.5 whitespace-pre-wrap text-sm leading-6">{segment.text}</p>
        </>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-border/60 px-3 py-3 text-sm text-muted-foreground">
          {placeholder}
        </div>
      )}
    </div>
  )
}

interface TranscriptCorrectionPanelProps {
  mode: CorrectionPreviewMode
  sourceSegments: TranscriptSegment[]
  resultSegments: TranscriptSegment[]
  previewText: string
  fallbackUsed: boolean
  status: string
  isLoading: boolean
}

const TranscriptCorrectionPanel = React.memo(function TranscriptCorrectionPanel({
  mode,
  sourceSegments,
  resultSegments,
  previewText,
  fallbackUsed,
  status,
  isLoading,
}: TranscriptCorrectionPanelProps) {
  const normalizedStatus = asString(status).trim().toLowerCase()
  const comparisonRows = React.useMemo(() => {
    const sourceByKey = new Map<string, TranscriptSegment>()
    const resultByKey = new Map<string, TranscriptSegment>()
    const orderedKeys = new Set<string>()

    for (const segment of sourceSegments) {
      const key = buildTranscriptSegmentKey(segment)
      sourceByKey.set(key, segment)
      orderedKeys.add(key)
    }

    for (const segment of resultSegments) {
      const key = buildTranscriptSegmentKey(segment)
      resultByKey.set(key, segment)
      orderedKeys.add(key)
    }

    return Array.from(orderedKeys)
      .sort((leftKey, rightKey) => {
        const left = sourceByKey.get(leftKey) ?? resultByKey.get(leftKey)
        const right = sourceByKey.get(rightKey) ?? resultByKey.get(rightKey)
        if (!left || !right) {
          return left ? -1 : right ? 1 : 0
        }
        return left.start - right.start || left.end - right.end
      })
      .map((key) => ({
        key,
        source: sourceByKey.get(key) ?? null,
        result: resultByKey.get(key) ?? null,
      }))
  }, [resultSegments, sourceSegments])
  const effectiveMode =
    mode !== "unknown"
      ? mode
      : comparisonRows.length > 0
        ? "strict"
        : previewText.trim()
          ? "rewrite"
          : "unknown"
  const isSkipped = effectiveMode === "off" || normalizedStatus === "skipped"
  const hasPreviewText = previewText.trim().length > 0
  const usesVirtualizedComparisonList = !isSkipped && comparisonRows.length > 0

  const getRowTimestamp = React.useCallback((source: TranscriptSegment | null, result: TranscriptSegment | null) => {
    const reference = source ?? result
    if (!reference) {
      return ""
    }
    return `${formatPreciseSecondsAsClock(reference.start)} - ${formatPreciseSecondsAsClock(reference.end)}`
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="text-sm font-medium">文本纠错</div>
        <div className="flex items-center gap-2">
          {effectiveMode !== "unknown" ? <Badge variant="outline">{effectiveMode}</Badge> : null}
          {fallbackUsed ? <Badge variant="secondary">已回退原文</Badge> : null}
          {normalizedStatus === "running" ? <Badge variant="secondary">流式输出中</Badge> : null}
        </div>
      </div>
      {usesVirtualizedComparisonList ? (
        <div className="min-h-0 flex-1 p-4">
          <VirtualizedList
            items={comparisonRows}
            className="themed-thin-scrollbar h-full min-h-0"
            estimateSize={() => 236}
            overscan={5}
            getItemKey={(row) => row.key}
            renderItem={(row, index) => (
              <div className={cn("pb-3", index === 0 && "pt-0")}>
                <div className="rounded-xl border border-border/60 bg-card/35 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="transcript-segment-timestamp inline-flex items-center rounded-full border border-primary/20 bg-primary/[0.08] px-2.5 py-1 font-mono text-[11px] font-semibold leading-none tracking-[0.06em] text-primary">
                      {getRowTimestamp(row.source, row.result) || "等待时间戳"}
                    </span>
                    {(row.result?.speaker || row.source?.speaker) ? (
                      <Badge variant="secondary" className="text-[11px]">
                        {row.result?.speaker || row.source?.speaker}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    <CorrectionSegmentSurface
                      label="原始转写"
                      segment={row.source}
                      placeholder="当前时间片的原始转写尚未载入。"
                    />
                    <CorrectionSegmentSurface
                      label="纠错后文本"
                      segment={row.result}
                      placeholder={
                        normalizedStatus === "running"
                          ? "这一时间片的纠错结果还在生成中..."
                          : "当前时间片没有可展示的纠错文本。"
                      }
                      tone="accent"
                    />
                  </div>
                </div>
              </div>
            )}
          />
        </div>
      ) : (
        <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
          <div className="space-y-4 p-4">
          {isSkipped ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-5 text-sm text-muted-foreground">
              当前任务跳过了文本纠错阶段，后续笔记整理直接使用原始转写结果。
            </div>
          ) : null}
          {!isSkipped && isLoading && !comparisonRows.length && !hasPreviewText ? (
            <div className="flex items-center rounded-xl border border-border/60 bg-card/45 px-4 py-5 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在读取文本纠错结果...
            </div>
          ) : null}
          {!isSkipped && !comparisonRows.length ? (
            <div className="rounded-xl border border-dashed border-border/60 px-4 py-5 text-sm text-muted-foreground">
              {normalizedStatus === "running"
                ? "文本纠错已经开始，结果会按时间戳逐段出现在这里。"
                : "当前还没有可展示的文本纠错结果。"}
            </div>
          ) : null}
          {!isSkipped && !comparisonRows.length && hasPreviewText ? (
            <div className="transcript-correction-surface rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3.5">
              <div className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground">兼容视图</div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-6">
                当前历史结果缺少按时间戳分段的纠错产物，暂时回退为整段文本展示。
              </div>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-6">{previewText}</div>
            </div>
          ) : null}
          </div>
        </ScrollArea>
      )}
    </div>
  )
})

interface LeftWorkbenchPanelProps {
  workflow: WorkflowType
  taskId: string
  effectiveTitle: string
  videoUrl: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  fallbackDurationSeconds: number
  onSeek: (seconds: number) => void
  leftTab: LeftTab
  onLeftTabChange: (value: LeftTab) => void
  videoErrorMessage: string
  onVideoError: (message: string) => void
  errorMessage: string
  isInitialLoading: boolean
  isRefreshing: boolean
  onCopyTranscript: () => void | Promise<void>
  onDownloadTranscript: () => void
  onAddTranscriptToNotes: (segment: TranscriptSegment) => void
  onUseTranscriptAsQuestion: (segment: TranscriptSegment) => void
  correctionStatus: string
  stageMetrics: Record<string, Record<string, unknown>>
  artifactTotalBytes: number
  artifactCount: number
  taskStatus: string
}

const LeftWorkbenchPanel = React.memo(function LeftWorkbenchPanel({
  workflow,
  taskId,
  effectiveTitle,
  videoUrl,
  videoRef,
  fallbackDurationSeconds,
  onSeek,
  leftTab,
  onLeftTabChange,
  videoErrorMessage,
  onVideoError,
  errorMessage,
  isInitialLoading,
  isRefreshing,
  onCopyTranscript,
  onDownloadTranscript,
  onAddTranscriptToNotes,
  onUseTranscriptAsQuestion,
  correctionStatus,
  stageMetrics,
  artifactTotalBytes,
  artifactCount,
  taskStatus,
}: LeftWorkbenchPanelProps) {
  const {
    taskTranscriptSegments,
    liveTranscript,
    rawTranscriptSegments,
    persistedRawTranscriptSegments,
    correctionPreview,
    persistedCorrectionMode,
    persistedCorrectionText,
    persistedCorrectionFallbackUsed,
    isCorrectionPreviewLoading,
    taskEvents,
    chatHistory,
  } = useTaskProcessingRuntimeStore(
    useShallow((state) => ({
      taskTranscriptSegments: state.task?.transcript_segments ?? EMPTY_TRANSCRIPT_SEGMENTS,
      liveTranscript: state.liveTranscript,
      rawTranscriptSegments: state.rawTranscriptSegments,
      persistedRawTranscriptSegments: state.persistedRawTranscriptSegments,
      correctionPreview: state.correctionPreview,
      persistedCorrectionMode: state.persistedCorrectionMode,
      persistedCorrectionText: state.persistedCorrectionText,
      persistedCorrectionFallbackUsed: state.persistedCorrectionFallbackUsed,
      isCorrectionPreviewLoading: state.isCorrectionPreviewLoading,
      taskEvents: state.taskEvents,
      chatHistory: state.chatHistory,
    })),
  )
  const transcriptSegments = React.useMemo(
    () => mergeTaskAndLiveTranscriptSegments(taskTranscriptSegments, liveTranscript),
    [liveTranscript, taskTranscriptSegments],
  )
  const [activeTranscriptId, setActiveTranscriptId] = React.useState("")
  const [isTranscriptAutoFollow, setIsTranscriptAutoFollow] = React.useState(true)
  const transcriptViewportRef = React.useRef<HTMLDivElement | null>(null)
  const transcriptAutoScrollRafRef = React.useRef<number | null>(null)
  const suppressTranscriptScrollBreakRef = React.useRef(false)
  const deferredTranscriptSegmentsForTimeline = React.useDeferredValue(transcriptSegments)
  const deferredChatHistoryForTimeline = React.useDeferredValue(chatHistory)
  const deferredTaskEvents = React.useDeferredValue(taskEvents)
  const shouldShowCorrectionTab = workflow === "notes" || correctionStatus !== "skipped"
  const lastTranscriptSignature = React.useMemo(() => {
    const lastSegment = transcriptSegments[transcriptSegments.length - 1]
    if (!lastSegment) {
      return "empty"
    }
    return `${transcriptSegments.length}:${lastSegment.start}:${lastSegment.end}:${lastSegment.text}`
  }, [transcriptSegments])

  React.useEffect(() => {
    setActiveTranscriptId("")
    setIsTranscriptAutoFollow(true)
    suppressTranscriptScrollBreakRef.current = false
    if (transcriptAutoScrollRafRef.current !== null) {
      window.cancelAnimationFrame(transcriptAutoScrollRafRef.current)
      transcriptAutoScrollRafRef.current = null
    }
  }, [taskId, videoUrl])

  React.useEffect(() => {
    if (shouldShowCorrectionTab || leftTab !== "correction") {
      return
    }
    onLeftTabChange("transcript")
  }, [leftTab, onLeftTabChange, shouldShowCorrectionTab])

  React.useEffect(() => {
    if (!isTranscriptAutoFollow || transcriptSegments.length === 0) {
      return
    }
    const viewport = transcriptViewportRef.current
    if (!viewport) {
      return
    }
    const scrollToBottom = () => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: "auto",
      })
    }
    suppressTranscriptScrollBreakRef.current = true
    scrollToBottom()
    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom()
      transcriptAutoScrollRafRef.current = window.requestAnimationFrame(() => {
        scrollToBottom()
        suppressTranscriptScrollBreakRef.current = false
        transcriptAutoScrollRafRef.current = null
      })
    })
    transcriptAutoScrollRafRef.current = frameId
    return () => {
      suppressTranscriptScrollBreakRef.current = false
      if (transcriptAutoScrollRafRef.current !== null) {
        window.cancelAnimationFrame(transcriptAutoScrollRafRef.current)
        transcriptAutoScrollRafRef.current = null
      } else {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [isTranscriptAutoFollow, lastTranscriptSignature, transcriptSegments.length])

  const evidenceTimelineItems = React.useMemo(() => {
    if (workflow === "notes") {
      return deferredTranscriptSegmentsForTimeline.map((segment) => ({
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
    return deferredChatHistoryForTimeline
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
  }, [deferredChatHistoryForTimeline, deferredTranscriptSegmentsForTimeline, effectiveTitle, taskId, workflow])

  const correctionMode =
    correctionPreview.mode !== "unknown" ? correctionPreview.mode : persistedCorrectionMode
  const correctionSourceSegments =
    rawTranscriptSegments.length > 0 ? rawTranscriptSegments : persistedRawTranscriptSegments
  const correctionResultSegments = resolveDisplayedCorrectionSegments({
    correctionMode,
    correctionPreviewSegments: correctionPreview.segments,
    correctionStatus,
    transcriptSegments,
  })
  const correctionPreviewText = correctionPreview.text || persistedCorrectionText
  const correctionFallbackUsed = correctionPreview.fallbackUsed || persistedCorrectionFallbackUsed

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

  const handleTranscriptViewportScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (suppressTranscriptScrollBreakRef.current) {
      return
    }
    const target = event.currentTarget
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceToBottom <= TRANSCRIPT_SCROLL_RESTORE_THRESHOLD_PX) {
      setIsTranscriptAutoFollow((current) => (current ? current : true))
      return
    }
    if (distanceToBottom >= TRANSCRIPT_SCROLL_BREAK_THRESHOLD_PX) {
      setIsTranscriptAutoFollow((current) => (current ? false : current))
    }
  }, [])

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
        <TabsList className="workbench-tab-list w-full justify-start rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="transcript" className="workbench-tab-trigger workbench-left-tab-trigger">转写片段</TabsTrigger>
          {shouldShowCorrectionTab ? (
            <TabsTrigger value="correction" className="workbench-tab-trigger workbench-left-tab-trigger">文本纠错</TabsTrigger>
          ) : null}
          <TabsTrigger value="evidence" className="workbench-tab-trigger workbench-left-tab-trigger">证据时间轴</TabsTrigger>
          <TabsTrigger value="stage" className="workbench-tab-trigger workbench-left-tab-trigger">阶段输出</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <div className="text-sm font-medium">转写文本</div>
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
            <div className="flex min-h-0 flex-1 flex-col">
              {errorMessage ? <div className="mx-4 mt-4 rounded-xl border border-destructive/30 bg-destructive/6 p-3 text-sm text-destructive">{errorMessage}</div> : null}
              {isInitialLoading && transcriptSegments.length === 0 ? <div className="mx-4 mt-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">正在加载任务详情...</div> : null}
              {!isInitialLoading && transcriptSegments.length === 0 ? (
                <div className="mx-4 mt-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  {taskStatus === "running" || taskStatus === "queued"
                    ? "正在转写和整理内容，识别片段会按时间戳实时出现在这里。"
                    : "当前还没有可展示的转写结果。"}
                </div>
              ) : null}
              {transcriptSegments.length > 0 ? (
                <VirtualizedList
                  items={transcriptSegments}
                  className="themed-thin-scrollbar h-full min-h-0 flex-1"
                  estimateSize={() => 148}
                  overscan={10}
                  viewportRef={transcriptViewportRef}
                  onViewportScroll={handleTranscriptViewportScroll}
                  getItemKey={(segment) => `${segment.start}-${segment.end}`}
                  renderItem={(segment, index) => {
                    const segmentId = `${segment.start}-${segment.end}`
                    return (
                      <div className={cn("px-4 pb-3", index === 0 && "pt-4")}>
                        <TranscriptSegmentCard
                          workflow={workflow}
                          segment={segment}
                          isActive={activeTranscriptId === segmentId}
                          onSeek={handleSeekWithTranscriptSync}
                          onAddTranscriptToNotes={onAddTranscriptToNotes}
                          onUseTranscriptAsQuestion={onUseTranscriptAsQuestion}
                        />
                      </div>
                    )
                  }}
                />
              ) : null}
            </div>
          </div>
        </TabsContent>

        {shouldShowCorrectionTab ? (
          <TabsContent value="correction" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <TranscriptCorrectionPanel
              mode={correctionMode}
              sourceSegments={correctionSourceSegments}
              resultSegments={correctionResultSegments}
              previewText={correctionPreviewText}
              fallbackUsed={correctionFallbackUsed}
              status={correctionStatus}
              isLoading={isCorrectionPreviewLoading}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="evidence" className="mt-0 min-h-0 flex-1 overflow-hidden">
          {evidenceTimelineItems.length === 0 ? <div className="m-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{workflow === "notes" ? "当前还没有时间轴内容。" : "先发起一次视频问答，这里会自动汇总命中证据。"}</div> : null}
          {evidenceTimelineItems.length > 0 ? (
            <VirtualizedList
              items={evidenceTimelineItems}
              className="themed-thin-scrollbar h-full min-h-0 flex-1"
              estimateSize={() => 156}
              overscan={8}
              getItemKey={(item) => item.id}
              renderItem={(item, index) => (
                <div className={cn("px-4 pb-3", index === 0 && "pt-4")}>
                  <div className="workbench-collection-item rounded-2xl border border-border/70 bg-card/65 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{item.title}</span>
                          <Badge variant="outline">{item.source || "timeline"}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.taskTitle}</p>
                      </div>
                      <Button variant="outline" size="sm" className="evidence-timeline-seek-button" onClick={() => onSeek(item.start)}>
                        <MapPin className="mr-1.5 h-3.5 w-3.5" />
                        {formatSecondsAsClock(item.start)}
                      </Button>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                  </div>
                </div>
              )}
            />
          ) : null}
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
                <div className="mt-3 min-h-[16rem]">
                  {deferredTaskEvents.length > 0 ? (
                    <VirtualizedList
                      items={deferredTaskEvents}
                      className="themed-thin-scrollbar h-64 min-h-0"
                      estimateSize={() => 88}
                      overscan={6}
                      getItemKey={(event, index) => `${event.timestamp}-${index}`}
                      renderItem={(event, index) => (
                        <div className={cn("pb-2", index === 0 && "pt-0")}>
                          <div className="workbench-collection-item rounded-xl border border-border/60 bg-background/55 px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <Badge variant="outline">{formatTaskEventBadge(event)}</Badge>
                              {formatTaskEventTimestamp(event.timestamp) ? <span className="text-muted-foreground">{formatTaskEventTimestamp(event.timestamp)}</span> : null}
                            </div>
                            <p className="mt-2 text-sm leading-6">{formatTaskEventMessage(event)}</p>
                          </div>
                        </div>
                      )}
                    />
                  ) : <p className="text-sm text-muted-foreground">当前还没有可展示的阶段动态。</p>}
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
}

function TaskWorkbenchDetailLoading({ workflow }: { workflow: WorkflowType }) {
  return (
    <div className="workbench-detail-loading-shell flex h-full min-h-0 flex-col p-4">
      <div className="workbench-detail-loading-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-[calc(var(--radius)+0.45rem)] border border-border/70 bg-card/65">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div className="space-y-2">
            <div className="workbench-loading-pill h-3.5 w-24 rounded-full" />
            <div className="workbench-loading-line h-4 w-40 rounded-full" />
          </div>
          <div className="workbench-loading-pill h-9 w-28 rounded-xl" />
        </div>
        <div className="grid min-h-0 flex-1 gap-4 p-5">
          <div className="workbench-loading-block h-28 rounded-2xl" />
          <div className="grid gap-3 md:grid-cols-2">
            <div className="workbench-loading-block h-36 rounded-2xl" />
            <div className="workbench-loading-block h-36 rounded-2xl" />
          </div>
          <div className="space-y-3">
            <div className="workbench-loading-line h-4 w-44 rounded-full" />
            <div className="workbench-loading-block h-24 rounded-2xl" />
            <div className="workbench-loading-block h-24 rounded-2xl" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>{workflow === "notes" ? "正在载入笔记整理详情..." : "正在载入视频问答详情..."}</span>
      </div>
    </div>
  )
}

function TaskWorkbenchDetailState({ message }: { message: string }) {
  return (
    <div className="workbench-detail-loading-shell flex h-full min-h-0 flex-col p-4">
      <div className="workbench-pane-state flex min-h-0 flex-1 items-center justify-center rounded-[calc(var(--radius)+0.45rem)] border border-dashed p-8 text-center text-sm text-muted-foreground">
        {message}
      </div>
    </div>
  )
}

const NotesWorkbench = React.memo(function NotesWorkbench({
  taskId,
  effectiveTitle,
  notesTab,
  onNotesTabChange,
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
}: NotesWorkbenchProps) {
  const markdownColorMode =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"

  return (
    <Tabs value={notesTab} onValueChange={(value) => onNotesTabChange(value as NotesTab)} className="workbench-detail-pane notes-workbench-pane flex h-full min-h-0 flex-col">
      <TabsList className="workbench-detail-tabs workbench-tab-list w-full justify-start rounded-none border-b bg-transparent p-0">
        <TabsTrigger value="notes" className="workbench-tab-trigger workbench-right-tab-trigger">Markdown 工作区</TabsTrigger>
        <TabsTrigger value="mindmap" className="workbench-tab-trigger workbench-right-tab-trigger">思维导图</TabsTrigger>
      </TabsList>

      <TabsContent value="notes" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
          <div className="p-4">
            <div className="notes-workbench-reading-panel flex min-h-full flex-col overflow-hidden">
              <div className="notes-workbench-reading-header border-b">
                <div className="notes-workbench-actions flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="notes-workbench-primary-action"
                    disabled={!canEditArtifacts}
                    onClick={() => setIsEditingNotes(true)}
                  >
                    <Edit3 className="mr-1.5 h-4 w-4" />
                    编辑笔记
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="notes-workbench-primary-action"
                    disabled={!isTaskCompleted}
                    onClick={onDownloadNotes}
                  >
                    <Download className="mr-1.5 h-4 w-4" />
                    导出 Markdown
                  </Button>
                </div>
              </div>
              <div className="notes-workbench-reading-body min-h-0 flex-1">
                <MarkdownArtifactViewer
                  taskId={taskId}
                  markdown={notesMarkdown}
                  emptyMessage="当前还没有生成笔记内容"
                  className="artifact-markdown-viewer-shell notes-markdown-viewer-shell notes-workbench-viewer"
                  onSeek={onSeek}
                />
              </div>
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="mindmap" className="workbench-pane-padded mt-0 min-h-0 flex-1 p-4">
        {isMindmapLoading ? <div className="workbench-pane-state flex h-full items-center justify-center rounded-2xl border border-border/70 bg-card/65 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在载入思维导图...</div> : null}
        {!isMindmapLoading && mindmapHtml ? <iframe title={`${effectiveTitle}-mindmap`} srcDoc={mindmapHtml} className="workbench-pane-frame h-full w-full rounded-2xl border border-border/70 bg-background" /> : null}
        {!isMindmapLoading && !mindmapHtml ? <div className="workbench-pane-state flex h-full items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">{isTaskCompleted ? "当前没有可展示的思维导图结果。" : "请等待任务完成后再预览思维导图。"}</div> : null}
      </TabsContent>
      <Dialog open={isEditingNotes} onOpenChange={(open) => {
        if (!open) {
          setIsEditingNotes(false)
          setNotesDraft(notesMarkdown || "")
          return
        }
        setIsEditingNotes(true)
      }}>
        <DialogContent className="prompt-config-dialog notes-editor-dialog flex w-[min(96vw,88rem)] max-h-[min(90vh,60rem)] max-w-[88rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-[88rem]">
          <DialogHeader className="prompt-config-dialog-header shrink-0 border-b px-6 py-2.5 pr-10">
            <DialogTitle className="text-base font-semibold leading-tight">编辑 Markdown 笔记</DialogTitle>
          </DialogHeader>
          <div className="prompt-config-dialog-scroll themed-thin-scrollbar dialog-ultra-thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <PromptMarkdownEditor
              value={notesDraft}
              colorMode={markdownColorMode}
              taskId={taskId}
              height={520}
              placeholder="在这里编辑任务笔记..."
              onChange={setNotesDraft}
            />
          </div>
          <div className="prompt-config-dialog-footer shrink-0 flex items-center justify-end gap-2 border-t px-6 py-3">
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

function VqaMessageAvatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        role === "assistant" ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
      )}
    >
      {role === "assistant" ? <Search className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
    </div>
  )
}

const VqaWorkbench = React.memo(function VqaWorkbench({
  taskId,
  effectiveTitle,
  vqaTab,
  onVqaTabChange,
  question,
  onQuestionChange,
  onAskQuestion,
  onStopAnswer,
  onSeek,
  onOpenTrace,
}: VqaWorkbenchProps) {
  const {
    chatHistory,
    isSearching,
    selectedTraceId,
    traceCache,
    traceLoadingId,
    traceError,
  } = useTaskProcessingRuntimeStore(
    useShallow((state) => ({
      chatHistory: state.chatHistory,
      isSearching: state.isChatStreaming,
      selectedTraceId: state.selectedTraceId,
      traceCache: state.traceCache,
      traceLoadingId: state.traceLoadingId,
      traceError: state.traceError,
    })),
  )
  const selectedTrace = selectedTraceId ? traceCache[selectedTraceId] ?? null : null
  const showStopAnswer = React.useMemo(
    () => isSearching || hasActiveAssistantStream(chatHistory),
    [chatHistory, isSearching],
  )
  const traceStartedPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "trace_started"), [selectedTrace])
  const traceRetrievalPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "retrieval"), [selectedTrace])
  const traceLlmPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "llm_stream"), [selectedTrace])
  const traceFinishedPayload = React.useMemo(() => getTraceStagePayload(selectedTrace, "trace_finished"), [selectedTrace])

  return (
    <Tabs value={vqaTab} onValueChange={(value) => onVqaTabChange(value as VqaTab)} className="workbench-detail-pane vqa-workbench-pane flex h-full min-h-0 flex-col">
      <TabsList className="workbench-detail-tabs workbench-tab-list w-full justify-start rounded-none border-b bg-transparent p-0">
        <TabsTrigger value="chat" className="workbench-tab-trigger workbench-right-tab-trigger">流式问答</TabsTrigger>
        <TabsTrigger value="trace" className="workbench-tab-trigger workbench-right-tab-trigger">Trace Theater</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          {chatHistory.length === 0 ? <div className="workbench-pane-state m-4 rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">开始提问，系统会以流式方式输出回答和证据。</div> : null}
          {chatHistory.length > 0 ? (
            <VirtualizedList
              items={chatHistory}
              className="themed-thin-scrollbar h-full min-h-0 flex-1"
              estimateSize={() => 180}
              overscan={6}
              getItemKey={(message) => message.id}
              renderItem={(message, index) => (
                <div className={cn("px-4 pb-4", index === 0 && "pt-4")}>
                  <div
                    key={message.id}
                    data-role={message.role}
                    className={cn("vqa-chat-message workbench-collection-item flex items-start gap-3", message.role === "user" && "justify-end")}
                  >
                    {message.role === "assistant" ? <VqaMessageAvatar role="assistant" /> : null}
                    <div className={cn("vqa-chat-bubble max-w-[88%] space-y-3 rounded-2xl p-4", message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border/70 bg-card/70")}>
                      {message.role === "assistant" ? (
                        message.status === "streaming" && !message.content.trim() ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Search className="h-4 w-4 text-primary" />
                              <span>{message.statusMessage || "正在检索相关片段..."}</span>
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
                        ) : message.status === "streaming" ? (
                          <p className="whitespace-pre-wrap text-sm leading-6">{message.content || message.statusMessage || "正在生成回答..."}</p>
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
                            {message.traceId ? <Badge variant="outline">链路 {message.traceId}</Badge> : null}
                            {message.contextTokensApprox ? <Badge variant="secondary">上下文约 {message.contextTokensApprox} tokens</Badge> : null}
                            {message.statusMessage && !(message.status === "streaming" && !message.content.trim()) ? (
                              <Badge variant="secondary">{message.statusMessage}</Badge>
                            ) : null}
                            {message.errorMessage ? <Badge variant="destructive">{message.errorMessage}</Badge> : null}
                            {message.traceId ? (
                              <TranscriptActionIconButton
                                label="查看检索链路"
                                variant="outline"
                                className="h-7 w-7"
                                onClick={() => void onOpenTrace(message.traceId || "")}
                              >
                                <Search className="h-3.5 w-3.5" />
                              </TranscriptActionIconButton>
                            ) : null}
                          </div>
                          {message.citations.length > 0 ? (
                            <div className="vqa-citation-list space-y-3">
                              {message.citations.map((citation, citationIndex) => (
                                <div key={`${message.id}-${citation.doc_id}-${citationIndex}`} className="workbench-collection-item rounded-xl border border-border/60 bg-background/55 p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-sm font-medium">{citation.task_title || effectiveTitle}</span>
                                      <Badge variant="outline">{getCitationPrimaryLabel(citation)}</Badge>
                                      <Badge variant="secondary">{citation.source}</Badge>
                                      <Badge variant="secondary">{formatSecondsAsClock(citation.start)} - {formatSecondsAsClock(citation.end)}</Badge>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <TranscriptActionIconButton label="跳转到证据时间点" variant="outline" className="h-8 w-8" onClick={() => onSeek(citation.start)}>
                                        <MapPin className="h-4 w-4" />
                                      </TranscriptActionIconButton>
                                    </div>
                                  </div>
                                  <div className="vqa-citation-layout mt-3 grid gap-3">
                                    <p className="whitespace-pre-wrap text-sm leading-6">{citation.text}</p>
                                    {getCitationSupportingText(citation) ? (
                                      <p className="whitespace-pre-wrap text-xs leading-6 text-muted-foreground">
                                        视觉线索：{getCitationSupportingText(citation)}
                                      </p>
                                    ) : null}
                                    {getCitationFrameReference(citation) ? (
                                      <p className="break-all text-xs text-muted-foreground">
                                        关键帧：{getCitationFrameReference(citation)}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                    {message.role === "user" ? <VqaMessageAvatar role="user" /> : null}
                  </div>
                </div>
              )}
            />
          ) : null}
          <div className="border-t px-4 py-4">
            <div className="vqa-chat-composer-row flex items-center gap-2">
              <VqaMessageAvatar role="user" />
              <Input value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder="输入你的问题，系统会实时输出回答..." onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void onAskQuestion() } }} />
              {showStopAnswer ? <Button variant="outline" onClick={onStopAnswer}><Square className="h-4 w-4" /></Button> : <Button onClick={() => void onAskQuestion()} disabled={!question.trim()}><Send className="h-4 w-4" /></Button>}
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="trace" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {!selectedTraceId ? <div className="workbench-pane-state rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">先在问答卡片里打开一条检索链路，这里会展示完整的检索和回答过程。</div> : null}
            {traceError ? <div className="workbench-pane-state rounded-2xl border border-destructive/30 bg-destructive/6 p-4 text-sm text-destructive">{traceError}</div> : null}
            {selectedTraceId && traceLoadingId === selectedTraceId ? <div className="workbench-pane-state flex items-center justify-center rounded-2xl border border-border/70 bg-card/65 p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载 Trace 明细...</div> : null}
            {selectedTrace ? (
              <>
                <div className="workbench-pane-section rounded-2xl border border-border/70 bg-card/65 p-4">
                  <h3 className="text-sm font-medium">Trace 摘要</h3>
                  <p className="mt-2 text-xs text-muted-foreground">链路 ID: {selectedTrace.trace_id}</p>
                  <div className="vqa-trace-summary-grid mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">问题</p><p className="mt-1 text-sm">{asString(asObject(traceStartedPayload.metadata).query_text) || "未记录问题文本"}</p></div>
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">检索策略</p><p className="mt-1 text-sm">原问题直搜，不做查询扩展；统一向量索引链路</p></div>
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">候选处理</p><p className="mt-1 text-sm">阶段内按片段去重；可同时包含文本与视觉证据</p></div>
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
                                <div className="mt-2 grid gap-3">
                                  <p className="whitespace-pre-wrap text-sm leading-6">{asString(hit.text)}</p>
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
    </Tabs>
  )
})

interface VqaWorkbenchProps {
  taskId: string
  effectiveTitle: string
  vqaTab: VqaTab
  onVqaTabChange: (value: VqaTab) => void
  question: string
  onQuestionChange: (value: string) => void
  onAskQuestion: () => void | Promise<void>
  onStopAnswer: () => void
  onSeek: (seconds: number) => void
  onOpenTrace: (traceId: string) => void | Promise<void>
}
