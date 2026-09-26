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

export const modelRouteSchema = z.object({
  role: modelRoleSchema,
  provider: z.enum(["dashscope", "openrouter", "openai-compatible", "local"]),
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
  id: z.enum(["dashscope", "openrouter", "openai-compatible"]),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().max(500).nullable().optional(),
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
