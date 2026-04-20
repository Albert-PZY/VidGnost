import { z } from "zod"

import { sourceTypeSchema } from "./domain.js"
import { exportRecordSchema } from "./study.js"

export const knowledgeSourceKindSchema = z.enum(["transcript", "qa_answer", "summary", "highlight", "quote", "manual"])
export type KnowledgeSourceKind = z.infer<typeof knowledgeSourceKindSchema>

export const knowledgeNoteSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  study_theme_id: z.string().min(1).nullable(),
  source_type: sourceTypeSchema,
  source_kind: knowledgeSourceKindSchema,
  title: z.string().min(1),
  excerpt: z.string().min(1),
  note_markdown: z.string().min(1).nullable(),
  tags: z.array(z.string().min(1)),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
})
export type KnowledgeNote = z.infer<typeof knowledgeNoteSchema>

export const knowledgeNoteCreateRequestSchema = z.object({
  task_id: z.string().min(1),
  study_theme_id: z.string().min(1).nullable().optional(),
  source_kind: knowledgeSourceKindSchema,
  title: z.string().min(1).max(160),
  excerpt: z.string().min(1),
  note_markdown: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().min(1)).default([]),
})
export type KnowledgeNoteCreateRequest = z.infer<typeof knowledgeNoteCreateRequestSchema>

export const knowledgeNoteUpdateRequestSchema = z.object({
  study_theme_id: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(160).optional(),
  excerpt: z.string().min(1).optional(),
  note_markdown: z.string().min(1).nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
})
export type KnowledgeNoteUpdateRequest = z.infer<typeof knowledgeNoteUpdateRequestSchema>

export const knowledgeNoteFilterSchema = z.object({
  task_id: z.string().min(1).optional(),
  source_type: sourceTypeSchema.optional(),
  source_kind: knowledgeSourceKindSchema.optional(),
  study_theme_id: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
})
export type KnowledgeNoteFilter = z.infer<typeof knowledgeNoteFilterSchema>

export const knowledgeLibraryResponseSchema = z.object({
  items: z.array(knowledgeNoteSchema),
  total: z.number().int().nonnegative(),
  filters: knowledgeNoteFilterSchema,
  export_records: z.array(exportRecordSchema),
})
export type KnowledgeLibraryResponse = z.infer<typeof knowledgeLibraryResponseSchema>
