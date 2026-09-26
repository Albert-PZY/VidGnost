import type { IsoDateTime, TokenUsage } from "./common.js"

/** 转写引擎标识。 */
export type TranscriptEngine =
  | "dashscope-filetrans"
  | "faster-whisper"
  | "openai-compatible"
  | "platform-subtitle"

export interface TranscriptWord {
  start: number
  end: number
  text: string
}

export interface TranscriptSegment {
  id: string
  /** 秒。 */
  start: number
  /** 秒。 */
  end: number
  text: string
  speaker?: string
  confidence?: number
  words?: TranscriptWord[]
}

export interface TranscriptDoc {
  language: string
  engine: TranscriptEngine
  /** 引擎细节，例如模型名、分片数、是否回退。 */
  engineDetail: string
  durationSeconds: number
  /** 说话人标签（若可用）。 */
  speakers: string[]
  segments: TranscriptSegment[]
  /** 纯文本全文（段落换行）。 */
  text: string
  usage?: TokenUsage & { audioSeconds?: number }
  createdAt: IsoDateTime
}

/**
 * 语义段落：由相邻 segment 归并而成，作为摘要与检索的最小阅读单元。
 */
export interface TranscriptParagraph {
  id: string
  start: number
  end: number
  text: string
  segmentIds: string[]
  /** 命中语言模型纠错标记。 */
  corrected?: boolean
}

export interface ParagraphDoc {
  paragraphs: TranscriptParagraph[]
  generatedBy: string
}
