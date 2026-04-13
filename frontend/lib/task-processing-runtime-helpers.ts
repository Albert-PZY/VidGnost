import type { TaskStreamEvent, TranscriptSegment, VqaChatStreamEvent, VqaCitationItem } from "@/lib/types"
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

