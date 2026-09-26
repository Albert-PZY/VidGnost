/**
 * VidGnost v3 — 通用领域基础类型
 *
 * 约定：
 * - 所有时间轴字段单位为「秒」，允许小数；毫秒只在与 DashScope 等外部 API 边界出现。
 * - 所有持久化对象都是纯 JSON（无 Date、无 undefined）。
 */

export type IsoDateTime = string

/** 任务 ID，形如 `vg_20260926_ab12cd`。 */
export type TaskId = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ErrorShape {
  code: string
  message: string
  detail?: JsonValue
  hint?: string
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}
