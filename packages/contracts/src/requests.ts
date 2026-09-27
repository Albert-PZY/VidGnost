import { z } from "zod"

import type { ProcessingPreset, TaskOptions } from "./pipeline.js"
import type { ModelRole, ModelRoute } from "./providers.js"

export const processingPresetSchema = z.enum(["fast", "balanced", "deep"])

export const taskOptionsSchema = z.object({
  language: z.string().min(1).max(32).optional(),
  preset: processingPresetSchema.optional(),
  asr: z.enum(["auto", "online", "local"]).optional(),
  vision: z.boolean().optional(),
  proofread: z.boolean().optional(),
  translateTo: z.string().min(2).max(32).nullable().optional(),
})

export const createTaskRequestSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  options: taskOptionsSchema.optional(),
})

export const askRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(20)
    .optional(),
  topK: z.number().int().min(1).max(20).optional(),
  chapterId: z.string().min(1).optional(),
})

export const modelRoleSchema = z.enum([
  "llm.fast",
  "llm.balanced",
  "llm.reasoning",
  "llm.quality",
  "llm.bulk",
  "llm.fallback",
  "vision.primary",
  "asr.online",
  "asr.local",
  "embedding",
  "rerank",
  "translate",
])

export const modelKindSchema = z.enum(["chat", "vision", "asr", "embedding", "rerank", "translation"])

export const providerProtocolSchema = z.enum(["openai", "anthropic", "gemini", "dashscope", "openrouter", "local"])

/** 提供方 id：内置四个固定值，自定义渠道由名称派生，允许中文与连字符。 */
export const providerIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9\u4e00-\u9fa5][a-z0-9\u4e00-\u9fa5-]*$/, "只能包含小写字母、数字、中文与连字符")

export const modelRouteSchema = z.object({
  role: modelRoleSchema,
  provider: providerIdSchema,
  model: z.string().min(1),
  label: z.string().optional(),
  allowFallback: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(200000).optional(),
})

export const settingsPatchSchema = z.object({
  settings: z
    .object({
      defaultPreset: processingPresetSchema.optional(),
      defaultLanguage: z.string().min(1).max(32).optional(),
      defaultAsr: z.enum(["auto", "online", "local"]).optional(),
      defaultVision: z.boolean().optional(),
      defaultProofread: z.boolean().optional(),
      defaultTranslateTo: z.string().min(2).max(32).nullable().optional(),
      whisper: z
        .object({
          pythonExecutable: z.string().max(500).optional(),
          model: z.string().max(120).optional(),
          device: z.enum(["auto", "cpu", "cuda"]).optional(),
          computeType: z.string().max(60).optional(),
          modelDir: z.string().max(500).optional(),
        })
        .optional(),
      maxConcurrentTasks: z.number().int().min(1).max(8).optional(),
      keepIntermediateMedia: z.boolean().optional(),
    })
    .optional(),
  routes: z.array(modelRouteSchema).max(32).optional(),
})

export const providerPatchSchema = z.object({
  id: providerIdSchema,
  label: z.string().min(1).max(60).optional(),
  protocol: providerProtocolSchema.optional(),
  baseUrl: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().max(500).nullable().optional(),
})

/** 新增自定义渠道：协议必填，Base URL 缺省时用该协议的默认值。 */
export const providerCreateSchema = z.object({
  id: providerIdSchema.optional(),
  label: z.string().min(1).max(60),
  protocol: providerProtocolSchema,
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
})

/** 在渠道下登记模型。 */
export const providerModelSchema = z.object({
  label: z.string().min(1).max(120),
  kind: modelKindSchema,
  contextWindow: z.number().int().min(1).max(10_000_000).optional(),
  dimensions: z.number().int().min(1).max(65536).optional(),
  description: z.string().max(400).optional(),
  tags: z.array(z.string().max(24)).max(8).optional(),
})

export type CreateTaskRequestInput = z.infer<typeof createTaskRequestSchema>
export type AskRequestInput = z.infer<typeof askRequestSchema>
export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>
export type ProviderPatchInput = z.infer<typeof providerPatchSchema>

export const PRESET_DEFAULTS: Record<ProcessingPreset, Partial<TaskOptions>> = {
  fast: { proofread: false, vision: false },
  balanced: { proofread: false, vision: false },
  deep: { proofread: true, vision: true },
}

export type { ModelRole, ModelRoute }
