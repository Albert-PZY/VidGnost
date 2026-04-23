import { z } from "zod"

import { sourceTypeSchema, taskStatusSchema, workflowTypeSchema } from "./domain.js"

export const studyGenerationTierSchema = z.enum(["heuristic", "llm"])
export type StudyGenerationTier = z.infer<typeof studyGenerationTierSchema>

export const studyReadinessSchema = z.enum(["pending", "ready", "degraded", "failed"])
export type StudyReadiness = z.infer<typeof studyReadinessSchema>

export const translationTargetSchema = z.object({
  language: z.string().min(1),
  label: z.string().min(1).optional(),
})
export type TranslationTarget = z.infer<typeof translationTargetSchema>

export const subtitleTrackKindSchema = z.enum(["source", "platform_translation", "whisper", "llm_translation"])
export type SubtitleTrackKind = z.infer<typeof subtitleTrackKindSchema>

export const subtitleTrackAvailabilitySchema = z.enum(["available", "generated", "missing", "failed"])
export type SubtitleTrackAvailability = z.infer<typeof subtitleTrackAvailabilitySchema>

export const translationRecordSourceSchema = z.enum(["disabled", "original", "platform_track", "llm_generated"])
export type TranslationRecordSource = z.infer<typeof translationRecordSourceSchema>

export const translationRecordStatusSchema = z.enum(["disabled", "pending", "ready", "failed"])
export type TranslationRecordStatus = z.infer<typeof translationRecordStatusSchema>

export const exportRecordFormatSchema = z.enum(["md", "txt", "srt", "vtt", "csv", "json", "zip", "directory_bundle"])
export type ExportRecordFormat = z.infer<typeof exportRecordFormatSchema>

export const studyTaskExportKindValues = [
  "study_pack",
  "subtitle_tracks",
  "translation_records",
  "knowledge_notes",
] as const

export const taskExportKindValues = [
  "transcript",
  "notes",
  "mindmap",
  "srt",
  "vtt",
  "bundle",
  ...studyTaskExportKindValues,
] as const

export const studyHighlightSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  start_seconds: z.number().min(0),
  end_seconds: z.number().min(0),
  order: z.number().int().nonnegative(),
  transcript_text: z.string().optional(),
})
export type StudyHighlight = z.infer<typeof studyHighlightSchema>

export const studyThemeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  order: z.number().int().nonnegative(),
})
export type StudyTheme = z.infer<typeof studyThemeSchema>

export const studyQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  order: z.number().int().nonnegative(),
  theme_id: z.string().min(1).nullable(),
})
export type StudyQuestion = z.infer<typeof studyQuestionSchema>

export const studyQuoteSchema = z.object({
  id: z.string().min(1),
  quote: z.string().min(1),
  speaker: z.string().min(1).nullable(),
  start_seconds: z.number().min(0),
  end_seconds: z.number().min(0),
  order: z.number().int().nonnegative(),
  theme_id: z.string().min(1).nullable(),
})
export type StudyQuote = z.infer<typeof studyQuoteSchema>

export const studyPackSchema = z.object({
  task_id: z.string().min(1),
  overview: z.string().min(1),
  generation_tier: studyGenerationTierSchema,
  readiness: studyReadinessSchema,
  fallback_used: z.boolean(),
  highlights: z.array(studyHighlightSchema),
  themes: z.array(studyThemeSchema),
  questions: z.array(studyQuestionSchema),
  quotes: z.array(studyQuoteSchema),
  generated_at: z.string().min(1),
})
export type StudyPack = z.infer<typeof studyPackSchema>

export const studyPreviewSchema = z.object({
  readiness: studyReadinessSchema,
  generation_tier: studyGenerationTierSchema.nullable(),
  highlight_count: z.number().int().nonnegative(),
  question_count: z.number().int().nonnegative(),
  note_count: z.number().int().nonnegative(),
  is_favorite: z.boolean(),
  last_opened_at: z.string().nullable(),
  last_exported_at: z.string().nullable(),
})
export type StudyPreview = z.infer<typeof studyPreviewSchema>

export const studyStateSchema = z.object({
  playback_position_seconds: z.number().min(0),
  selected_theme_id: z.string().min(1).nullable(),
  active_highlight_id: z.string().min(1).nullable(),
  last_selected_subtitle_track_id: z.string().min(1).nullable(),
  is_favorite: z.boolean(),
  last_opened_at: z.string().nullable(),
})
export type StudyState = z.infer<typeof studyStateSchema>

export const subtitleTrackSchema = z.object({
  task_id: z.string().min(1),
  track_id: z.string().min(1),
  label: z.string().min(1),
  language: z.string().min(1),
  kind: subtitleTrackKindSchema,
  availability: subtitleTrackAvailabilitySchema,
  is_default: z.boolean(),
  artifact_path: z.string().nullable(),
  source_url: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})
export type SubtitleTrack = z.infer<typeof subtitleTrackSchema>

export const translationRecordSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  source: translationRecordSourceSchema,
  status: translationRecordStatusSchema,
  target: translationTargetSchema.nullable(),
  subtitle_track_id: z.string().min(1).nullable(),
  artifact_path: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})
export type TranslationRecord = z.infer<typeof translationRecordSchema>

export const taskExportKindSchema = z.enum(taskExportKindValues)
export type TaskExportKindValue = z.infer<typeof taskExportKindSchema>

export const exportRecordSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  export_kind: taskExportKindSchema,
  format: exportRecordFormatSchema,
  file_path: z.string().min(1),
  created_at: z.string().min(1),
})
export type ExportRecord = z.infer<typeof exportRecordSchema>

export const subtitleSwitchRequestSchema = z.object({
  track_id: z.string().min(1),
})
export type SubtitleSwitchRequest = z.infer<typeof subtitleSwitchRequestSchema>

export const taskExportCreateRequestSchema = z.object({
  export_kind: taskExportKindSchema,
  format: exportRecordFormatSchema.optional(),
})
export type TaskExportCreateRequest = z.infer<typeof taskExportCreateRequestSchema>

export const studyWorkbenchTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  workflow: workflowTypeSchema,
  source_type: sourceTypeSchema,
  source_input: z.string().min(1),
  source_local_path: z.string().nullable(),
  language: z.string().min(1),
  duration_seconds: z.number().nullable(),
  status: taskStatusSchema,
  progress: z.number().int().min(0).max(100),
  updated_at: z.string().min(1),
})
export type StudyWorkbenchTask = z.infer<typeof studyWorkbenchTaskSchema>

export const studyWorkbenchResponseSchema = z.object({
  task: studyWorkbenchTaskSchema,
  preview: studyPreviewSchema,
  study_pack: studyPackSchema,
  subtitle_tracks: z.array(subtitleTrackSchema),
  translation_records: z.array(translationRecordSchema),
  study_state: studyStateSchema,
  export_records: z.array(exportRecordSchema),
})
export type StudyWorkbenchResponse = z.infer<typeof studyWorkbenchResponseSchema>
