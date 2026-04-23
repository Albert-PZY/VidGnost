import { z } from "zod"

export const workflowTypeSchema = z.enum(["notes", "vqa"])
export type WorkflowType = z.infer<typeof workflowTypeSchema>

export const modelSizeSchema = z.enum(["small", "medium"])
export type ModelSize = z.infer<typeof modelSizeSchema>

export const sourceTypeSchema = z.enum(["youtube", "bilibili", "local_file", "local_path"])
export type SourceType = z.infer<typeof sourceTypeSchema>

export const taskStatusSchema = z.enum([
  "queued",
  "running",
  "preparing",
  "transcribing",
  "summarizing",
  "paused",
  "completed",
  "failed",
  "cancelled",
])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const taskStepStatusSchema = z.enum(["pending", "processing", "completed", "error"])
export type TaskStepStatus = z.infer<typeof taskStepStatusSchema>
