export type WorkflowType = "notes" | "vqa"

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | string

export type TaskStepStatus = "pending" | "processing" | "completed" | "error"

export type SourceType = "bilibili" | "local_file" | "local_path"

export type PromptTemplateChannel = "correction" | "notes" | "mindmap" | "vqa"

export type ModelComponentType = "whisper" | "llm" | "embedding" | "vlm" | "rerank"

export type ModelRuntimeStatus = "ready" | "loading" | "not_ready" | "error"

export type ModelDownloadState = "idle" | "downloading" | "completed" | "cancelled" | "failed"

export interface ApiErrorPayload {
  code: string
  message: string
  hint: string
  retryable: boolean
  detail: unknown
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  speaker?: string | null
}

export interface TaskStepItem {
  id: string
  name: string
  status: TaskStepStatus
  progress: number
  duration: string
  logs: string[]
}

export interface TaskCreateResponse {
  task_id: string
  status: TaskStatus
  workflow: WorkflowType
  initial_steps: TaskStepItem[]
}

export interface TaskBatchCreateResponse {
  strategy: "single_task_per_file" | "batch_task"
  tasks: TaskCreateResponse[]
}

export interface TaskSummaryItem {
  id: string
  title: string | null
  workflow: WorkflowType
  source_type: SourceType
  source_input: string
  status: TaskStatus
  progress: number
  file_size_bytes: number
  duration_seconds: number | null
  created_at: string
  updated_at: string
}

export interface TaskListResponse {
  items: TaskSummaryItem[]
  total: number
}

export interface TaskStatsResponse {
  total: number
  notes: number
  vqa: number
  completed: number
}

export interface TaskRecentItem {
  id: string
  title: string
  workflow: WorkflowType
  updated_at: string
}

export interface TaskRecentResponse {
  items: TaskRecentItem[]
}

export interface TaskDetailResponse {
  id: string
  title: string | null
  workflow: WorkflowType
  source_type: SourceType
  source_input: string
  source_local_path: string | null
  language: string
  model_size: string
  status: TaskStatus
  progress: number
  overall_progress: number
  eta_seconds: number | null
  current_step_id: string
  steps: TaskStepItem[]
  error_message: string | null
  duration_seconds: number | null
  transcript_text: string | null
  transcript_segments: TranscriptSegment[]
  summary_markdown: string | null
  mindmap_markdown: string | null
  notes_markdown: string | null
  fusion_prompt_markdown: string | null
  stage_logs: Record<string, string[]>
  stage_metrics: Record<string, Record<string, unknown>>
  vm_phase_metrics: Record<string, Record<string, unknown>>
  artifact_total_bytes: number
  artifact_index: Array<Record<string, unknown>>
  created_at: string
  updated_at: string
}

export interface ModelDescriptor {
  id: string
  component: ModelComponentType
  name: string
  provider: string
  model_id: string
  path: string
  default_path: string
  status: ModelRuntimeStatus
  quantization: string
  load_profile: string
  max_batch_size: number
  enabled: boolean
  size_bytes: number
  is_installed: boolean
  supports_managed_download: boolean
  download?: ModelDownloadStatus | null
  last_check_at: string
}

export interface ModelListResponse {
  items: ModelDescriptor[]
}

export interface ModelDownloadStatus {
  state: ModelDownloadState
  message: string
  current_file: string
  downloaded_bytes: number
  total_bytes: number
  percent: number
  speed_bps: number
  updated_at: string
}

export interface PromptTemplateItem {
  id: string
  channel: PromptTemplateChannel
  name: string
  content: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface PromptTemplateBundleResponse {
  templates: PromptTemplateItem[]
  selection: Record<PromptTemplateChannel, string>
  summary_templates: PromptTemplateItem[]
  mindmap_templates: PromptTemplateItem[]
  selected_summary_template_id: string
  selected_mindmap_template_id: string
}

export interface WhisperConfigResponse {
  model_default: string
  language: string
  device: string
  compute_type: string
  model_load_profile: "balanced" | "memory_first"
  beam_size: number
  vad_filter: boolean
  chunk_seconds: number
  target_sample_rate: number
  target_channels: number
  warnings: string[]
  rollback_applied: boolean
}

export interface LLMConfigResponse {
  mode: "api"
  load_profile: "balanced" | "memory_first"
  local_model_id: string
  api_key: string
  api_key_configured: boolean
  base_url: string
  model: string
  correction_mode: "off" | "strict" | "rewrite"
  correction_batch_size: number
  correction_overlap: number
}

export interface UISettingsResponse {
  language: "zh" | "en"
  font_size: number
  auto_save: boolean
}

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

export interface RuntimeMetricsResponse {
  uptime_seconds: number
  cpu_percent: number
  memory_used_bytes: number
  memory_total_bytes: number
  gpu_percent: number
  gpu_memory_used_bytes: number
  gpu_memory_total_bytes: number
  sampled_at: string
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

export interface VqaResultItem {
  timestamp: number
  relevance: number
  context: string
  source?: string
  start?: number
  end?: number
}

export interface VqaChatResponse {
  trace_id?: string
  answer?: string
  citations?: Array<Record<string, unknown>>
  context_tokens_approx?: number
  error?: {
    code?: string
    message?: string
  } | null
  hits?: Array<Record<string, unknown>>
  results?: VqaResultItem[]
}
