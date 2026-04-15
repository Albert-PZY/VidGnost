import { z } from "zod"

export const apiErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  hint: z.string(),
  retryable: z.boolean(),
  detail: z.unknown(),
})

export type ApiErrorPayload = z.infer<typeof apiErrorPayloadSchema>
