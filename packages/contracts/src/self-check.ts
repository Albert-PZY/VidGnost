import { z } from "zod"

export const selfCheckStepResponseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  message: z.string(),
  details: z.record(z.string(), z.string()),
  auto_fixable: z.boolean(),
  manual_action: z.string(),
})

export type SelfCheckStepResponse = z.infer<typeof selfCheckStepResponseSchema>

export const selfCheckIssueResponseSchema = selfCheckStepResponseSchema

export type SelfCheckIssueResponse = z.infer<typeof selfCheckIssueResponseSchema>

export const selfCheckStartResponseSchema = z.object({
  session_id: z.string().min(1),
  status: z.string().min(1),
})

export type SelfCheckStartResponse = z.infer<typeof selfCheckStartResponseSchema>

export const selfCheckAutoFixResponseSchema = z.object({
  session_id: z.string().min(1),
  status: z.string().min(1),
})

export type SelfCheckAutoFixResponse = z.infer<typeof selfCheckAutoFixResponseSchema>

export const selfCheckReportResponseSchema = z.object({
  session_id: z.string().min(1),
  status: z.string().min(1),
  progress: z.number().int().min(0).max(100),
  steps: z.array(selfCheckStepResponseSchema),
  issues: z.array(selfCheckIssueResponseSchema),
  auto_fix_available: z.boolean(),
  updated_at: z.string().min(1),
  last_error: z.string(),
})

export type SelfCheckReportResponse = z.infer<typeof selfCheckReportResponseSchema>

export const selfCheckStreamEventSchema = z.object({
  type: z.string().min(1),
  session_id: z.string().min(1),
  progress: z.number().int().min(0).max(100).optional(),
  total_steps: z.number().int().positive().optional(),
  index: z.number().int().positive().optional(),
  step: selfCheckStepResponseSchema.optional(),
  issues: z.array(selfCheckIssueResponseSchema).optional(),
  auto_fix_available: z.boolean().optional(),
  status: z.string().optional(),
  error: z.string().optional(),
}).catchall(z.unknown())

export type SelfCheckStreamEvent = z.infer<typeof selfCheckStreamEventSchema>
