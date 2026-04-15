import type {
  ApiErrorPayload,
  BackgroundImageFillMode,
  HealthResponse,
  LLMConfigResponse,
  LocalModelsMigrationResponse,
  ModelComponentType,
  ModelDescriptor,
  ModelDownloadState,
  ModelDownloadStatus,
  ModelListResponse,
  ModelRuntimeStatus,
  OllamaModelsMigrationResponse,
  OllamaRuntimeConfigResponse,
  OllamaServiceStatusResponse,
  PromptTemplateBundleResponse,
  PromptTemplateChannel,
  PromptTemplateItem,
  RuntimeMetricsResponse,
  RuntimePathsResponse,
  SourceType,
  TaskBatchCreateResponse,
  TaskCreateResponse,
  TaskDetailResponse,
  TaskListResponse,
  TaskRecentItem,
  TaskRecentResponse,
  TaskStatsResponse,
  TaskStatus,
  TaskStepItem,
  TaskStepStatus,
  TaskSummaryItem,
  TaskSourceCreatePayload,
  TranscriptSegment,
  UISettingsResponse,
  WhisperConfigResponse,
  WhisperRuntimeLibrariesInstallState,
  WhisperRuntimeLibrariesProgressResponse,
  WhisperRuntimeLibrariesResponse,
  WhisperRuntimeLibrariesStatus,
  WorkflowType,
} from "@vidgnost/contracts"

export type {
  ApiErrorPayload,
  BackgroundImageFillMode,
  HealthResponse,
  LLMConfigResponse,
  LocalModelsMigrationResponse,
  ModelComponentType,
  ModelDescriptor,
  ModelDownloadState,
  ModelDownloadStatus,
  ModelListResponse,
  ModelRuntimeStatus,
  OllamaModelsMigrationResponse,
  OllamaRuntimeConfigResponse,
  OllamaServiceStatusResponse,
  PromptTemplateBundleResponse,
  PromptTemplateChannel,
  PromptTemplateItem,
  RuntimeMetricsResponse,
  RuntimePathsResponse,
  SourceType,
  TaskBatchCreateResponse,
  TaskCreateResponse,
  TaskDetailResponse,
  TaskListResponse,
  TaskRecentItem,
  TaskRecentResponse,
  TaskStatsResponse,
  TaskStatus,
  TaskStepItem,
  TaskStepStatus,
  TaskSummaryItem,
  TaskSourceCreatePayload,
  TranscriptSegment,
  UISettingsResponse,
  WhisperConfigResponse,
  WhisperRuntimeLibrariesInstallState,
  WhisperRuntimeLibrariesProgressResponse,
  WhisperRuntimeLibrariesResponse,
  WhisperRuntimeLibrariesStatus,
  WorkflowType,
} from "@vidgnost/contracts"

export interface SelfCheckStepResponse {
  id: string
  title: string
  status: string
  message: string
  details: Record<string, string>
  auto_fixable: boolean
  manual_action: string
}

export interface SelfCheckIssueResponse {
  id: string
  title: string
  status: string
  message: string
  details: Record<string, string>
  auto_fixable: boolean
  manual_action: string
}

export interface SelfCheckStartResponse {
  session_id: string
  status: string
}

export interface SelfCheckReportResponse {
  session_id: string
  status: string
  progress: number
  steps: SelfCheckStepResponse[]
  issues: SelfCheckIssueResponse[]
  auto_fix_available: boolean
  updated_at: string
  last_error: string
}

export interface TaskStreamEvent {
  type: string
  task_id: string
  workflow: WorkflowType
  timestamp: string
  original_type?: string
  text?: string
  stage?: string
  substage?: string
  title?: string
  message?: string
  progress?: number
  overall_progress?: number
  [key: string]: unknown
}

export interface SelfCheckStreamEvent {
  type: string
  session_id: string
  progress?: number
  total_steps?: number
  index?: number
  step?: SelfCheckStepResponse
  issues?: SelfCheckIssueResponse[]
  auto_fix_available?: boolean
  status?: string
  error?: string
  [key: string]: unknown
}

export interface VqaCitationItem {
  doc_id: string
  task_id: string
  task_title: string
  source: string
  source_set: string[]
  start: number
  end: number
  text: string
  image_path: string
}

export interface VqaTraceRecord {
  trace_id?: string
  stage?: string
  ts?: string
  [key: string]: unknown
}

export interface VqaTraceResponse {
  trace_id: string
  records: VqaTraceRecord[]
}

export interface VqaChatStreamEvent {
  trace_id?: string
  type: "citations" | "chunk" | "done" | "error" | "status" | string
  delta?: string
  content?: string
  status?: string
  message?: string
  hit_count?: number
  context_tokens_approx?: number
  citations?: VqaCitationItem[]
  error?: {
    code?: string
    message?: string
  } | null
}
