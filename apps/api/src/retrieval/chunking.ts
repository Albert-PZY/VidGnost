import type { Chapter, RetrievalChunk, TranscriptParagraph } from "@vidgnost/contracts"

import { estimateTokens } from "../core/text.js"

export interface ChunkBuildInput {
  chapters: Chapter[]
  /** 段落 → 关键帧图注（视觉增强开启时）。 */
  frameNotesByParagraph?: Map<string, string[]>
  paragraphs: TranscriptParagraph[]
}

const TARGET_TOKENS = 320
const OVERLAP_TOKENS = 80

/**
 * 按章节边界切块：章节是结构单元，块不跨章。
 * 视觉增强开启时，块文本会追加对应时间范围内的关键帧图注与屏上文字，
 * 让「画面里写了什么」也能被检索到。
 */
export function buildChunks(input: ChunkBuildInput): RetrievalChunk[] {
  const paragraphIndex = new Map(input.paragraphs.map((paragraph, index) => [paragraph.id, index]))
  const chunks: RetrievalChunk[] = []

  for (const chapter of input.chapters) {
    const paragraphs = chapter.paragraphIds
      .map((id) => input.paragraphs[paragraphIndex.get(id) ?? -1])
      .filter((paragraph): paragraph is TranscriptParagraph => Boolean(paragraph))
    if (paragraphs.length === 0) {
      continue
    }

    let buffer: TranscriptParagraph[] = []
    let tokens = 0

    const flush = () => {
      if (buffer.length === 0) {
        return
      }
      const chunkText = buffer.map((paragraph) => paragraph.text).join(" ")
      const frameNotes = collectFrameNotes(buffer, input.frameNotesByParagraph)
      const text = frameNotes.length > 0 ? `${chunkText}\n\n【画面信息】${frameNotes.join("；")}` : chunkText
      chunks.push({
        id: `ck-${String(chunks.length + 1).padStart(4, "0")}`,
        start: buffer[0].start,
        end: buffer[buffer.length - 1].end,
        text,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        paragraphIds: buffer.map((paragraph) => paragraph.id),
      })
      buffer = []
      tokens = 0
    }

    for (const paragraph of paragraphs) {
      const cost = estimateTokens(paragraph.text)
      if (buffer.length > 0 && tokens + cost > TARGET_TOKENS) {
        const carried = tailByTokens(buffer, OVERLAP_TOKENS)
        flush()
        buffer = [...carried]
        tokens = buffer.reduce((sum, item) => sum + estimateTokens(item.text), 0)
      }
      buffer.push(paragraph)
      tokens += cost
    }
    flush()
  }

  return chunks
}

function collectFrameNotes(
  paragraphs: TranscriptParagraph[],
  frameNotes?: Map<string, string[]>,
): string[] {
  if (!frameNotes) {
    return []
  }
  const notes: string[] = []
  for (const paragraph of paragraphs) {
    for (const note of frameNotes.get(paragraph.id) || []) {
      if (note && !notes.includes(note)) {
        notes.push(note)
      }
    }
  }
  return notes.slice(0, 6)
}

/**
 * 取尾部若干段落作为下一个切块的重叠前缀。
 * 单段落常常大于重叠预算，因此至少保留 1 个段落，否则重叠会退化到不存在。
 */
function tailByTokens(paragraphs: TranscriptParagraph[], budget: number): TranscriptParagraph[] {
  if (paragraphs.length <= 1) {
    return []
  }
  const tail: TranscriptParagraph[] = []
  let tokens = 0
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(paragraphs[index].text)
    if (tail.length > 0 && tokens + cost > budget) {
      break
    }
    tail.unshift(paragraphs[index])
    tokens += cost
    if (tokens >= budget) {
      break
    }
  }
  // 最多回带 2 个段落，避免切块之间过度重复
  return tail.slice(-2)
}

/** 把关键帧按时间投影到最近的段落，作为该段落的画面补充信息。 */
export function mapFramesToParagraphs(input: {
  frames: Array<{ caption?: string; onScreenText?: string; time: number }>
  paragraphs: TranscriptParagraph[]
}): Map<string, string[]> {
  const mapping = new Map<string, string[]>()
  for (const frame of input.frames) {
    const paragraph = input.paragraphs.find((item) => frame.time >= item.start && frame.time <= item.end)
      || nearestParagraph(input.paragraphs, frame.time)
    if (!paragraph) {
      continue
    }
    const note = [frame.caption, frame.onScreenText].filter(Boolean).join("｜")
    if (!note) {
      continue
    }
    const list = mapping.get(paragraph.id) || []
    if (!list.includes(note)) {
      list.push(note)
    }
    mapping.set(paragraph.id, list)
  }
  return mapping
}

function nearestParagraph(paragraphs: TranscriptParagraph[], time: number): TranscriptParagraph | null {
  let best: TranscriptParagraph | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const paragraph of paragraphs) {
    const distance = Math.min(Math.abs(paragraph.start - time), Math.abs(paragraph.end - time))
    if (distance < bestDistance) {
      bestDistance = distance
      best = paragraph
    }
  }
  return bestDistance <= 20 ? best : null
}
