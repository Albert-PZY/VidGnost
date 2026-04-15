import { z } from "zod"

export const runtimeMetricsResponseSchema = z.object({
  uptime_seconds: z.number().int().nonnegative(),
  cpu_percent: z.number().nonnegative(),
  memory_used_bytes: z.number().int().nonnegative(),
  memory_total_bytes: z.number().int().nonnegative(),
  gpu_percent: z.number().nonnegative(),
  gpu_memory_used_bytes: z.number().int().nonnegative(),
  gpu_memory_total_bytes: z.number().int().nonnegative(),
  sampled_at: z.string().min(1),
})

export type RuntimeMetricsResponse = z.infer<typeof runtimeMetricsResponseSchema>

export const runtimePathsResponseSchema = z.object({
  storage_dir: z.string().min(1),
  event_log_dir: z.string().min(1),
  trace_log_dir: z.string().min(1),
})

export type RuntimePathsResponse = z.infer<typeof runtimePathsResponseSchema>
