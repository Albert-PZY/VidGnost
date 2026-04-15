import { z } from "zod"

export const vqaSearchRequestSchema = z.object({
  query_text: z.string().min(1).optional(),
  question: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  video_paths: z.array(z.string().min(1)).default([]),
  top_k: z.number().int().min(1).max(50).optional(),
})

export type VqaSearchRequest = z.infer<typeof vqaSearchRequestSchema>

export const vqaAnalyzeRequestSchema = vqaSearchRequestSchema

export type VqaAnalyzeRequest = z.infer<typeof vqaAnalyzeRequestSchema>

export const vqaChatRequestSchema = vqaSearchRequestSchema.extend({
  stream: z.boolean().default(true),
})

export type VqaChatRequest = z.infer<typeof vqaChatRequestSchema>

export const vqaCitationItemSchema = z.object({
  doc_id: z.string().min(1),
  task_id: z.string().min(1),
  task_title: z.string(),
  source: z.string(),
  source_set: z.array(z.string()),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  image_path: z.string(),
})

export type VqaCitationItem = z.infer<typeof vqaCitationItemSchema>

export const vqaTraceRecordSchema = z.object({
  trace_id: z.string().optional(),
  stage: z.string().optional(),
  ts: z.string().optional(),
}).catchall(z.unknown())

export type VqaTraceRecord = z.infer<typeof vqaTraceRecordSchema>

export const vqaTraceResponseSchema = z.object({
  trace_id: z.string().min(1),
  records: z.array(vqaTraceRecordSchema),
})

export type VqaTraceResponse = z.infer<typeof vqaTraceResponseSchema>

export const vqaChatStreamEventSchema = z.object({
  trace_id: z.string().optional(),
  type: z.string().min(1),
  delta: z.string().optional(),
  content: z.string().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
  hit_count: z.number().int().nonnegative().optional(),
  context_tokens_approx: z.number().int().nonnegative().optional(),
  citations: z.array(vqaCitationItemSchema).optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .nullable()
    .optional(),
}).catchall(z.unknown())

export type VqaChatStreamEvent = z.infer<typeof vqaChatStreamEventSchema>
