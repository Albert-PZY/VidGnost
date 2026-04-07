export type TaskStatus =
  | 'queued'
  | 'preparing'
  | 'transcribing'
  | 'summarizing'
  | 'cancelled'
  | 'completed'
  | 'failed'

export type StageKey = 'A' | 'B' | 'C' | 'D'
export type VmPhaseKey = 'A' | 'B' | 'C' | 'transcript_optimize' | 'D'
export type VmPhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface TaskSummaryItem {
  id: string
  title: string | null
  source_type: 'bilibili' | 'local_file'
  source_input: string
  status: TaskStatus
  progress: number
  created_at: string
  updated_at: string
}

export interface TaskDetail {
  id: string
  title: string | null
  source_type: 'bilibili' | 'local_file'
  source_input: string
  language: string
  model_size: string
  status: TaskStatus
  progress: number
  error_message: string | null
  duration_seconds: number | null
  transcript_text: string | null
  transcript_segments: TranscriptSegment[]
  summary_markdown: string | null
  mindmap_markdown: string | null
  notes_markdown: string | null
  fusion_prompt_markdown: string | null
  stage_logs: Record<'A' | 'B' | 'C' | 'D', string[]>
  stage_metrics: Record<'A' | 'B' | 'C' | 'D', StageMetric>
  vm_phase_metrics: Record<VmPhaseKey, VmPhaseMetric>
  artifact_total_bytes: number
  artifact_index: Array<Record<string, unknown>>
  created_at: string
  updated_at: string
}

export interface StageMetric {
  started_at: string | null
  completed_at: string | null
  elapsed_seconds: number | null
  log_count: number
  [key: string]: string | number | boolean | null
}

export interface VmPhaseMetric {
  status: VmPhaseStatus | string
  started_at: string | null
  completed_at: string | null
  elapsed_seconds: number | null
  optional?: boolean
  reason?: string | null
}

export interface TaskEvent {
  task_id: string
  ts: string
  type:
    | 'stage_start'
    | 'stage_complete'
    | 'substage_start'
    | 'substage_complete'
    | 'progress'
    | 'log'
  | 'transcript_delta'
  | 'transcript_optimized_preview'
  | 'fusion_prompt_preview'
  | 'summary_delta'
  | 'notes_delta'
  | 'mindmap_delta'
    | 'runtime_warning'
    | 'task_complete'
    | 'task_cancelled'
    | 'task_failed'
  stage?: StageKey
  title?: string
  message?: string
  substage?: string
  code?: string
  component?: string
  action?: string
  text?: string
  stream_mode?: 'realtime' | 'compat'
  markdown?: string
  start?: number
  end?: number
  reset?: boolean
  done?: boolean
  status?: TaskStatus | string
  stage_progress?: number
  overall_progress?: number
  elapsed_seconds?: number
  error?: string
}

export interface LLMConfig {
  mode: 'api'
  load_profile: 'balanced' | 'memory_first'
  local_model_id: string
  api_key: string
  base_url: string
  model: string
  correction_mode: 'off' | 'strict' | 'rewrite'
  correction_batch_size: number
  correction_overlap: number
}

export type PromptTemplateChannel = 'summary' | 'mindmap'

export interface PromptTemplateItem {
  id: string
  channel: PromptTemplateChannel
  name: string
  content: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface PromptTemplateBundle {
  summary_templates: PromptTemplateItem[]
  mindmap_templates: PromptTemplateItem[]
  selected_summary_template_id: string
  selected_mindmap_template_id: string
}

export interface WhisperConfig {
  model_default: 'small'
  language: string
  device: string
  compute_type: string
  model_load_profile: 'balanced' | 'memory_first'
  beam_size: number
  vad_filter: boolean
  chunk_seconds: number
  target_sample_rate: number
  target_channels: number
  warnings?: string[]
  rollback_applied?: boolean
}

export interface SelfCheckStep {
  id: string
  title: string
  status: 'pending' | 'running' | 'passed' | 'warning' | 'failed'
  message: string
  auto_fixable: boolean
  manual_action: string
}

export interface SelfCheckIssue {
  id: string
  title: string
  status: 'warning' | 'failed' | string
  message: string
  auto_fixable: boolean
  manual_action: string
}

export interface SelfCheckReport {
  session_id: string
  status: 'idle' | 'running' | 'completed' | 'failed' | 'fixing' | string
  progress: number
  steps: SelfCheckStep[]
  issues: SelfCheckIssue[]
  auto_fix_available: boolean
  updated_at: string
  last_error: string
}

export interface SelfCheckEvent {
  task_id: string
  ts: string
  type:
    | 'self_check_started'
    | 'self_check_step_start'
    | 'self_check_step_result'
    | 'self_check_complete'
    | 'self_check_failed'
    | 'self_fix_started'
    | 'self_fix_log'
    | 'self_fix_complete'
    | 'self_fix_failed'
  session_id?: string
  message?: string
  error?: string
  progress?: number
  index?: number
  total_steps?: number
  auto_fix_available?: boolean
  issues?: SelfCheckIssue[]
  step?: SelfCheckStep
}
