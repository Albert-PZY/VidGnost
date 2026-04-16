import type { LlmCorrectionMode, TranscriptSegment } from "@vidgnost/contracts"

import { clampInteger } from "../../core/number.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"

export interface TranscriptCorrectionIndex {
  mode: LlmCorrectionMode
  status: "completed" | "fallback" | "skipped"
  fallback_used: boolean
  fallback_reason: string
  source_mode: "llm_strict" | "llm_rewrite" | "strict_fallback" | "rewrite_fallback" | "raw_transcript"
  batch_count: number
  batch_size: number
  overlap: number
  original_segment_count: number
  corrected_segment_count: number
  original_text_length: number
  corrected_text_length: number
}

export interface TranscriptCorrectionResult {
  correctedSegments: TranscriptSegment[]
  correctedText: string
  fullText: string
  index: TranscriptCorrectionIndex
  indexJson: string
  rewriteText: string
  strictSegmentsJson: string | null
}

interface StrictBatchPlan {
  index: number
  segments: TranscriptSegment[]
  skipCount: number
}

export class TranscriptCorrectionService {
  constructor(
    private readonly llmClient: Pick<OpenAiCompatibleClient, "generateText">,
  ) {}

  async apply(input: {
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
    promptTemplate: string
    correctionMode: LlmCorrectionMode
    correctionBatchSize: number
    correctionOverlap: number
    apiKey?: string
    baseUrl?: string
    model?: string
    systemPrompt?: string
    llmEnabled?: boolean
  }): Promise<TranscriptCorrectionResult> {
    const transcriptSegments = normalizeSegments(input.transcriptSegments)
    const transcriptText = resolveTranscriptText(transcriptSegments, input.transcriptText)
    const batchSize = clampInteger(input.correctionBatchSize, 24, 6, 80)
    const overlap = clampInteger(input.correctionOverlap, 3, 0, Math.max(0, batchSize - 1))

    if (input.correctionMode === "off") {
      return buildResult({
        mode: "off",
        status: "skipped",
        fallbackUsed: false,
        fallbackReason: "",
        sourceMode: "raw_transcript",
        batchCount: 0,
        batchSize,
        overlap,
        correctedSegments: transcriptSegments,
        correctedText: transcriptText,
        rewriteText: transcriptText,
      })
    }

    const batchPlan = buildBatchPlan(transcriptSegments, batchSize, overlap)
    if (input.correctionMode === "strict") {
      return this.applyStrict({
        ...input,
        correctionMode: "strict",
        transcriptSegments,
        transcriptText,
        batchPlan,
        batchSize,
        overlap,
      })
    }

    return this.applyRewrite({
      ...input,
      correctionMode: "rewrite",
      transcriptSegments,
      transcriptText,
      batchPlan,
      batchSize,
      overlap,
    })
  }

  private async applyStrict(input: {
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
    promptTemplate: string
    correctionMode: "strict"
    correctionBatchSize: number
    correctionOverlap: number
    apiKey?: string
    baseUrl?: string
    model?: string
    systemPrompt?: string
    llmEnabled?: boolean
    batchPlan: StrictBatchPlan[]
    batchSize: number
    overlap: number
  }): Promise<TranscriptCorrectionResult> {
    const correctedSegments: TranscriptSegment[] = []
    const fallbackReasons: string[] = []

    for (const batch of input.batchPlan) {
      const rawResponse = await this.tryGenerateBatch({
        ...input,
        batch,
      })
      const parsedLines = parseCorrectionLines(rawResponse, batch.segments.length)
      const normalizedLines = parsedLines?.map((item) => normalizeChineseText(item))
      const nextSegments = batch.segments.map((segment, index) => ({
        ...segment,
        text: normalizedLines?.[index] || segment.text,
      }))

      if (!normalizedLines) {
        fallbackReasons.push(`batch-${batch.index + 1}: empty_or_invalid_response`)
      }

      correctedSegments.push(...nextSegments.slice(batch.skipCount))
    }

    const correctedText = correctedSegments.map((segment) => segment.text).join("\n").trim()
    return buildResult({
      mode: "strict",
      status: fallbackReasons.length > 0 ? "fallback" : "completed",
      fallbackUsed: fallbackReasons.length > 0,
      fallbackReason: fallbackReasons.join("; "),
      sourceMode: fallbackReasons.length > 0 ? "strict_fallback" : "llm_strict",
      batchCount: input.batchPlan.length,
      batchSize: input.batchSize,
      overlap: input.overlap,
      correctedSegments,
      correctedText,
      rewriteText: correctedText,
    })
  }

  private async applyRewrite(input: {
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
    promptTemplate: string
    correctionMode: "rewrite"
    correctionBatchSize: number
    correctionOverlap: number
    apiKey?: string
    baseUrl?: string
    model?: string
    systemPrompt?: string
    llmEnabled?: boolean
    batchPlan: StrictBatchPlan[]
    batchSize: number
    overlap: number
  }): Promise<TranscriptCorrectionResult> {
    const rewritePieces: string[] = []
    const fallbackReasons: string[] = []

    for (const batch of input.batchPlan) {
      const rawResponse = await this.tryGenerateBatch({
        ...input,
        batch,
      })
      const parsedLines = parseCorrectionLines(rawResponse, batch.segments.length)
      if (!parsedLines) {
        fallbackReasons.push(`batch-${batch.index + 1}: empty_or_invalid_response`)
        rewritePieces.push(...batch.segments.slice(batch.skipCount).map((segment) => segment.text))
        continue
      }
      rewritePieces.push(
        ...parsedLines
          .slice(batch.skipCount)
          .map((item) => normalizeChineseText(item))
          .filter(Boolean),
      )
    }

    const correctedText = rewritePieces.join("\n").trim() || input.transcriptText
    return buildResult({
      mode: "rewrite",
      status: fallbackReasons.length > 0 ? "fallback" : "completed",
      fallbackUsed: fallbackReasons.length > 0,
      fallbackReason: fallbackReasons.join("; "),
      sourceMode: fallbackReasons.length > 0 ? "rewrite_fallback" : "llm_rewrite",
      batchCount: input.batchPlan.length,
      batchSize: input.batchSize,
      overlap: input.overlap,
      correctedSegments: input.transcriptSegments,
      correctedText,
      rewriteText: correctedText,
    })
  }

  private async tryGenerateBatch(input: {
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
    promptTemplate: string
    correctionMode: "strict" | "rewrite"
    correctionBatchSize: number
    correctionOverlap: number
    apiKey?: string
    baseUrl?: string
    model?: string
    systemPrompt?: string
    llmEnabled?: boolean
    batch: StrictBatchPlan
  }): Promise<string> {
    if (input.llmEnabled === false) {
      return ""
    }

    try {
      const response = await this.llmClient.generateText({
        apiKey: String(input.apiKey || ""),
        baseUrl: String(input.baseUrl || ""),
        model: String(input.model || ""),
        systemPrompt:
          input.systemPrompt ||
          (input.correctionMode === "strict"
            ? "你是一名严格的中文转写纠错助手。请逐行返回与输入行数一致的纠错结果。"
            : "你是一名中文转写润色助手。请逐行返回与输入行数一致的重写结果。"),
        timeoutSeconds: 180,
        userPrompt: renderBatchPrompt(input.promptTemplate, input.batch.segments, input.correctionMode),
      })
      return String(response.content || "").trim()
    } catch {
      return ""
    }
  }
}

function buildResult(input: {
  mode: LlmCorrectionMode
  status: "completed" | "fallback" | "skipped"
  fallbackUsed: boolean
  fallbackReason: string
  sourceMode: TranscriptCorrectionIndex["source_mode"]
  batchCount: number
  batchSize: number
  overlap: number
  correctedSegments: TranscriptSegment[]
  correctedText: string
  rewriteText: string
}): TranscriptCorrectionResult {
  const normalizedText = String(input.correctedText || "").trim()
  const index: TranscriptCorrectionIndex = {
    mode: input.mode,
    status: input.status,
    fallback_used: input.fallbackUsed,
    fallback_reason: input.fallbackReason,
    source_mode: input.sourceMode,
    batch_count: input.batchCount,
    batch_size: input.batchSize,
    overlap: input.overlap,
    original_segment_count: input.correctedSegments.length,
    corrected_segment_count: input.correctedSegments.length,
    original_text_length: normalizedText.length,
    corrected_text_length: normalizedText.length,
  }

  return {
    correctedSegments: input.correctedSegments,
    correctedText: normalizedText,
    fullText: normalizedText,
    index,
    indexJson: JSON.stringify(index, null, 2),
    rewriteText: String(input.rewriteText || "").trim(),
    strictSegmentsJson: input.mode === "strict" ? JSON.stringify(input.correctedSegments, null, 2) : null,
  }
}

function buildBatchPlan(segments: TranscriptSegment[], batchSize: number, overlap: number): StrictBatchPlan[] {
  if (segments.length === 0) {
    return [{ index: 0, segments: [], skipCount: 0 }]
  }

  const plan: StrictBatchPlan[] = []
  const step = Math.max(1, batchSize - overlap)
  for (let start = 0; start < segments.length; start += step) {
    const windowSegments = segments.slice(start, start + batchSize)
    if (windowSegments.length === 0) {
      continue
    }
    plan.push({
      index: plan.length,
      segments: windowSegments,
      skipCount: start === 0 ? 0 : Math.min(overlap, windowSegments.length),
    })
    if (start + batchSize >= segments.length) {
      break
    }
  }
  return plan
}

function renderBatchPrompt(template: string, segments: TranscriptSegment[], mode: "strict" | "rewrite"): string {
  const numberedText = segments
    .map((segment, index) => `${index + 1}. [${formatSeconds(segment.start)} - ${formatSeconds(segment.end)}] ${segment.text}`)
    .join("\n")
  const fallback = mode === "strict"
    ? "请逐行纠错并按编号返回，与输入行数保持一致。"
    : "请逐行重写并按编号返回，与输入行数保持一致。"
  const rendered = String(template || "")
    .replaceAll("{text}", numberedText)
    .replaceAll("{context}", numberedText)
    .replaceAll("{query}", "")
    .trim()
  return rendered ? `${rendered}\n\n${fallback}` : `${fallback}\n\n${numberedText}`
}

function parseCorrectionLines(value: string, expectedCount: number): string[] | null {
  const normalized = String(value || "").trim()
  if (!normalized) {
    return null
  }

  try {
    const parsed = JSON.parse(normalized) as unknown
    if (Array.isArray(parsed)) {
      const lines = parsed
        .map((item) => {
          if (typeof item === "string") {
            return item
          }
          if (item && typeof item === "object" && "text" in item) {
            return String((item as { text?: unknown }).text || "")
          }
          return ""
        })
        .map((item) => item.trim())
        .filter(Boolean)
      if (lines.length === expectedCount) {
        return lines
      }
    }
  } catch {
    // fall through
  }

  const lines = normalized
    .split(/\r?\n/u)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[\.\):、])\s*/u, "").trim())
    .filter(Boolean)

  if (lines.length !== expectedCount) {
    return null
  }
  return lines
}

function resolveTranscriptText(segments: TranscriptSegment[], transcriptText: string): string {
  const normalized = String(transcriptText || "").trim()
  if (normalized) {
    return normalized
  }
  return segments.map((segment) => segment.text).join("\n").trim()
}

function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return (segments || [])
    .map((segment) => ({
      ...segment,
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || "").trim(),
    }))
    .filter((segment) => segment.text.length > 0)
}

function normalizeChineseText(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。！？；：])/g, "$1")
    .replace(/([，。！？；：])(?=[^\s])/g, "$1 ")
    .replace(/ {2,}/g, " ")
    .trim()
}

function formatSeconds(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
