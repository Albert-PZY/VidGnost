import { useStore } from "zustand"
import { createStore } from "zustand/vanilla"

import type { TaskDetailResponse, TaskStreamEvent, TranscriptSegment, VqaTraceResponse } from "@/lib/types"
import {
  EMPTY_RUNTIME_CORRECTION_PREVIEW,
  EMPTY_RUNTIME_TRANSCRIPT_INDEX,
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
  RuntimeCorrectionPreviewMode,
  RuntimeCorrectionPreviewState,
  RuntimeChatMessage,
  TaskProcessingRuntimeSession,
  TaskProcessingRuntimeState,
  TaskProcessingRuntimeStore,
} from "@/stores/task-processing-runtime-types"

export const DEFAULT_TASK_EVENT_MAX_ITEMS = 80

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
    correctionPreview: EMPTY_RUNTIME_CORRECTION_PREVIEW,
    persistedCorrectionMode: "unknown",
    persistedCorrectionText: "",
    persistedCorrectionFallbackUsed: false,
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
): Record<string, VqaTraceResponse> {
  if (!traceId) {
    return currentCache
  }
  return {
    ...currentCache,
    [traceId]: payload,
  }
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
    ingestTaskStreamEvent: (event, options?: IngestTaskStreamEventOptions) => {
      const maxItems = options?.maxTaskEvents ?? DEFAULT_TASK_EVENT_MAX_ITEMS
      const shouldAppendEvent = (options?.shouldRecordTaskEvent || shouldRecordTaskEvent)(event)
      const streamedSegment = extractTranscriptSegmentFromTaskEvent(event)
      set((state) => {
        const nextLiveTranscript = streamedSegment
          ? mergeTranscriptIndexState(state.liveTranscript, [streamedSegment])
          : state.liveTranscript
        const nextCorrectionPreview = applyCorrectionPreviewStreamEvent(state.correctionPreview, event)
        const nextTaskEvents = shouldAppendEvent
          ? appendTaskEventsWithLimit(state.taskEvents, [event], maxItems)
          : state.taskEvents
        if (
          nextLiveTranscript === state.liveTranscript &&
          nextCorrectionPreview === state.correctionPreview &&
          nextTaskEvents === state.taskEvents
        ) {
          return state
        }
        return {
          liveTranscript: nextLiveTranscript,
          correctionPreview: nextCorrectionPreview,
          taskEvents: nextTaskEvents,
        }
      })
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
        traceCache: setOrClearTraceCache(state.traceCache, traceId, payload),
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

export function selectLiveTranscriptSegments(
  state: Pick<TaskProcessingRuntimeState, "liveTranscript">,
): TranscriptSegment[] {
  return transcriptIndexToSegments(state.liveTranscript)
}

export function selectMergedTranscriptSegments(
  state: Pick<TaskProcessingRuntimeState, "task" | "liveTranscript">,
): TranscriptSegment[] {
  return mergeTranscriptSegments(state.task?.transcript_segments ?? [], transcriptIndexToSegments(state.liveTranscript))
}

export function selectEffectiveCorrectionMode(
  state: Pick<TaskProcessingRuntimeState, "correctionPreview" | "persistedCorrectionMode">,
): RuntimeCorrectionPreviewMode {
  return state.correctionPreview.mode !== "unknown"
    ? state.correctionPreview.mode
    : state.persistedCorrectionMode
}

