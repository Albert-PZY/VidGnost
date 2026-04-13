import type {
  TaskDetailResponse,
  TaskStreamEvent,
  TranscriptSegment,
  VqaCitationItem,
  VqaTraceResponse,
  WorkflowType,
} from "@/lib/types"

export type RuntimeCorrectionPreviewMode = "unknown" | "off" | "strict" | "rewrite"
export type RuntimeChatRole = "user" | "assistant"
export type RuntimeChatStatus = "streaming" | "done" | "error"

export interface TaskProcessingRuntimeSession {
  taskId: string
  workflow: WorkflowType
  taskTitle: string
}

export interface RuntimeTranscriptIndexState {
  byKey: Record<string, TranscriptSegment>
  order: string[]
}

export interface RuntimeCorrectionPreviewState {
  mode: RuntimeCorrectionPreviewMode
  text: string
  segments: TranscriptSegment[]
  done: boolean
  fallbackUsed: boolean
}

export interface RuntimeChatMessage {
  id: string
  role: RuntimeChatRole
  content: string
  status: RuntimeChatStatus
  citations: VqaCitationItem[]
  traceId?: string
  contextTokensApprox?: number
  statusMessage?: string
  errorMessage?: string
}

export interface TaskProcessingRuntimeState {
  session: TaskProcessingRuntimeSession | null
  task: TaskDetailResponse | null
  taskErrorMessage: string
  isInitialLoading: boolean
  isRefreshing: boolean
  taskEvents: TaskStreamEvent[]
  liveTranscript: RuntimeTranscriptIndexState
  rawTranscriptSegments: TranscriptSegment[]
  persistedRawTranscriptSegments: TranscriptSegment[]
  correctionPreview: RuntimeCorrectionPreviewState
  persistedCorrectionMode: RuntimeCorrectionPreviewMode
  persistedCorrectionText: string
  persistedCorrectionFallbackUsed: boolean
  isCorrectionPreviewLoading: boolean
  chatHistory: RuntimeChatMessage[]
  isChatStreaming: boolean
  selectedTraceId: string
  traceCache: Record<string, VqaTraceResponse>
  traceLoadingId: string
  traceError: string
}

export interface IngestTaskStreamEventOptions {
  maxTaskEvents?: number
  shouldRecordTaskEvent?: (event: TaskStreamEvent) => boolean
}

export interface TaskProcessingRuntimeActions {
  initializeSession: (session: TaskProcessingRuntimeSession) => void
  resetRuntime: () => void
  setTask: (task: TaskDetailResponse | null) => void
  updateTask: (updater: (current: TaskDetailResponse | null) => TaskDetailResponse | null) => void
  setTaskErrorMessage: (message: string) => void
  setLoadingState: (next: { isInitialLoading?: boolean; isRefreshing?: boolean }) => void
  replaceTaskEvents: (events: TaskStreamEvent[]) => void
  appendTaskEvents: (events: TaskStreamEvent[], maxItems?: number) => void
  applyTaskEventBatch: (events: TaskStreamEvent[], options?: IngestTaskStreamEventOptions) => void
  ingestTaskStreamEvent: (event: TaskStreamEvent, options?: IngestTaskStreamEventOptions) => void
  clearTaskEvents: () => void
  replaceLiveTranscript: (segments: TranscriptSegment[]) => void
  appendLiveTranscriptSegments: (segments: TranscriptSegment[]) => void
  clearLiveTranscript: () => void
  setRawTranscriptSegments: (
    updater: TranscriptSegment[] | ((current: TranscriptSegment[]) => TranscriptSegment[]),
  ) => void
  setPersistedRawTranscriptSegments: (segments: TranscriptSegment[]) => void
  resetCorrectionPreview: () => void
  setCorrectionPreview: (
    updater:
      | RuntimeCorrectionPreviewState
      | ((current: RuntimeCorrectionPreviewState) => RuntimeCorrectionPreviewState),
  ) => void
  ingestCorrectionPreviewEvent: (event: TaskStreamEvent) => void
  setIsCorrectionPreviewLoading: (loading: boolean) => void
  setPersistedCorrectionArtifacts: (payload: {
    mode?: RuntimeCorrectionPreviewMode
    text?: string
    fallbackUsed?: boolean
  }) => void
  resetChat: () => void
  appendChatMessage: (message: RuntimeChatMessage) => void
  appendChatMessages: (messages: RuntimeChatMessage[]) => void
  upsertChatMessage: (messageId: string, updater: (current: RuntimeChatMessage) => RuntimeChatMessage) => void
  setChatStreaming: (streaming: boolean) => void
  setSelectedTraceId: (traceId: string) => void
  setTraceLoadingId: (traceId: string) => void
  setTraceError: (message: string) => void
  upsertTraceCache: (traceId: string, payload: VqaTraceResponse) => void
  clearTraceCache: () => void
}

export type TaskProcessingRuntimeStore = TaskProcessingRuntimeState & TaskProcessingRuntimeActions
