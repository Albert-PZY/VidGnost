import type { ParagraphDoc, TranscriptDoc, TranscriptParagraph, TranscriptSegment } from "@vidgnost/contracts"

import { estimateTokens, formatTimecode } from "../core/text.js"

export interface SegmenterOptions {
  /** 目标段落 token 上限。 */
  maxTokens?: number
  /** 达到该停顿（秒）时强制断开。 */
  pauseSeconds?: number
  /** 段落最小 token 数，低于此值尽量与相邻段合并。 */
  minTokens?: number
}

const END_PUNCTUATION = /[。！？!?；;…]$/

/**
 * 语义分段（确定性，不依赖模型）：
 * 以 ASR 句级时间戳为输入，按「停顿长度 + 目标 token 预算 + 句末标点」归并成可阅读的段落。
 * 结构层优先于语义层：ASR 的句边界本身就是最强的结构信号。
 */
export function segmentTranscript(transcript: TranscriptDoc, options: SegmenterOptions = {}): ParagraphDoc {
  const maxTokens = options.maxTokens ?? 220
  const pauseSeconds = options.pauseSeconds ?? 1.1
  const minTokens = options.minTokens ?? 40

  const paragraphs: TranscriptParagraph[] = []
  let buffer: TranscriptSegment[] = []
  let bufferTokens = 0

  const flush = () => {
    if (buffer.length === 0) {
      return
    }
    const text = buffer.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim()
    if (!text) {
      buffer = []
      bufferTokens = 0
      return
    }
    paragraphs.push({
      id: `p${String(paragraphs.length + 1).padStart(4, "0")}`,
      start: buffer[0].start,
      end: buffer[buffer.length - 1].end,
      text,
      segmentIds: buffer.map((segment) => segment.id),
    })
    buffer = []
    bufferTokens = 0
  }

  for (const segment of transcript.segments) {
    const previous = buffer[buffer.length - 1]
    const gap = previous ? segment.start - previous.end : 0
    const segmentTokens = estimateTokens(segment.text)
    const wouldExceed = bufferTokens + segmentTokens > maxTokens
    const strongPause = previous !== undefined && gap >= pauseSeconds
    const endedSentence = previous !== undefined && END_PUNCTUATION.test(previous.text)

    if (buffer.length > 0 && (wouldExceed || strongPause || (gap >= 0.6 && endedSentence && bufferTokens >= minTokens))) {
      flush()
    }

    buffer.push(segment)
    bufferTokens += segmentTokens
  }
  flush()

  return { paragraphs: mergeTinyParagraphs(paragraphs, minTokens), generatedBy: "heuristic-segmenter" }
}

function mergeTinyParagraphs(paragraphs: TranscriptParagraph[], minTokens: number): TranscriptParagraph[] {
  const output: TranscriptParagraph[] = []
  for (const paragraph of paragraphs) {
    const previous = output[output.length - 1]
    if (previous && estimateTokens(paragraph.text) < minTokens && estimateTokens(previous.text) < 160) {
      previous.text = `${previous.text} ${paragraph.text}`.replace(/\s+/g, " ").trim()
      previous.end = paragraph.end
      previous.segmentIds.push(...paragraph.segmentIds)
      continue
    }
    output.push({ ...paragraph, segmentIds: [...paragraph.segmentIds] })
  }
  return output.map((paragraph, index) => ({ ...paragraph, id: `p${String(index + 1).padStart(4, "0")}` }))
}

/** 把段落渲染成带时间码的编号列表，供模型做章节切分与抽点。 */
export function renderParagraphsForPrompt(paragraphs: TranscriptParagraph[], options: { includeTime?: boolean } = {}): string {
  return paragraphs
    .map((paragraph) => {
      const stamp = options.includeTime === false ? "" : ` [${formatTimecode(paragraph.start)}-${formatTimecode(paragraph.end)}]`
      return `${paragraph.id}${stamp} ${paragraph.text}`
    })
    .join("\n")
}

/** 在 token 预算内把段落切成若干窗口，窗口之间保留少量重叠段落以维持上下文。 */
export function windowParagraphs(
  paragraphs: TranscriptParagraph[],
  options: { overlap?: number; tokenBudget?: number } = {},
): TranscriptParagraph[][] {
  const tokenBudget = options.tokenBudget ?? 3500
  const overlap = options.overlap ?? 2
  if (paragraphs.length === 0) {
    return []
  }

  const windows: TranscriptParagraph[][] = []
  let current: TranscriptParagraph[] = []
  let tokens = 0

  for (const paragraph of paragraphs) {
    const cost = estimateTokens(paragraph.text) + 12
    if (current.length > 0 && tokens + cost > tokenBudget) {
      windows.push(current)
      current = overlap > 0 ? current.slice(-overlap) : []
      tokens = current.reduce((sum, item) => sum + estimateTokens(item.text) + 12, 0)
    }
    current.push(paragraph)
    tokens += cost
  }
  if (current.length > 0) {
    windows.push(current)
  }
  return windows
}
