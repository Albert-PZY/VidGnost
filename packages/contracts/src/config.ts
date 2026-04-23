import { z } from "zod"

export const promptTemplateChannelSchema = z.enum(["correction", "notes", "mindmap", "vqa"])
export type PromptTemplateChannel = z.infer<typeof promptTemplateChannelSchema>

export const backgroundImageFillModeSchema = z.enum(["cover", "contain", "repeat", "center"])
export type BackgroundImageFillMode = z.infer<typeof backgroundImageFillModeSchema>

export const modelComponentTypeSchema = z.enum(["whisper", "llm", "embedding", "rerank", "vlm"])
export type ModelComponentType = z.infer<typeof modelComponentTypeSchema>

export const modelRuntimeStatusSchema = z.enum(["ready", "loading", "not_ready", "error"])
export type ModelRuntimeStatus = z.infer<typeof modelRuntimeStatusSchema>

export const modelDownloadStateSchema = z.enum(["idle", "downloading", "completed", "cancelled", "failed"])
export type ModelDownloadState = z.infer<typeof modelDownloadStateSchema>

export const whisperRuntimeLibrariesStatusSchema = z.enum([
  "ready",
  "not_ready",
  "installing",
  "paused",
  "failed",
  "unsupported",
])
export type WhisperRuntimeLibrariesStatus = z.infer<typeof whisperRuntimeLibrariesStatusSchema>

export const whisperRuntimeLibrariesInstallStateSchema = z.enum([
  "idle",
  "installing",
  "paused",
  "completed",
  "failed",
])
export type WhisperRuntimeLibrariesInstallState = z.infer<typeof whisperRuntimeLibrariesInstallStateSchema>

export const llmCorrectionModeSchema = z.enum(["off", "strict", "rewrite"])
export type LlmCorrectionMode = z.infer<typeof llmCorrectionModeSchema>

export const llmLoadProfileSchema = z.enum(["balanced", "memory_first"])
export type LlmLoadProfile = z.infer<typeof llmLoadProfileSchema>

export const bilibiliAuthStatusSchema = z.enum(["missing", "pending", "active", "expired"])
export type BilibiliAuthStatus = z.infer<typeof bilibiliAuthStatusSchema>

export const bilibiliQrPollStatusSchema = z.enum(["pending", "scanned", "confirmed", "success", "expired", "failed"])
export type BilibiliQrPollStatus = z.infer<typeof bilibiliQrPollStatusSchema>

export const bilibiliAccountSchema = z.object({
  mid: z.string().min(1),
  uname: z.string().min(1),
})
export type BilibiliAccount = z.infer<typeof bilibiliAccountSchema>

export const bilibiliAuthStatusResponseSchema = z.object({
  status: bilibiliAuthStatusSchema,
  account: bilibiliAccountSchema.nullable(),
  expires_at: z.string().nullable(),
  last_validated_at: z.string().nullable(),
  last_error: z.string().nullable(),
  qrcode_key: z.string().min(1).nullable().optional(),
  qrcode_url: z.string().min(1).nullable().optional(),
  qr_image_data_url: z.string().min(1).nullable().optional(),
  poll_interval_ms: z.number().int().min(500).max(10_000).nullable().optional(),
})
export type BilibiliAuthStatusResponse = z.infer<typeof bilibiliAuthStatusResponseSchema>

export const bilibiliAuthQrStartResponseSchema = z.object({
  status: z.literal("pending"),
  qrcode_key: z.string().min(1),
  qrcode_url: z.string().min(1),
  qr_image_data_url: z.string().min(1),
  expires_at: z.string().nullable(),
  poll_interval_ms: z.number().int().min(500).max(10_000),
})
export type BilibiliAuthQrStartResponse = z.infer<typeof bilibiliAuthQrStartResponseSchema>

export const bilibiliAuthQrPollResponseSchema = z.object({
  status: bilibiliQrPollStatusSchema,
  account: bilibiliAccountSchema.nullable(),
  expires_at: z.string().nullable(),
  last_error: z.string().nullable(),
  message: z.string(),
})
export type BilibiliAuthQrPollResponse = z.infer<typeof bilibiliAuthQrPollResponseSchema>

export const uiSettingsResponseSchema = z.object({
  language: z.enum(["zh", "en"]),
  font_size: z.number().int().min(12).max(20),
  auto_save: z.boolean(),
  study_default_translation_target: z.string().min(1).nullable(),
  theme_hue: z.number().int().min(0).max(360),
  background_image: z.string().nullable(),
  background_image_opacity: z.number().int().min(0).max(100),
  background_image_blur: z.number().int().min(0).max(40),
  background_image_scale: z.number().min(1).max(4),
  background_image_focus_x: z.number().min(0).max(1),
  background_image_focus_y: z.number().min(0).max(1),
  background_image_fill_mode: backgroundImageFillModeSchema,
})

export type UISettingsResponse = z.infer<typeof uiSettingsResponseSchema>

export const uiSettingsUpdateRequestSchema = z.object({
  language: z.enum(["zh", "en"]).optional(),
  font_size: z.number().int().min(12).max(20).optional(),
  auto_save: z.boolean().optional(),
  study_default_translation_target: z.string().min(1).nullable().optional(),
  theme_hue: z.number().int().min(0).max(360).optional(),
  background_image: z.string().nullable().optional(),
  background_image_opacity: z.number().int().min(0).max(100).optional(),
  background_image_blur: z.number().int().min(0).max(40).optional(),
  background_image_scale: z.number().min(1).max(4).optional(),
  background_image_focus_x: z.number().min(0).max(1).optional(),
  background_image_focus_y: z.number().min(0).max(1).optional(),
  background_image_fill_mode: backgroundImageFillModeSchema.optional(),
})

export type UISettingsUpdateRequest = z.infer<typeof uiSettingsUpdateRequestSchema>

export const llmConfigResponseSchema = z.object({
  mode: z.literal("api"),
  load_profile: llmLoadProfileSchema,
  local_model_id: z.string().min(1),
  api_key: z.string(),
  api_key_configured: z.boolean(),
  base_url: z.string().min(1),
  model: z.string().min(1),
  correction_mode: llmCorrectionModeSchema,
  correction_batch_size: z.number().int().min(6).max(80),
  correction_overlap: z.number().int().min(0).max(20),
})

export type LLMConfigResponse = z.infer<typeof llmConfigResponseSchema>

export const llmConfigUpdateRequestSchema = llmConfigResponseSchema
export type LLMConfigUpdateRequest = z.infer<typeof llmConfigUpdateRequestSchema>

export const promptTemplateItemSchema = z.object({
  id: z.string().min(1),
  channel: promptTemplateChannelSchema,
  name: z.string().min(1),
  content: z.string().min(1),
  is_default: z.boolean(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})

export type PromptTemplateItem = z.infer<typeof promptTemplateItemSchema>

export const promptTemplateSelectionSchema = z.object({
  correction: z.string().min(1),
  notes: z.string().min(1),
  mindmap: z.string().min(1),
  vqa: z.string().min(1),
})

export type PromptTemplateSelection = z.infer<typeof promptTemplateSelectionSchema>

export const promptTemplateBundleResponseSchema = z.object({
  templates: z.array(promptTemplateItemSchema),
  selection: promptTemplateSelectionSchema,
  summary_templates: z.array(promptTemplateItemSchema),
  mindmap_templates: z.array(promptTemplateItemSchema),
  selected_summary_template_id: z.string().min(1),
  selected_mindmap_template_id: z.string().min(1),
})

export type PromptTemplateBundleResponse = z.infer<typeof promptTemplateBundleResponseSchema>

export const promptTemplateCreateRequestSchema = z.object({
  channel: promptTemplateChannelSchema,
  name: z.string().min(1).max(120),
  content: z.string().min(1),
})

export type PromptTemplateCreateRequest = z.infer<typeof promptTemplateCreateRequestSchema>

export const promptTemplateUpdateRequestSchema = z.object({
  name: z.string().min(1).max(120),
  content: z.string().min(1),
})

export type PromptTemplateUpdateRequest = z.infer<typeof promptTemplateUpdateRequestSchema>

export const promptTemplateSelectionUpdateRequestSchema = z.object({
  correction: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  mindmap: z.string().min(1).optional(),
  vqa: z.string().min(1).optional(),
})

export type PromptTemplateSelectionUpdateRequest = z.infer<typeof promptTemplateSelectionUpdateRequestSchema>

export const whisperRuntimeLibrariesProgressResponseSchema = z.object({
  state: whisperRuntimeLibrariesInstallStateSchema,
  message: z.string(),
  current_package: z.string(),
  downloaded_bytes: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  speed_bps: z.number().nonnegative(),
  resumable: z.boolean(),
  updated_at: z.string(),
})

export type WhisperRuntimeLibrariesProgressResponse = z.infer<typeof whisperRuntimeLibrariesProgressResponseSchema>

export const whisperRuntimeLibrariesResponseSchema = z.object({
  install_dir: z.string().min(1),
  auto_configure_env: z.boolean(),
  version_label: z.string().min(1),
  platform_supported: z.boolean(),
  ready: z.boolean(),
  status: whisperRuntimeLibrariesStatusSchema,
  message: z.string(),
  bin_dir: z.string(),
  missing_files: z.array(z.string()),
  discovered_files: z.record(z.string(), z.string()),
  load_error: z.string(),
  path_configured: z.boolean(),
  progress: whisperRuntimeLibrariesProgressResponseSchema,
})

export type WhisperRuntimeLibrariesResponse = z.infer<typeof whisperRuntimeLibrariesResponseSchema>

export const whisperConfigResponseSchema = z.object({
  model_default: z.string().min(1),
  language: z.string().min(1),
  device: z.string().min(1),
  compute_type: z.string().min(1),
  model_load_profile: llmLoadProfileSchema,
  beam_size: z.number().int().min(1).max(12),
  vad_filter: z.boolean(),
  chunk_seconds: z.number().int().min(30).max(1200),
  target_sample_rate: z.number().int().min(8000).max(48000),
  target_channels: z.number().int().min(1).max(2),
  runtime_libraries: whisperRuntimeLibrariesResponseSchema,
  warnings: z.array(z.string()),
  rollback_applied: z.boolean(),
})

export type WhisperConfigResponse = z.infer<typeof whisperConfigResponseSchema>

export const whisperConfigUpdateRequestSchema = z.object({
  model_default: z.string().min(1),
  language: z.string().min(1),
  device: z.string().min(1),
  compute_type: z.string().min(1),
  model_load_profile: llmLoadProfileSchema,
  beam_size: z.number().int().min(1).max(12),
  vad_filter: z.boolean(),
  chunk_seconds: z.number().int().min(30).max(1200),
  target_sample_rate: z.number().int().min(8000).max(48000),
  target_channels: z.number().int().min(1).max(2),
})

export type WhisperConfigUpdateRequest = z.infer<typeof whisperConfigUpdateRequestSchema>

export const ollamaServiceStatusResponseSchema = z.object({
  reachable: z.boolean(),
  process_detected: z.boolean(),
  process_id: z.number().int().nullable(),
  executable_path: z.string(),
  configured_models_dir: z.string(),
  effective_models_dir: z.string(),
  models_dir_source: z.enum(["env", "default", "unknown"]),
  using_configured_models_dir: z.boolean(),
  restart_required: z.boolean(),
  can_self_restart: z.boolean(),
  message: z.string(),
})

export type OllamaServiceStatusResponse = z.infer<typeof ollamaServiceStatusResponseSchema>

export const ollamaRuntimeConfigResponseSchema = z.object({
  service: ollamaServiceStatusResponseSchema,
  install_dir: z.string().min(1),
  executable_path: z.string().min(1),
  models_dir: z.string().min(1),
  base_url: z.string().min(1),
})

export type OllamaRuntimeConfigResponse = z.infer<typeof ollamaRuntimeConfigResponseSchema>

export const ollamaRuntimeConfigUpdateRequestSchema = z.object({
  install_dir: z.string().min(1).optional(),
  executable_path: z.string().min(1).optional(),
  models_dir: z.string().min(1).optional(),
  base_url: z.string().min(1).optional(),
})

export type OllamaRuntimeConfigUpdateRequest = z.infer<typeof ollamaRuntimeConfigUpdateRequestSchema>

export const ollamaModelsMigrationResponseSchema = z.object({
  service: ollamaServiceStatusResponseSchema,
  source_dir: z.string(),
  target_dir: z.string(),
  moved: z.boolean(),
  message: z.string(),
  warnings: z.array(z.string()),
})

export type OllamaModelsMigrationResponse = z.infer<typeof ollamaModelsMigrationResponseSchema>

export const ollamaModelsMigrationRequestSchema = z.object({
  target_dir: z.string().min(1),
})

export type OllamaModelsMigrationRequest = z.infer<typeof ollamaModelsMigrationRequestSchema>

export const localModelsMigrationTaskItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullable(),
  status: z.string().min(1),
  workflow: z.string().min(1),
})

export type LocalModelsMigrationTaskItem = z.infer<typeof localModelsMigrationTaskItemSchema>

export const localModelsMigrationResponseSchema = z.object({
  target_root: z.string().min(1),
  message: z.string(),
  requires_confirmation: z.boolean(),
  planned_model_ids: z.array(z.string()),
  running_tasks: z.array(localModelsMigrationTaskItemSchema),
  moved: z.array(z.string()),
  skipped: z.array(z.string()),
  ollama_restarted: z.boolean(),
  warnings: z.array(z.string()),
})

export type LocalModelsMigrationResponse = z.infer<typeof localModelsMigrationResponseSchema>

export const localModelsMigrationRequestSchema = z.object({
  target_root: z.string().min(1),
  confirm_running_tasks: z.boolean().optional(),
})

export type LocalModelsMigrationRequest = z.infer<typeof localModelsMigrationRequestSchema>

export const modelDownloadStatusSchema = z.object({
  state: modelDownloadStateSchema,
  message: z.string(),
  current_file: z.string(),
  downloaded_bytes: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  speed_bps: z.number().nonnegative(),
  updated_at: z.string(),
})

export type ModelDownloadStatus = z.infer<typeof modelDownloadStatusSchema>

export const modelDescriptorSchema = z.object({
  id: z.string().min(1),
  component: modelComponentTypeSchema,
  name: z.string().min(1),
  provider: z.string().min(1),
  model_id: z.string().min(1),
  path: z.string(),
  default_path: z.string(),
  status: modelRuntimeStatusSchema,
  quantization: z.string(),
  load_profile: z.string(),
  max_batch_size: z.number().int().min(1),
  rerank_top_n: z.number().int().min(1),
  enabled: z.boolean(),
  size_bytes: z.number().int().nonnegative(),
  is_installed: z.boolean(),
  supports_managed_download: z.boolean(),
  download: modelDownloadStatusSchema.nullable().optional(),
  last_check_at: z.string(),
  api_base_url: z.string(),
  api_key: z.string(),
  api_key_configured: z.boolean(),
  api_model: z.string(),
  api_protocol: z.string(),
  api_timeout_seconds: z.number().int().min(10),
})

export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>

export const modelListResponseSchema = z.object({
  items: z.array(modelDescriptorSchema),
})

export type ModelListResponse = z.infer<typeof modelListResponseSchema>

export const modelReloadRequestSchema = z.object({
  model_id: z.string().min(1).nullable().optional(),
})

export type ModelReloadRequest = z.infer<typeof modelReloadRequestSchema>

export const modelUpdateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model_id: z.string().min(1).optional(),
  path: z.string().optional(),
  status: modelRuntimeStatusSchema.optional(),
  load_profile: z.string().min(1).optional(),
  quantization: z.string().optional(),
  max_batch_size: z.number().int().min(1).max(64).optional(),
  rerank_top_n: z.number().int().min(1).max(20).optional(),
  enabled: z.boolean().optional(),
  api_base_url: z.string().optional(),
  api_key: z.string().optional(),
  api_model: z.string().optional(),
  api_protocol: z.string().optional(),
  api_timeout_seconds: z.number().int().min(10).max(600).optional(),
})

export type ModelUpdateRequest = z.infer<typeof modelUpdateRequestSchema>
