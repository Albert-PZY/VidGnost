import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"

import type { TaskDetailResponse, TaskStreamEvent, TranscriptSegment, VqaTraceResponse } from "@/lib/types"
import {
  EMPTY_RUNTIME_CORRECTION_PREVIEW,
  EMPTY_RUNTIME_TRANSCRIPT_INDEX,
  applyTaskStreamEvent,
  applyCorrectionPreviewStreamEvent,
  extractTranscriptSegmentFromTaskEvent,
  mergeTranscriptIndexState,
  mergeTranscriptSegments,
  prependTaskEventsBounded,
  shouldRecordTaskEvent,
  transcriptIndexToSegments,
} from "@/lib/task-processing-runtime-helpers"
import type {
  IngestTaskStreamEventOptions,
  RuntimeCorrectionPreviewState,
  RuntimeChatMessage,
  TaskProcessingRuntimeSession,
  TaskProcessingRuntimeState,
  TaskProcessingRuntimeStore,
} from "@/stores/task-processing-runtime-types"

export const DEFAULT_TASK_EVENT_MAX_ITEMS = 80
const MAX_TRACE_CACHE_ITEMS = 8

function buildInitialState(
  session: TaskProcessingRuntimeSession | null = null,
): TaskProcessingRuntimeState {
  return {
    session,
    task: null,
    taskErrorMessage: "",
    isInitialLoading: false,
    isRefreshing: false,
    taskEvents: [],
    liveTranscript: EMPTY_RUNTIME_TRANSCRIPT_INDEX,
    rawTranscriptSegments: [],
    persistedRawTranscriptSegments: [],
    correctionPreview: EMPTY_RUNTIME_CORRECTION_PREVIEW,
    persistedCorrectionMode: "unknown",
    persistedCorrectionText: "",
    persistedCorrectionFallbackUsed: false,
    isCorrectionPreviewLoading: false,
    chatHistory: [],
    isChatStreaming: false,
    selectedTraceId: "",
    traceCache: {},
    traceLoadingId: "",
    traceError: "",
  }
}

function resolveCorrectionPreviewUpdater(
  current: RuntimeCorrectionPreviewState,
  updater: RuntimeCorrectionPreviewState | ((state: RuntimeCorrectionPreviewState) => RuntimeCorrectionPreviewState),
): RuntimeCorrectionPreviewState {
  if (typeof updater === "function") {
    return updater(current)
  }
  return updater
}

function appendTaskEventsWithLimit(
  current: TaskStreamEvent[],
  incoming: TaskStreamEvent[],
  maxItems?: number,
): TaskStreamEvent[] {
  return prependTaskEventsBounded(current, incoming, maxItems ?? DEFAULT_TASK_EVENT_MAX_ITEMS)
}

function resolveTranscriptSegmentsUpdater(
  current: TranscriptSegment[],
  updater: TranscriptSegment[] | ((state: TranscriptSegment[]) => TranscriptSegment[]),
): TranscriptSegment[] {
  if (typeof updater === "function") {
    return updater(current)
  }
  return updater
}

function applyBufferedTaskStreamEvents(
  state: TaskProcessingRuntimeState,
  events: TaskStreamEvent[],
  options?: IngestTaskStreamEventOptions,
) {
  if (!events.length) {
    return state
  }

  const maxItems = options?.maxTaskEvents ?? DEFAULT_TASK_EVENT_MAX_ITEMS
  const shouldRecordEvent = options?.shouldRecordTaskEvent || shouldRecordTaskEvent

  let nextTask = state.task
  let nextLiveTranscript = state.liveTranscript
  let nextCorrectionPreview = state.correctionPreview
  let nextTaskEvents = state.taskEvents
  let changed = false

  for (const event of events) {
    const isTranscriptResetEvent =
      typeof event.reset === "boolean" &&
      event.reset &&
      typeof event.type === "string" &&
      String(event.original_type || event.type).trim().toLowerCase() === "transcript_delta"
    if (isTranscriptResetEvent && nextLiveTranscript !== EMPTY_RUNTIME_TRANSCRIPT_INDEX) {
      nextLiveTranscript = EMPTY_RUNTIME_TRANSCRIPT_INDEX
      changed = true
    }

    const streamedSegment = extractTranscriptSegmentFromTaskEvent(event)
    if (streamedSegment) {
      const mergedTranscript = mergeTranscriptIndexState(nextLiveTranscript, [streamedSegment])
      if (mergedTranscript !== nextLiveTranscript) {
        nextLiveTranscript = mergedTranscript
        changed = true
      }
    }

    const mergedCorrectionPreview = applyCorrectionPreviewStreamEvent(nextCorrectionPreview, event)
    if (mergedCorrectionPreview !== nextCorrectionPreview) {
      nextCorrectionPreview = mergedCorrectionPreview
      changed = true
    }

    if (nextTask) {
      const mergedTask = applyTaskStreamEvent(nextTask, event)
      if (mergedTask !== nextTask) {
        nextTask = mergedTask
        changed = true
      }
    }

    if (shouldRecordEvent(event)) {
      const mergedEvents = appendTaskEventsWithLimit(nextTaskEvents, [event], maxItems)
      if (mergedEvents !== nextTaskEvents) {
        nextTaskEvents = mergedEvents
        changed = true
      }
    }
  }

  if (!changed) {
    return state
  }

  return {
    ...state,
    task: nextTask,
    liveTranscript: nextLiveTranscript,
    correctionPreview: nextCorrectionPreview,
    taskEvents: nextTaskEvents,
  }
}

function updateChatMessage(
  chatHistory: RuntimeChatMessage[],
  messageId: string,
  updater: (current: RuntimeChatMessage) => RuntimeChatMessage,
): RuntimeChatMessage[] {
  const index = chatHistory.findIndex((message) => message.id === messageId)
  if (index < 0) {
    return chatHistory
  }
  const next = chatHistory.slice()
  next[index] = updater(next[index])
  return next
}

function setOrClearTraceCache(
  currentCache: Record<string, VqaTraceResponse>,
  traceId: string,
  payload: VqaTraceResponse,
  selectedTraceId = "",
): Record<string, VqaTraceResponse> {
  if (!traceId) {
    return currentCache
  }
  const nextCache = {
    ...currentCache,
    [traceId]: payload,
  }
  const protectedKeys = new Set([traceId, selectedTraceId].filter(Boolean))
  const entries = Object.entries(nextCache)
  if (entries.length <= MAX_TRACE_CACHE_ITEMS) {
    return nextCache
  }

  const prunedEntries = [...entries]
  while (prunedEntries.length > MAX_TRACE_CACHE_ITEMS) {
    const removableIndex = prunedEntries.findIndex(([key]) => !protectedKeys.has(key))
    if (removableIndex < 0) {
      break
    }
    prunedEntries.splice(removableIndex, 1)
  }
  return Object.fromEntries(prunedEntries)
}

export function createTaskProcessingRuntimeStore(
  initialSession?: TaskProcessingRuntimeSession | null,
) {
  return createStore<TaskProcessingRuntimeStore>()((set) => ({
    ...buildInitialState(initialSession ?? null),
    initializeSession: (session) => {
      set(buildInitialState(session))
    },
    resetRuntime: () => {
      set((state) => buildInitialState(state.session))
    },
    setTask: (task: TaskDetailResponse | null) => {
      set({ task })
    },
    updateTask: (updater) => {
      set((state) => ({
        task: updater(state.task),
      }))
    },
    setTaskErrorMessage: (message) => {
      set({ taskErrorMessage: message })
    },
    setLoadingState: ({ isInitialLoading, isRefreshing }) => {
      set((state) => ({
        isInitialLoading: isInitialLoading ?? state.isInitialLoading,
        isRefreshing: isRefreshing ?? state.isRefreshing,
      }))
    },
    replaceTaskEvents: (events) => {
      set({ taskEvents: events.slice() })
    },
    appendTaskEvents: (events, maxItems) => {
      if (!events.length) {
        return
      }
      set((state) => ({
        taskEvents: appendTaskEventsWithLimit(state.taskEvents, events, maxItems),
      }))
    },
    applyTaskEventBatch: (events, options) => {
      if (!events.length) {
        return
      }
      set((state) => applyBufferedTaskStreamEvents(state, events, options))
    },
    ingestTaskStreamEvent: (event, options?: IngestTaskStreamEventOptions) => {
      set((state) => applyBufferedTaskStreamEvents(state, [event], options))
    },
    clearTaskEvents: () => {
      set({ taskEvents: [] })
    },
    replaceLiveTranscript: (segments: TranscriptSegment[]) => {
      set({
        liveTranscript: mergeTranscriptIndexState(EMPTY_RUNTIME_TRANSCRIPT_INDEX, segments),
      })
    },
    appendLiveTranscriptSegments: (segments: TranscriptSegment[]) => {
      if (!segments.length) {
        return
      }
      set((state) => ({
        liveTranscript: mergeTranscriptIndexState(state.liveTranscript, segments),
      }))
    },
    clearLiveTranscript: () => {
      set({ liveTranscript: EMPTY_RUNTIME_TRANSCRIPT_INDEX })
    },
    setRawTranscriptSegments: (updater) => {
      set((state) => ({
        rawTranscriptSegments: resolveTranscriptSegmentsUpdater(state.rawTranscriptSegments, updater),
      }))
    },
    setPersistedRawTranscriptSegments: (segments) => {
      set({ persistedRawTranscriptSegments: segments })
    },
    resetCorrectionPreview: () => {
      set({ correctionPreview: EMPTY_RUNTIME_CORRECTION_PREVIEW })
    },
    setCorrectionPreview: (updater) => {
      set((state) => ({
        correctionPreview: resolveCorrectionPreviewUpdater(state.correctionPreview, updater),
      }))
    },
    ingestCorrectionPreviewEvent: (event) => {
      set((state) => ({
        correctionPreview: applyCorrectionPreviewStreamEvent(state.correctionPreview, event),
      }))
    },
    setIsCorrectionPreviewLoading: (loading) => {
      set({ isCorrectionPreviewLoading: loading })
    },
    setPersistedCorrectionArtifacts: ({ mode, text, fallbackUsed }) => {
      set((state) => ({
        persistedCorrectionMode: mode ?? state.persistedCorrectionMode,
        persistedCorrectionText: text ?? state.persistedCorrectionText,
        persistedCorrectionFallbackUsed: fallbackUsed ?? state.persistedCorrectionFallbackUsed,
      }))
    },
    resetChat: () => {
      set({
        chatHistory: [],
        isChatStreaming: false,
      })
    },
    appendChatMessage: (message) => {
      set((state) => ({
        chatHistory: [...state.chatHistory, message],
      }))
    },
    appendChatMessages: (messages) => {
      if (!messages.length) {
        return
      }
      set((state) => ({
        chatHistory: [...state.chatHistory, ...messages],
      }))
    },
    upsertChatMessage: (messageId, updater) => {
      set((state) => ({
        chatHistory: updateChatMessage(state.chatHistory, messageId, updater),
      }))
    },
    setChatStreaming: (streaming) => {
      set({ isChatStreaming: streaming })
    },
    setSelectedTraceId: (traceId) => {
      set({ selectedTraceId: traceId })
    },
    setTraceLoadingId: (traceId) => {
      set({ traceLoadingId: traceId })
    },
    setTraceError: (message) => {
      set({ traceError: message })
    },
    upsertTraceCache: (traceId, payload) => {
      set((state) => ({
        traceCache: setOrClearTraceCache(state.traceCache, traceId, payload, state.selectedTraceId),
      }))
    },
    clearTraceCache: () => {
      set({
        traceCache: {},
        selectedTraceId: "",
        traceLoadingId: "",
        traceError: "",
      })
    },
  }))
}

export const taskProcessingRuntimeStore = createTaskProcessingRuntimeStore()

export function useTaskProcessingRuntimeStore<T>(
  selector: (state: TaskProcessingRuntimeStore) => T,
): T {
  return useStore(taskProcessingRuntimeStore, selector)
}

export function getTaskProcessingRuntimeState(): TaskProcessingRuntimeStore {
  return taskProcessingRuntimeStore.getState()
}

export function resetTaskProcessingRuntimeStore(): void {
  taskProcessingRuntimeStore.getState().resetRuntime()
}

export function mergeTaskAndLiveTranscriptSegments(
  taskTranscriptSegments: TranscriptSegment[] | null | undefined,
  liveTranscript: TaskProcessingRuntimeState["liveTranscript"],
): TranscriptSegment[] {
  return mergeTranscriptSegments(taskTranscriptSegments ?? [], transcriptIndexToSegments(liveTranscript))
}
