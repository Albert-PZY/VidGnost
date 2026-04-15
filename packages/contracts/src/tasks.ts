import { z } from "zod"

import {
  modelSizeSchema,
  sourceTypeSchema,
  taskStatusSchema,
  taskStepStatusSchema,
  workflowTypeSchema,
} from "./domain.js"

export const transcriptSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  speaker: z.string().nullable().optional(),
})

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>

export const taskStepItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: taskStepStatusSchema,
  progress: z.number().int().min(0).max(100),
  duration: z.string(),
  logs: z.array(z.string()),
})

export type TaskStepItem = z.infer<typeof taskStepItemSchema>

export const taskCreateResponseSchema = z.object({
  task_id: z.string().min(1),
  status: taskStatusSchema,
  workflow: workflowTypeSchema,
  initial_steps: z.array(taskStepItemSchema),
})

export type TaskCreateResponse = z.infer<typeof taskCreateResponseSchema>

export const taskBatchCreateResponseSchema = z.object({
  strategy: z.enum(["single_task_per_file", "batch_task"]),
  tasks: z.array(taskCreateResponseSchema),
})

export type TaskBatchCreateResponse = z.infer<typeof taskBatchCreateResponseSchema>

export const taskSummaryItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  workflow: workflowTypeSchema,
  source_type: sourceTypeSchema,
  source_input: z.string(),
  status: taskStatusSchema,
  progress: z.number().int().min(0).max(100),
  file_size_bytes: z.number().int().nonnegative(),
  duration_seconds: z.number().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})

export type TaskSummaryItem = z.infer<typeof taskSummaryItemSchema>

export const taskListResponseSchema = z.object({
  items: z.array(taskSummaryItemSchema),
  total: z.number().int().nonnegative(),
})

export type TaskListResponse = z.infer<typeof taskListResponseSchema>

export const taskStatsResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  vqa: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
})

export type TaskStatsResponse = z.infer<typeof taskStatsResponseSchema>

export const taskRecentItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  workflow: workflowTypeSchema,
  duration_seconds: z.number().nullable(),
  updated_at: z.string().min(1),
})

export type TaskRecentItem = z.infer<typeof taskRecentItemSchema>

export const taskRecentResponseSchema = z.object({
  items: z.array(taskRecentItemSchema),
})

export type TaskRecentResponse = z.infer<typeof taskRecentResponseSchema>

const taskMetricsRecordSchema = z.record(z.string(), z.record(z.string(), z.unknown()))
const taskArtifactIndexItemSchema = z.record(z.string(), z.unknown())

export const taskDetailResponseSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  workflow: workflowTypeSchema,
  source_type: sourceTypeSchema,
  source_input: z.string(),
  source_local_path: z.string().nullable(),
  language: z.string().min(1),
  model_size: modelSizeSchema.or(z.string().min(1)),
  status: taskStatusSchema,
  progress: z.number().int().min(0).max(100),
  overall_progress: z.number().int().min(0).max(100),
  eta_seconds: z.number().int().nullable(),
  current_step_id: z.string(),
  steps: z.array(taskStepItemSchema),
  error_message: z.string().nullable(),
  duration_seconds: z.number().nullable(),
  transcript_text: z.string().nullable(),
  transcript_segments: z.array(transcriptSegmentSchema),
  summary_markdown: z.string().nullable(),
  mindmap_markdown: z.string().nullable(),
  notes_markdown: z.string().nullable(),
  fusion_prompt_markdown: z.string().nullable(),
  stage_logs: z.record(z.string(), z.array(z.string())),
  stage_metrics: taskMetricsRecordSchema,
  vm_phase_metrics: taskMetricsRecordSchema,
  artifact_total_bytes: z.number().int().nonnegative(),
  artifact_index: z.array(taskArtifactIndexItemSchema),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})

export type TaskDetailResponse = z.infer<typeof taskDetailResponseSchema>

export const taskSourceCreatePayloadSchema = z.object({
  workflow: workflowTypeSchema,
  language: z.string().min(1).optional(),
  model_size: modelSizeSchema.optional(),
})

export type TaskSourceCreatePayload = z.infer<typeof taskSourceCreatePayloadSchema>

export const taskCreateFromUrlRequestSchema = taskSourceCreatePayloadSchema.extend({
  url: z.string().url(),
})

export type TaskCreateFromUrlRequest = z.infer<typeof taskCreateFromUrlRequestSchema>

export const taskCreateFromPathRequestSchema = taskSourceCreatePayloadSchema.extend({
  local_path: z.string().min(1),
})

export type TaskCreateFromPathRequest = z.infer<typeof taskCreateFromPathRequestSchema>

export const taskTitleUpdateRequestSchema = z.object({
  title: z.string().min(1),
})

export type TaskTitleUpdateRequest = z.infer<typeof taskTitleUpdateRequestSchema>

export const taskArtifactsUpdateRequestSchema = z.object({
  summary_markdown: z.string().nullable().optional(),
  notes_markdown: z.string().nullable().optional(),
  mindmap_markdown: z.string().nullable().optional(),
})

export type TaskArtifactsUpdateRequest = z.infer<typeof taskArtifactsUpdateRequestSchema>

export const taskExportKindSchema = z.enum(["transcript", "notes", "mindmap", "srt", "vtt", "bundle"])
export type TaskExportKind = z.infer<typeof taskExportKindSchema>

export const taskStreamEventSchema = z.object({
  type: z.string().min(1),
  task_id: z.string().min(1),
  workflow: workflowTypeSchema,
  timestamp: z.string().min(1),
  original_type: z.string().optional(),
  text: z.string().optional(),
  stage: z.string().optional(),
  substage: z.string().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  progress: z.number().optional(),
  overall_progress: z.number().optional(),
}).catchall(z.unknown())

export type TaskStreamEvent = z.infer<typeof taskStreamEventSchema>
