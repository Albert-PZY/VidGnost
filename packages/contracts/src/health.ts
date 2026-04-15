import { z } from "zod"

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  app: z.string().min(1),
  version: z.string().min(1),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
