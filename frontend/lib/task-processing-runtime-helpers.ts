import type {
  TaskDetailResponse,
  TaskStepItem,
  TaskStreamEvent,
  TranscriptSegment,
  VqaChatStreamEvent,
  VqaCitationItem,
  WorkflowType,
} from "@/lib/types"
import type {
  RuntimeCorrectionPreviewMode,
  RuntimeCorrectionPreviewState,
  RuntimeTranscriptIndexState,
  RuntimeChatMessage,
} from "@/stores/task-processing-runtime-types"

export const EMPTY_RUNTIME_TRANSCRIPT_INDEX: RuntimeTranscriptIndexState = {
  byKey: {},
  order: [],
}

export const EMPTY_RUNTIME_CORRECTION_PREVIEW: RuntimeCorrectionPreviewState = {
  mode: "unknown",
  text: "",
  segments: [],
  done: false,
  fallbackUsed: false,
}

export const DEFAULT_TASK_EVENT_NOISE_TYPES = new Set([
  "transcript_delta",
  "progress",
  "summary_delta",
  "mindmap_delta",
  "transcript_optimized_preview",
  "fusion_prompt_preview",
])

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

export function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

export function asNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function clampPercentage(value: unknown): number {
  const parsed = asNumber(value)
  if (parsed == null) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(parsed)))
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

function isTerminalTask(status: string | undefined): boolean {
  return Boolean(status && ["completed", "failed", "cancelled"].includes(status))
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

  const normalizedProgress = progress == null ? null : clampPercentage(progress)
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
    Object.entries(currentMetrics).map(([key, value]) => [key, { ...value }]),
  )

  const updateMetric = (key: string, patcher: (metric: Record<string, unknown>) => Record<string, unknown>) => {
    const currentMetric = { ...(nextMetrics[key] ?? {}) }
    nextMetrics[key] = patcher(currentMetric)
  }

  if (rawType === "progress" && (stage === "A" || stage === "B" || stage === "C")) {
    updateMetric(stage, (metric) => ({
      ...metric,
      status: metric.status === "completed" ? "completed" : "running",
      started_at: asString(metric.started_at) || timestamp,
    }))
    return nextMetrics
  }

  if (rawType === "stage_start" && (stage === "A" || stage === "B" || stage === "C" || stage === "D")) {
    updateMetric(stage, (metric) => ({
      ...metric,
      status: "running",
      started_at: timestamp || metric.started_at,
      completed_at: null,
      reason: null,
    }))
    return nextMetrics
  }

  if (rawType === "stage_complete" && (stage === "A" || stage === "B" || stage === "C" || stage === "D")) {
    updateMetric(stage, (metric) => ({
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

export function normalizeTaskStreamEventType(event: TaskStreamEvent): string {
  return asString(event.original_type || event.type).trim().toLowerCase()
}

export function normalizeCorrectionPreviewMode(raw: unknown): RuntimeCorrectionPreviewMode {
  const normalized = asString(raw).trim().toLowerCase()
  if (normalized === "off" || normalized === "strict" || normalized === "rewrite") {
    return normalized
  }
  return "unknown"
}

export function buildTranscriptSegmentKey(segment: Pick<TranscriptSegment, "start" | "end">): string {
  return `${Number(segment.start).toFixed(2)}-${Number(segment.end).toFixed(2)}`
}

export function normalizeTranscriptSegment(segment: TranscriptSegment): TranscriptSegment | null {
  const start = asNumber(segment.start)
  const end = asNumber(segment.end)
  const text = asString(segment.text).trim()
  if (start == null || end == null || !text) {
    return null
  }
  return {
    ...segment,
    start,
    end,
    text,
  }
}

function compareTranscriptSegmentByKey(
  leftKey: string,
  rightKey: string,
  byKey: Record<string, TranscriptSegment>,
): number {
  const left = byKey[leftKey]
  const right = byKey[rightKey]
  if (!left || !right) {
    return left ? -1 : right ? 1 : 0
  }
  return left.start - right.start || left.end - right.end
}

function insertSegmentKeyInOrder(
  order: string[],
  key: string,
  byKey: Record<string, TranscriptSegment>,
): string[] {
  if (order.length === 0) {
    return [key]
  }
  let low = 0
  let high = order.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const compared = compareTranscriptSegmentByKey(key, order[middle], byKey)
    if (compared <= 0) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  const next = order.slice()
  next.splice(low, 0, key)
  return next
}

export function createTranscriptIndexState(segments: TranscriptSegment[]): RuntimeTranscriptIndexState {
  let next = EMPTY_RUNTIME_TRANSCRIPT_INDEX
  next = mergeTranscriptIndexState(next, segments)
  return next
}

export function mergeTranscriptIndexState(
  current: RuntimeTranscriptIndexState,
  incoming: TranscriptSegment[],
): RuntimeTranscriptIndexState {
  if (!incoming.length) {
    return current
  }

  let changed = false
  let nextByKey = current.byKey
  let nextOrder = current.order

  for (const segment of incoming) {
    const normalized = normalizeTranscriptSegment(segment)
    if (!normalized) {
      continue
    }

    const key = buildTranscriptSegmentKey(normalized)
    const previous = nextByKey[key]
    const hasChanged =
      !previous ||
      previous.text !== normalized.text ||
      previous.speaker !== normalized.speaker ||
      previous.start !== normalized.start ||
      previous.end !== normalized.end

    if (!hasChanged) {
      continue
    }

    if (!changed) {
      nextByKey = { ...nextByKey }
      nextOrder = nextOrder.slice()
      changed = true
    }

    nextByKey[key] = normalized

    if (!previous) {
      nextOrder = insertSegmentKeyInOrder(nextOrder, key, nextByKey)
    }
  }

  if (!changed) {
    return current
  }

  return {
    byKey: nextByKey,
    order: nextOrder,
  }
}

export function transcriptIndexToSegments(indexState: RuntimeTranscriptIndexState): TranscriptSegment[] {
  if (!indexState.order.length) {
    return []
  }
  const result: TranscriptSegment[] = []
  for (const key of indexState.order) {
    const segment = indexState.byKey[key]
    if (segment) {
      result.push(segment)
    }
  }
  return result
}

export function mergeTranscriptSegments(
  baseSegments: TranscriptSegment[],
  incomingSegments: TranscriptSegment[],
): TranscriptSegment[] {
  const baseState = createTranscriptIndexState(baseSegments)
  const mergedState = mergeTranscriptIndexState(baseState, incomingSegments)
  return transcriptIndexToSegments(mergedState)
}

export function extractTranscriptSegmentFromTaskEvent(event: TaskStreamEvent): TranscriptSegment | null {
  if (normalizeTaskStreamEventType(event) !== "transcript_delta") {
    return null
  }
  const start = asNumber(event["start"])
  const end = asNumber(event["end"])
  const text = asString(event.text).trim()
  if (start == null || end == null || !text) {
    return null
  }
  return { start, end, text }
}

export function applyTaskStreamEvent(
  current: TaskDetailResponse,
  event: TaskStreamEvent,
): TaskDetailResponse {
  const rawType = normalizeTaskStreamEventType(event)
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
        const targetStatus = substageStatus === "failed" ? "error" : "completed"
        const progressedSteps = updateStepProgress(nextSteps, stepId, targetStatus, stageProgress ?? 100)
        nextSteps.splice(0, nextSteps.length, ...progressedSteps)
      }
    }
  }

  const nextProgress = overallProgress == null ? current.progress : clampPercentage(overallProgress)
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

export function shouldRecordTaskEvent(event: TaskStreamEvent): boolean {
  return !DEFAULT_TASK_EVENT_NOISE_TYPES.has(normalizeTaskStreamEventType(event))
}

export function prependTaskEventsBounded(
  current: TaskStreamEvent[],
  incoming: TaskStreamEvent[],
  maxItems: number,
): TaskStreamEvent[] {
  if (!incoming.length) {
    return current
  }
  const next = [...incoming, ...current]
  return next.slice(0, Math.max(1, maxItems))
}

export function applyCorrectionPreviewStreamEvent(
  current: RuntimeCorrectionPreviewState,
  event: TaskStreamEvent,
): RuntimeCorrectionPreviewState {
  if (normalizeTaskStreamEventType(event) !== "transcript_optimized_preview") {
    return current
  }

  const explicitMode = normalizeCorrectionPreviewMode(event.mode)
  if (Boolean(event.reset)) {
    return {
      ...EMPTY_RUNTIME_CORRECTION_PREVIEW,
      mode: explicitMode !== "unknown" ? explicitMode : current.mode,
    }
  }

  const nextStart = asNumber(event.start)
  const nextEnd = asNumber(event.end)
  const nextText = asString(event.text).trim()
  const nextMode =
    explicitMode !== "unknown"
      ? explicitMode
      : nextStart !== null && nextEnd !== null
        ? "strict"
        : current.mode === "unknown"
          ? "rewrite"
          : current.mode
  const appendedSegments =
    nextStart !== null && nextEnd !== null && nextText
      ? mergeTranscriptSegments(current.segments, [{ start: nextStart, end: nextEnd, text: nextText }])
      : current.segments
  const appendedText =
    nextStart === null && nextEnd === null && nextText
      ? `${current.text}${nextText}`
      : current.text

  return {
    mode: nextMode,
    text: appendedText,
    segments: appendedSegments,
    done: Boolean(event.done) || current.done,
    fallbackUsed: current.fallbackUsed,
  }
}

function dedupeCitations(citations: VqaCitationItem[]): VqaCitationItem[] {
  if (citations.length <= 1) {
    return citations
  }
  const seen = new Set<string>()
  const result: VqaCitationItem[] = []
  for (const citation of citations) {
    const key = `${citation.doc_id}:${citation.start}:${citation.end}:${citation.text}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(citation)
  }
  return result
}

export function applyVqaChatEventToAssistantMessage(
  current: RuntimeChatMessage,
  event: VqaChatStreamEvent,
): RuntimeChatMessage {
  if (current.role !== "assistant") {
    return current
  }
  const next = { ...current }
  if (event.trace_id) {
    next.traceId = event.trace_id
  }
  if (event.type === "citations") {
    next.citations = dedupeCitations(event.citations ?? [])
    next.contextTokensApprox = event.context_tokens_approx
  }
  if (event.type === "chunk" && event.delta) {
    next.content += event.delta
    if (!current.content.trim()) {
      next.statusMessage = ""
    }
  }
  if (event.type === "replace") {
    next.content = asString(event.content)
    next.status = "streaming"
    next.statusMessage = ""
    next.errorMessage = ""
  }
  if (event.type === "status") {
    next.statusMessage = asString(event.message || event.status)
    if (event.status === "fallback") {
      next.status = "streaming"
      next.errorMessage = ""
    }
  }
  if (event.type === "error") {
    next.status = "error"
    next.errorMessage = asString(event.error?.message || event.message || "流式回答失败")
  }
  if (event.type === "done") {
    next.status = next.errorMessage ? "error" : "done"
  }
  return next
}

export function finalizeAssistantMessageAfterStream(message: RuntimeChatMessage): RuntimeChatMessage {
  if (message.role !== "assistant") {
    return message
  }
  return {
    ...message,
    content: message.content.trim() || message.errorMessage || "未生成回答。",
    status: message.errorMessage ? "error" : "done",
  }
}

export function buildRuntimeMessageId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}

export function createRuntimeUserMessage(content: string, id?: string): RuntimeChatMessage {
  return {
    id: id || buildRuntimeMessageId("user"),
    role: "user",
    content: asString(content),
    status: "done",
    citations: [],
  }
}

export function createRuntimeAssistantPlaceholder(
  options?: { id?: string; statusMessage?: string },
): RuntimeChatMessage {
  return {
    id: options?.id || buildRuntimeMessageId("assistant"),
    role: "assistant",
    content: "",
    status: "streaming",
    citations: [],
    statusMessage: options?.statusMessage || "处理中...",
  }
}

export function getVqaStreamStatusText(event: VqaChatStreamEvent): string {
  switch (event.status) {
    case "retrieving":
      return "正在检索相关片段..."
    case "generating":
      return (event.hit_count ?? 0) > 0
        ? "已完成证据检索，正在组织回答..."
        : "未检索到直接证据，正在组织回答..."
    case "fallback":
      return "流式连接短暂中断，已切换稳定模式补全回答..."
    default:
      return event.message || event.status || ""
  }
}

export function isRetryableVqaStreamError(rawMessage: string): boolean {
  const lowered = rawMessage.trim().toLowerCase()
  return lowered.includes("incomplete chunked read") || lowered.includes("peer closed connection")
}

export function getVqaStreamErrorText(event: VqaChatStreamEvent): string {
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
