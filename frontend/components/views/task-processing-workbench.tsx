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
  RefreshCw,
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
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownArtifactViewer } from "@/components/ui/markdown-artifact-viewer"
import { ResearchBoardPanel } from "@/components/views/research-board-panel"
import {
  buildTaskArtifactFileUrl,
  cancelTask,
  downloadTaskArtifact,
  getApiErrorMessage,
  getChatTrace,
  getTaskArtifactText,
  getTaskDetail,
  rerunTaskStageD,
  streamChatWithTask,
  streamTaskEvents,
  updateTaskArtifacts,
} from "@/lib/api"
import { formatBytes, formatDateTime, formatSecondsAsClock, toFileUrl } from "@/lib/format"
import { logPerfSample, markPerfStart } from "@/lib/perf"
import { addResearchBoardItem } from "@/lib/research-board"
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
  { key: "dense_hits", label: "Dense 检索", scoreKey: "dense_score" },
  { key: "sparse_hits", label: "Sparse 检索", scoreKey: "sparse_score" },
  { key: "rrf_hits", label: "RRF 合并", scoreKey: "rrf_score" },
  { key: "rerank_hits", label: "Rerank 结果", scoreKey: "final_score" },
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

function findActiveTranscriptId(task: TaskDetailResponse | null, currentTime: number): string {
  if (!task) {
    return ""
  }
  const active = task.transcript_segments.find(
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

function getTraceStagePayload(trace: VqaTraceResponse | null, stage: string): Record<string, unknown> {
  if (!trace) {
    return {}
  }
  const record = trace.records.find((item) => item.stage === stage)
  return asObject(record?.payload)
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
  const [currentTime, setCurrentTime] = React.useState(0)
  const [totalDuration, setTotalDuration] = React.useState(0)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const [activeTranscriptId, setActiveTranscriptId] = React.useState("")
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
  const [isCancelling, setIsCancelling] = React.useState(false)
  const [isRerunning, setIsRerunning] = React.useState(false)
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
    setActiveTranscriptId(findActiveTranscriptId(task, currentTime))
  }, [currentTime, task])

  React.useEffect(() => {
    if (!task) {
      return
    }
    void onTaskChanged()
  }, [onTaskChanged, task?.status, task?.updated_at])

  React.useEffect(() => {
    if (!task || !isRunningTask(task.status)) {
      return
    }
    const source = streamTaskEvents(task.id, (event) => {
      const rawType = getRawTaskEventType(event)
      const streamedSegment = extractTranscriptSegmentFromEvent(event)
      if (streamedSegment) {
        setLiveTranscriptSegments((current) => mergeTranscriptSegments(current, [streamedSegment]))
      }
      if (rawType === "progress") {
        const overallProgress = asNumber(event["overall_progress"])
        if (overallProgress !== null) {
          setTask((current) =>
            current
              ? {
                  ...current,
                  progress: Math.round(overallProgress),
                  overall_progress: Math.round(overallProgress),
                }
              : current,
          )
        }
      } else if (rawType === "task_complete") {
        setTask((current) =>
          current
            ? {
                ...current,
                status: "completed",
                progress: 100,
                overall_progress: 100,
              }
            : current,
        )
      } else if (rawType === "task_cancelled") {
        setTask((current) =>
          current
            ? {
                ...current,
                status: "cancelled",
              }
            : current,
        )
      } else if (rawType === "task_failed") {
        setTask((current) =>
          current
            ? {
                ...current,
                status: "failed",
                error_message: asString(event.error || event.message),
              }
            : current,
        )
      }
      if (shouldRecordTaskEvent(event)) {
        setTaskEvents((current) => [event, ...current].slice(0, 80))
      }
      if (!shouldTriggerTaskRefresh(event) || refreshTimerRef.current !== null) {
        return
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        void loadTask({ showToastOnError: false, background: true })
      }, 900)
    })
    source.onerror = () => source.close()
    return () => {
      source.close()
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [loadTask, task])

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
  const videoUrl = toFileUrl(effectiveTask?.source_local_path)
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
      setCurrentTime(nextTime)
      if (videoRef.current) {
        videoRef.current.currentTime = nextTime
      }
      setActiveTranscriptId(findActiveTranscriptId(effectiveTask, nextTime))
    },
    [effectiveTask],
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
      toast.success("已加入研究板")
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
      { id: assistantId, role: "assistant", content: "", status: "streaming", citations: [] },
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
              if (event.type === "chunk" && event.delta) next.content += event.delta
              if (event.type === "status") next.statusMessage = event.message || event.status || ""
              if (event.type === "error") {
                next.status = "error"
                next.errorMessage = event.error?.message || event.message || "流式回答失败"
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
        const message = getApiErrorMessage(error, "执行视频问答失败")
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

  const handleTogglePlay = React.useCallback(async () => {
    if (!videoRef.current) {
      setIsPlaying((value) => !value)
      return
    }
    if (videoRef.current.paused) {
      await videoRef.current.play()
      setIsPlaying(true)
      return
    }
    videoRef.current.pause()
    setIsPlaying(false)
  }, [])

  const handleSeek = React.useCallback(
    (deltaSeconds: number) => {
      jumpToTime(currentTime + deltaSeconds)
    },
    [currentTime, jumpToTime],
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
      toast.error(getApiErrorMessage(error, "取消任务失败"))
    } finally {
      setIsCancelling(false)
    }
  }, [effectiveTask, loadTask, taskId])

  const handleRerunStageD = React.useCallback(async () => {
    if (!effectiveTask || !isTerminalTask(effectiveTask.status)) {
      return
    }
    setIsRerunning(true)
    try {
      await rerunTaskStageD(taskId)
      toast.success("已触发重跑 D 阶段")
      await loadTask({ showToastOnError: false })
    } catch (error) {
      toast.error(getApiErrorMessage(error, "重跑 D 阶段失败"))
    } finally {
      setIsRerunning(false)
    }
  }, [effectiveTask, loadTask, taskId])

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
        canCancel={isRunningTask(effectiveTask?.status)}
        onCancel={handleCancelTask}
        isRerunning={isRerunning}
        canRerun={isTerminalTask(effectiveTask?.status)}
        onRerun={handleRerunStageD}
        canExportBundle={effectiveTask?.status === "completed"}
        onExportBundle={() => void handleDownloadArtifact("bundle")}
      />

      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={50} minSize={36}>
          <LeftWorkbenchPanel
            workflow={workflow}
            videoUrl={videoUrl}
            videoRef={videoRef}
            isPlaying={isPlaying}
            isMuted={isMuted}
            currentTime={currentTime}
            totalDuration={totalDuration || effectiveTask?.duration_seconds || 0}
            onTogglePlay={handleTogglePlay}
            onSeekDelta={handleSeek}
            onSeek={jumpToTime}
            onToggleMute={() => {
              if (!videoRef.current) return
              videoRef.current.muted = !videoRef.current.muted
              setIsMuted(videoRef.current.muted)
            }}
            onFullscreen={() => {
              if (videoRef.current?.requestFullscreen) {
                void videoRef.current.requestFullscreen()
              } else if (!document.fullscreenElement) {
                void document.documentElement.requestFullscreen()
              } else {
                void document.exitFullscreen()
              }
            }}
            onTimeUpdate={setCurrentTime}
            onLoadedMetadata={setTotalDuration}
            leftTab={leftTab}
            onLeftTabChange={setLeftTab}
            transcriptSegments={transcriptSegments}
            activeTranscriptId={activeTranscriptId}
            errorMessage={errorMessage}
            isInitialLoading={isInitialLoading}
            isRefreshing={isRefreshing}
            onCopyTranscript={handleCopyTranscript}
            onDownloadTranscript={() => void handleDownloadArtifact("transcript")}
            onAddTranscriptToNotes={handleAddTranscriptToNotes}
            onUseTranscriptAsQuestion={handleUseTranscriptAsQuestion}
            onAddTranscriptToResearch={(segment) =>
              addItemToResearchBoard({
                type: "transcript",
                title: `转写片段 · ${formatSecondsAsClock(segment.start)}`,
                content: segment.text,
                start: segment.start,
                end: segment.end,
                source: segment.speaker || "transcript",
              })
            }
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
              onDownloadNotes={() => void handleDownloadArtifact("notes")}
              onSeek={jumpToTime}
              mindmapHtml={mindmapHtml}
              isMindmapLoading={isMindmapLoading}
              isTaskCompleted={effectiveTask?.status === "completed"}
            />
          ) : (
            <VqaWorkbench
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
  canCancel: boolean
  onCancel: () => void
  isRerunning: boolean
  canRerun: boolean
  onRerun: () => void
  canExportBundle: boolean
  onExportBundle: () => void
}

function TaskWorkspaceHeader({
  effectiveTitle,
  workflow,
  updatedAt,
  totalProgress,
  errorMessage,
  status,
  steps,
  onBack,
  isCancelling,
  canCancel,
  onCancel,
  isRerunning,
  canRerun,
  onRerun,
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
          {canCancel ? (
            <Button variant="outline" size="sm" disabled={isCancelling} onClick={onCancel}>
              {isCancelling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
              取消任务
            </Button>
          ) : null}
          {canRerun ? (
            <Button variant="outline" size="sm" disabled={isRerunning} onClick={onRerun}>
              {isRerunning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              重跑 D 阶段
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
}

interface LeftWorkbenchPanelProps {
  workflow: WorkflowType
  videoUrl: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  isPlaying: boolean
  isMuted: boolean
  currentTime: number
  totalDuration: number
  onTogglePlay: () => void | Promise<void>
  onSeekDelta: (deltaSeconds: number) => void
  onSeek: (seconds: number) => void
  onToggleMute: () => void
  onFullscreen: () => void
  onTimeUpdate: (seconds: number) => void
  onLoadedMetadata: (seconds: number) => void
  leftTab: LeftTab
  onLeftTabChange: (value: LeftTab) => void
  transcriptSegments: TranscriptSegment[]
  activeTranscriptId: string
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

function LeftWorkbenchPanel({
  workflow,
  videoUrl,
  videoRef,
  isPlaying,
  isMuted,
  currentTime,
  totalDuration,
  onTogglePlay,
  onSeekDelta,
  onSeek,
  onToggleMute,
  onFullscreen,
  onTimeUpdate,
  onLoadedMetadata,
  leftTab,
  onLeftTabChange,
  transcriptSegments,
  activeTranscriptId,
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
  return (
    <div className="flex h-full min-h-0 flex-col border-r">
      <div className="relative aspect-video shrink-0 bg-black">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="absolute inset-0 h-full w-full object-contain"
            onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
            onLoadedMetadata={(event) => onLoadedMetadata(event.currentTarget.duration || 0)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/55">
            当前任务没有可预览的本地视频文件
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 to-transparent px-4 py-3">
          <input
            type="range"
            min={0}
            max={totalDuration || 0}
            step={0.1}
            value={Math.min(currentTime, totalDuration || currentTime)}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="mb-3 h-1.5 w-full cursor-pointer accent-primary"
          />
          <div className="flex items-center gap-2 text-white">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => void onTogglePlay()}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onSeekDelta(-10)}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={() => onSeekDelta(10)}>
              <SkipForward className="h-4 w-4" />
            </Button>
            <span className="text-xs tabular-nums">{formatSecondsAsClock(currentTime)} / {formatSecondsAsClock(totalDuration)}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={onToggleMute}>
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20" onClick={onFullscreen}>
                <Maximize className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

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
                <p className="text-xs text-muted-foreground">支持定位视频、加入笔记与研究板。</p>
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
                    <div key={segmentId} className={cn("rounded-2xl border p-4", activeTranscriptId === segmentId ? "border-primary/30 bg-primary/8" : "border-border/70 bg-card/60")}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="font-mono">{formatSecondsAsClock(segment.start)}</Badge>
                          <span className="text-xs text-muted-foreground">{formatSecondsAsClock(segment.end)}</span>
                          {segment.speaker ? <Badge variant="secondary">{segment.speaker}</Badge> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => onSeek(segment.start)}>
                            <MapPin className="mr-1.5 h-3.5 w-3.5" />
                            定位
                          </Button>
                          {workflow === "notes" ? (
                            <Button variant="ghost" size="sm" onClick={() => onAddTranscriptToNotes(segment)}>
                              <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                              加入笔记
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => onUseTranscriptAsQuestion(segment)}>
                              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                              设为问题
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => onAddTranscriptToResearch(segment)}>
                            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                            加入研究板
                          </Button>
                        </div>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{segment.text}</p>
                    </div>
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
                <div key={item.id} className="rounded-2xl border border-border/70 bg-card/65 p-4">
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
                <div className="rounded-2xl border border-border/70 bg-card/65 p-4"><p className="text-xs text-muted-foreground">任务状态</p><p className="mt-2 text-sm font-semibold">{taskStatus}</p></div>
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
                    <div key={`${event.timestamp}-${index}`} className="rounded-xl border border-border/60 bg-background/55 px-3 py-2.5">
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
}

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
}

function NotesWorkbench({
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
}: NotesWorkbenchProps) {
  return (
    <Tabs value={notesTab} onValueChange={(value) => onNotesTabChange(value as NotesTab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
        <TabsTrigger value="notes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">Markdown 工作区</TabsTrigger>
        <TabsTrigger value="mindmap" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">思维导图</TabsTrigger>
        <TabsTrigger value="research" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">研究板</TabsTrigger>
      </TabsList>

      <TabsContent value="notes" className="mt-0 min-h-0 flex-1">
        <ScrollArea className="themed-thin-scrollbar flex-1">
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-end gap-2">
              {isEditingNotes ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => { setIsEditingNotes(false); setNotesDraft(notesMarkdown || "") }}>取消</Button>
                  <Button size="sm" disabled={isSavingNotes} onClick={() => void onSaveNotes()}>
                    {isSavingNotes ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
                    保存
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" disabled={!canEditArtifacts} onClick={() => setIsEditingNotes(true)}>
                  <Edit3 className="mr-1.5 h-4 w-4" />
                  编辑笔记
                </Button>
              )}
              <Button variant="outline" size="sm" disabled={!isTaskCompleted} onClick={onDownloadNotes}>
                <Download className="mr-1.5 h-4 w-4" />
                导出 Markdown
              </Button>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/65 p-4">
              <h3 className="mb-3 text-sm font-medium">结构化摘要</h3>
              <MarkdownArtifactViewer taskId={taskId} markdown={summaryMarkdown} emptyMessage="当前还没有生成摘要内容" className="artifact-markdown-viewer-shell" onSeek={onSeek} />
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/65 p-4">
              <h3 className="mb-3 text-sm font-medium">笔记 Markdown</h3>
              {isEditingNotes ? (
                <Textarea className="min-h-[28rem] font-mono text-sm leading-6" value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} />
              ) : (
                <MarkdownArtifactViewer taskId={taskId} markdown={notesMarkdown} emptyMessage="当前还没有生成笔记内容" className="artifact-markdown-viewer-shell" onSeek={onSeek} />
              )}
            </div>
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="mindmap" className="mt-0 min-h-0 flex-1 p-4">
        {isMindmapLoading ? <div className="flex h-full items-center justify-center rounded-2xl border border-border/70 bg-card/65 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在载入思维导图...</div> : null}
        {!isMindmapLoading && mindmapHtml ? <iframe title={`${effectiveTitle}-mindmap`} srcDoc={mindmapHtml} className="h-full w-full rounded-2xl border border-border/70 bg-background" /> : null}
        {!isMindmapLoading && !mindmapHtml ? <div className="flex h-full items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">{isTaskCompleted ? "当前没有可展示的思维导图结果。" : "请等待任务完成后再预览思维导图。"}</div> : null}
      </TabsContent>

      <TabsContent value="research" className="mt-0 min-h-0 flex-1">
        <ResearchBoardPanel onSeek={onSeek} />
      </TabsContent>
    </Tabs>
  )
}

function VqaWorkbench({
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
}: VqaWorkbenchProps) {
  return (
    <Tabs value={vqaTab} onValueChange={(value) => onVqaTabChange(value as VqaTab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
        <TabsTrigger value="chat" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">流式问答</TabsTrigger>
        <TabsTrigger value="trace" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">Trace Theater</TabsTrigger>
        <TabsTrigger value="research" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">研究板</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="mt-0 min-h-0 flex-1">
        <div className="flex h-full min-h-0 flex-col">
          <ScrollArea className="themed-thin-scrollbar flex-1">
            <div className="space-y-4 p-4">
              {chatHistory.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">开始提问，系统会以流式方式输出回答和证据。</div> : null}
              {chatHistory.map((message) => (
                <div key={message.id} className={cn("flex gap-3", message.role === "user" && "justify-end")}>
                  {message.role === "assistant" ? <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">{message.status === "streaming" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}</div> : null}
                  <div className={cn("max-w-[88%] space-y-3 rounded-2xl p-4", message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border/70 bg-card/70")}>
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                    {message.role === "assistant" ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {message.traceId ? <Badge variant="outline">trace_id: {message.traceId}</Badge> : null}
                          {message.contextTokensApprox ? <Badge variant="secondary">上下文约 {message.contextTokensApprox} tokens</Badge> : null}
                          {message.statusMessage ? <Badge variant="secondary">{message.statusMessage}</Badge> : null}
                          {message.errorMessage ? <Badge variant="destructive">{message.errorMessage}</Badge> : null}
                        </div>
                        {message.traceId ? <Button variant="outline" size="sm" onClick={() => void onOpenTrace(message.traceId || "")}><Search className="mr-1.5 h-3.5 w-3.5" />打开 Trace Theater</Button> : null}
                        {message.citations.length > 0 ? (
                          <div className="space-y-3">
                            {message.citations.map((citation, index) => (
                              <div key={`${message.id}-${citation.doc_id}-${index}`} className="rounded-xl border border-border/60 bg-background/55 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium">{citation.task_title || effectiveTitle}</span>
                                    <Badge variant="outline">{citation.source}</Badge>
                                    <Badge variant="secondary">{formatSecondsAsClock(citation.start)} - {formatSecondsAsClock(citation.end)}</Badge>
                                  </div>
                                  <Button variant="outline" size="sm" onClick={() => onSeek(citation.start)}><MapPin className="mr-1.5 h-3.5 w-3.5" />跳转</Button>
                                </div>
                                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_8rem]">
                                  <p className="whitespace-pre-wrap text-sm leading-6">{citation.text}</p>
                                  {citation.image_path ? <img src={buildTaskArtifactFileUrl(citation.task_id, citation.image_path)} alt={citation.task_title || effectiveTitle} className="h-24 w-full rounded-xl border border-border/70 object-cover" loading="lazy" /> : null}
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
            <div className="flex gap-2">
              <Input value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder="输入你的问题，系统会实时输出回答..." onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void onAskQuestion() } }} />
              {isSearching ? <Button variant="outline" onClick={onStopAnswer}><Square className="h-4 w-4" /></Button> : <Button onClick={() => void onAskQuestion()} disabled={!question.trim()}><Send className="h-4 w-4" /></Button>}
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="trace" className="mt-0 min-h-0 flex-1">
        <ScrollArea className="themed-thin-scrollbar flex-1">
          <div className="space-y-4 p-4">
            {!selectedTraceId ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">先在问答卡片里选择一个 trace_id，这里会展示完整的检索与回答链路。</div> : null}
            {traceError ? <div className="rounded-2xl border border-destructive/30 bg-destructive/6 p-4 text-sm text-destructive">{traceError}</div> : null}
            {selectedTraceId && traceLoadingId === selectedTraceId ? <div className="flex items-center justify-center rounded-2xl border border-border/70 bg-card/65 p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载 Trace 明细...</div> : null}
            {selectedTrace ? (
              <>
                <div className="rounded-2xl border border-border/70 bg-card/65 p-4">
                  <h3 className="text-sm font-medium">Trace 摘要</h3>
                  <p className="mt-2 text-xs text-muted-foreground">trace_id: {selectedTrace.trace_id}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">问题</p><p className="mt-1 text-sm">{asString(asObject(traceStartedPayload.metadata).query_text) || "未记录问题文本"}</p></div>
                    <div className="rounded-xl border border-border/60 bg-background/55 p-3"><p className="text-xs text-muted-foreground">完成状态</p><p className="mt-1 text-sm">{asString(traceFinishedPayload.ok) || "未记录"}</p></div>
                  </div>
                </div>
                <Accordion type="single" collapsible className="rounded-2xl border border-border/70 bg-card/65 px-4">
                  {TRACE_SECTIONS.map((section) => {
                    const hits = asRecordArray(traceRetrievalPayload[section.key])
                    return (
                      <AccordionItem key={section.key} value={section.key}>
                        <AccordionTrigger>
                          <div className="flex flex-1 items-center justify-between gap-3 text-left">
                            <div>
                              <p className="text-sm font-medium">{section.label}</p>
                              <p className="text-xs text-muted-foreground">共 {hits.length} 条命中记录</p>
                            </div>
                            <Badge variant="secondary">{section.scoreKey}</Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3">
                            {hits.map((hit, index) => (
                              <div key={`${section.key}-${index}-${asString(hit.doc_id)}`} className="rounded-xl border border-border/60 bg-background/55 p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{asString(hit.task_title) || "未命名任务"}</span>
                                  <Badge variant="outline">{asString(hit.source) || "evidence"}</Badge>
                                  <Badge variant="secondary">分数 {asNumber(hit[section.scoreKey])?.toFixed(3) || "0.000"}</Badge>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{asString(hit.text)}</p>
                              </div>
                            ))}
                            {hits.length === 0 ? <p className="text-sm text-muted-foreground">这一阶段还没有可展示的命中记录。</p> : null}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
                <div className="rounded-2xl border border-border/70 bg-card/65 p-4">
                  <h3 className="text-sm font-medium">模型完成阶段</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{asString(traceLlmPayload.answer_preview) || "未记录回答预览"}</p>
                </div>
              </>
            ) : null}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="research" className="mt-0 min-h-0 flex-1">
        <ResearchBoardPanel onSeek={onSeek} />
      </TabsContent>
    </Tabs>
  )
}

interface VqaWorkbenchProps {
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
}
