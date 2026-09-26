import type { Chapter, Highlight, SummaryDoc, TranscriptParagraph } from "@vidgnost/contracts"

import { logger } from "../core/logger.js"
import { extractJson, formatTimecode } from "../core/text.js"
import type { ModelGateway } from "../providers/gateway.js"

const log = logger.child({ scope: "summary" })

const MAP_SYSTEM_PROMPT = [
  "你是视频内容编辑。你会收到一个章节的转写要点，请把它压缩成高质量的中文笔记条目。",
  "要求：",
  "1. 每条都是一个可独立阅读的事实或结论，杜绝「本节课」「视频里」这类空泛表达。",
  "2. 保留专有名词、数字、版本号、命令与代码标识符的原始写法。",
  "3. 每条必须给出该内容在原片中的起始时间码（mm:ss）。",
  "4. 只输出 JSON。",
].join("\n")

const REDUCE_SYSTEM_PROMPT = [
  "你是资深内容分析师。你会收到整段视频的分章笔记，请生成一份可交付的全局摘要。",
  "要求：",
  "1. tldr 是一段 120-200 字的总览，说清「这段视频解决了什么问题、给出什么结论」。",
  "2. highlights 必须给出 6-9 条，为整个数组里最重要的信息（不得返回空数组）；每条含 `text`（完整短句）与 `start`（该内容在原片中的秒数，整数）、可选 chapterId。",
  "3. actions 是观众可以直接执行的行动项（没有就返回空数组）。",
  "4. questions 是视频没有回答但值得追问的问题（2-4 条）。",
  "5. glossary 必须给出 5-10 条，从视频里出现的专有名词、产品名、模型名、方法名、协议名中挑选，",
  "   每条格式固定为 {\"term\":\"术语原名\",\"explanation\":\"一句话解释它在本文语境中的含义\"}；不要留空数组。",
  "6. tags 是 3-6 个中文标签；audience 用一句话说明目标观众。",
  "7. 只输出 JSON，键名固定为 tldr/highlights/actions/questions/glossary/tags/audience。",
].join("\n")

export interface SummaryInput {
  chapters: Chapter[]
  durationSeconds: number
  paragraphs: TranscriptParagraph[]
  preset: "fast" | "balanced" | "deep"
  signal?: AbortSignal
  title: string
}

export class SummaryService {
  constructor(private readonly gateway: ModelGateway) {}

  /* ------------------------------------------------------------- 章节笔记 */

  /** Map 阶段：为每个章节产出带时间码的要点，同时供摘要与检索索引复用。 */
  async mapChapters(input: {
    chapters: Chapter[]
    onProgress?: (done: number, total: number) => void
    paragraphs: TranscriptParagraph[]
    signal?: AbortSignal
    title: string
  }): Promise<Map<string, Array<{ start: number; text: string }>>> {
    const paragraphIndex = new Map(input.paragraphs.map((paragraph) => [paragraph.id, paragraph]))
    const results = new Map<string, Array<{ start: number; text: string }>>()
    const total = input.chapters.length

    for (const [index, chapter] of input.chapters.entries()) {
      const body = chapter.paragraphIds
        .map((id) => paragraphIndex.get(id))
        .filter((paragraph): paragraph is TranscriptParagraph => Boolean(paragraph))
        .map((paragraph) => `[${formatTimecode(paragraph.start)}] ${paragraph.text}`)
        .join("\n")

      try {
        const result = await this.gateway.chat("llm.fast", {
          systemPrompt: MAP_SYSTEM_PROMPT,
          userPrompt: [
            `视频标题：${input.title}`,
            `章节：${chapter.title}（${formatTimecode(chapter.start)} - ${formatTimecode(chapter.end)}）`,
            "",
            "章节转写：",
            body,
            "",
            "输出 JSON：",
            '{"points":[{"start":123,"text":"要点"}]}',
          ].join("\n"),
          responseFormat: { type: "json_object" },
          signal: input.signal,
          maxTokens: 2500,
        })
        const parsed = extractJson<{ points?: Array<{ start?: unknown; text?: unknown }> }>(result.text)
        const points = (parsed?.points || [])
          .map((point) => ({
            start: clampTime(Number(point.start), chapter.start, chapter.end),
            text: String(point.text || "").trim(),
          }))
          .filter((point) => point.text.length > 4)
        if (points.length > 0) {
          results.set(chapter.id, points)
        }
      } catch (error) {
        log.warn({ chapter: chapter.id, error: String(error) }, "chapter map failed")
      }
      input.onProgress?.(index + 1, total)
    }

    return results
  }

  /* ------------------------------------------------------------- 全局归并 */

  async reduce(input: SummaryInput & { chapterNotes: Map<string, Array<{ start: number; text: string }>> }): Promise<SummaryDoc> {
    const payload = input.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      time: formatTimecode(chapter.start),
      start: Math.round(chapter.start),
      gist: chapter.gist,
      points: (input.chapterNotes.get(chapter.id) || chapter.bullets.map((text) => ({ text, start: chapter.start }))).map(
        (point) => `${formatTimecode(point.start)} ${point.text}`,
      ),
    }))

    const role = input.preset === "deep" ? "llm.reasoning" : payload.length > 16 ? "llm.bulk" : "llm.quality"
    const result = await this.gateway.chat(role, {
      systemPrompt: REDUCE_SYSTEM_PROMPT,
      userPrompt: [
        `视频标题：${input.title}`,
        `视频时长：${formatTimecode(input.durationSeconds)}`,
        `章节数：${input.chapters.length}`,
        "",
        "分章笔记：",
        JSON.stringify(payload, null, 1),
        "",
        "请输出全局摘要 JSON。",
      ].join("\n"),
      responseFormat: { type: "json_object" },
      signal: input.signal,
      maxTokens: 6000,
    })

    const parsed = extractJson<Partial<SummaryDoc> & { highlights?: Array<Partial<Highlight>> }>(result.text)
    const doc = normalizeSummary(parsed, input.title)
    // 模型偶尔会返回空 highlights；此时用章节要点确定性补齐，保证摘要不出现空区块。
    const highlights = doc.highlights.length > 0 ? doc.highlights : deriveHighlights(input.chapters, input.chapterNotes)
    return {
      ...doc,
      highlights,
      generatedBy: `${role}${doc.highlights.length === 0 ? "+chapter-notes-fallback" : ""}`,
      createdAt: new Date().toISOString(),
    }
  }
}

/** 从章节要点中挑选覆盖面最广的若干条，作为 highlights 的确定性回退。 */
function deriveHighlights(
  chapters: Chapter[],
  chapterNotes: Map<string, Array<{ start: number; text: string }>>,
): Highlight[] {
  const picked: Highlight[] = []
  const perChapter = Math.max(1, Math.ceil(8 / Math.max(1, chapters.length)))
  for (const chapter of chapters) {
    const points = chapterNotes.get(chapter.id) || chapter.bullets.map((text) => ({ text, start: chapter.start }))
    for (const point of points.slice(0, perChapter)) {
      picked.push({ text: point.text, start: Math.round(point.start), chapterId: chapter.id })
      if (picked.length >= 9) {
        return picked
      }
    }
  }
  return picked
}

function normalizeSummary(raw: (Partial<SummaryDoc> & { highlights?: Array<Partial<Highlight>> }) | null, title: string): SummaryDoc {
  const tldr = String(raw?.tldr || "").trim() || `《${title}》的摘要生成失败，请重试。`
  const highlights: Highlight[] = Array.isArray(raw?.highlights)
    ? raw.highlights
        .map((item) => ({
          text: String(item?.text || "").trim(),
          ...(Number.isFinite(Number(item?.start)) ? { start: Math.max(0, Math.round(Number(item?.start))) } : {}),
          ...(item?.chapterId ? { chapterId: String(item.chapterId) } : {}),
        }))
        .filter((item) => item.text.length > 3)
    : []

  return {
    tldr,
    highlights,
    actions: toStringArray(raw?.actions).slice(0, 8),
    questions: toStringArray(raw?.questions).slice(0, 6),
    glossary: Array.isArray(raw?.glossary)
      ? (raw.glossary as unknown as Array<Record<string, unknown>>)
          .map((item) => ({
            term: firstNonEmpty(item?.term, item?.name, item?.word),
            explanation: firstNonEmpty(item?.explanation, item?.definition, item?.meaning, item?.description, item?.desc),
          }))
          .filter((item) => item.term && item.explanation)
          .slice(0, 12)
      : [],
    tags: toStringArray(raw?.tags).slice(0, 6),
    audience: String(raw?.audience || "").trim(),
    generatedBy: "unknown",
    createdAt: new Date().toISOString(),
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []
}

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return ""
}

function clampTime(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return Math.round(min)
  }
  return Math.round(Math.max(min, Math.min(max, value)))
}

/* ------------------------------------------------------------- Markdown 笔记 */

/**
 * 把结构化产物渲染成 Markdown 笔记。
 * 同一份 Markdown 同时服务：笔记正文、大纲、思维导图（markmap 兼容的标题层级）。
 */
export function renderMarkdownNotes(input: {
  chapters: Chapter[]
  chapterNotes: Map<string, Array<{ start: number; text: string }>>
  summary: SummaryDoc
  title: string
}): string {
  const lines: string[] = [`# ${input.title}`, ""]

  lines.push("## 总览", "", input.summary.tldr, "")

  if (input.summary.highlights.length > 0) {
    lines.push("## 核心结论", "")
    for (const highlight of input.summary.highlights) {
      const stamp = highlight.start === undefined ? "" : ` \`[${formatTimecode(highlight.start)}]\``
      lines.push(`- ${highlight.text}${stamp}`)
    }
    lines.push("")
  }

  if (input.summary.actions.length > 0) {
    lines.push("## 行动项", "")
    for (const action of input.summary.actions) {
      lines.push(`- [ ] ${action}`)
    }
    lines.push("")
  }

  if (input.summary.glossary.length > 0) {
    lines.push("## 术语表", "")
    for (const entry of input.summary.glossary) {
      lines.push(`- **${entry.term}**：${entry.explanation}`)
    }
    lines.push("")
  }

  if (input.chapters.length > 0) {
    lines.push("## 章节笔记", "")
    for (const chapter of input.chapters) {
      lines.push(`### ${chapter.title} \`[${formatTimecode(chapter.start)}]\``, "")
      if (chapter.gist) {
        lines.push(chapter.gist, "")
      }
      const points = input.chapterNotes.get(chapter.id) || chapter.bullets.map((text) => ({ text, start: chapter.start }))
      for (const point of points) {
        lines.push(`- \`[${formatTimecode(point.start)}]\` ${point.text}`)
      }
      lines.push("")
    }
  }

  if (input.summary.questions.length > 0) {
    lines.push("## 遗留疑问", "")
    for (const question of input.summary.questions) {
      lines.push(`- ${question}`)
    }
    lines.push("")
  }

  if (input.summary.tags.length > 0) {
    lines.push(`> 标签：${input.summary.tags.map((tag) => `#${tag}`).join(" ")}`)
    lines.push("")
  }

  return lines.join("\n").trimEnd() + "\n"
}
