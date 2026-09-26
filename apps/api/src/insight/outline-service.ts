import type { Chapter, OutlineDoc, TranscriptParagraph } from "@vidgnost/contracts"

import { logger } from "../core/logger.js"
import { clamp01, extractJson, formatTimecode } from "../core/text.js"
import type { ModelGateway } from "../providers/gateway.js"
import { renderParagraphsForPrompt, windowParagraphs } from "./segmenter.js"

const log = logger.child({ scope: "outline" })

const OUTLINE_SYSTEM_PROMPT = [
  "你是一名视频内容结构分析师。你会收到带编号与时间码的转写段落，任务是切分章节。",
  "规则：",
  "1. 章节粒度由视频时长决定：必须把整段视频切成接近目标数量的章节，宁细勿粗。",
  "2. 只在话题真正切换处切章节，不要为了凑数把同一话题拆开；也不要让单章覆盖超过四分之一的转写段落。",
  "3. startParagraphId 必须是输入中真实存在的编号，并且严格递增。",
  "4. 每个章节给出简洁有力的标题（不超过 18 个字）、一句话 gist（不超过 45 个字）、3-5 条 bullets。",
  "5. bullets 用完整短句概括该章的事实，不要复述原文，不要出现「本段」「视频中提到」这类空话。",
  "6. 只输出 JSON，不要任何解释文字。",
].join("\n")

interface RawChapter {
  bullets?: unknown
  gist?: unknown
  startParagraphId?: unknown
  title?: unknown
}

export class OutlineService {
  constructor(private readonly gateway: ModelGateway) {}

  async build(input: {
    durationSeconds: number
    paragraphs: TranscriptParagraph[]
    signal?: AbortSignal
    title: string
  }): Promise<OutlineDoc> {
    if (input.paragraphs.length === 0) {
      return { chapters: [], generatedBy: "none", createdAt: new Date().toISOString() }
    }

    // 章节目标数由时长决定：约每 60-90 秒一章，并受段落数量约束。
    const byDuration = Math.round(input.durationSeconds / 70)
    const targetChapters = Math.max(2, Math.min(14, Math.max(byDuration, Math.ceil(input.paragraphs.length / 6))))

    const windows = windowParagraphs(input.paragraphs, { tokenBudget: 3200, overlap: 2 })
    const chapterDrafts: Array<{ bullets: string[]; gist: string; startParagraphId: string; title: string }> = []

    for (const [index, window] of windows.entries()) {
      // 每个窗口只承担它覆盖段落对应的章节配额，避免总章数失控。
      const share = Math.max(1, Math.round((window.length / input.paragraphs.length) * targetChapters))
      const prompt = [
        `视频标题：${input.title}`,
        `视频总时长：${formatTimecode(input.durationSeconds)}，全文应切成约 ${targetChapters} 个章节。`,
        `这是第 ${index + 1}/${windows.length} 段转写（含少量与上一段的重叠，用于保持上下文），本段贡献约 ${share} 个章节。`,
        "",
        "转写段落：",
        renderParagraphsForPrompt(window),
        "",
        "请输出 JSON：",
        '{"chapters":[{"startParagraphId":"p0003","title":"章节标题","gist":"一句话概括","bullets":["要点1","要点2","要点3"]}]}',
      ].join("\n")

      try {
        const result = await this.gateway.chat("llm.balanced", {
          systemPrompt: OUTLINE_SYSTEM_PROMPT,
          userPrompt: prompt,
          responseFormat: { type: "json_object" },
          signal: input.signal,
          maxTokens: 5000,
        })
        const parsed = extractJson<{ chapters?: RawChapter[] }>(result.text)
        for (const raw of parsed?.chapters || []) {
          const draft = normalizeChapter(raw, window)
          if (draft) {
            chapterDrafts.push(draft)
          }
        }
      } catch (error) {
        log.warn({ error: String(error), window: index }, "outline window failed")
      }
    }

    const merged = mergeChapterDrafts(chapterDrafts, input.paragraphs)
    if (merged.length === 0) {
      return fallbackOutline(input.paragraphs)
    }
    return { chapters: merged, generatedBy: "llm.balanced", createdAt: new Date().toISOString() }
  }
}

function normalizeChapter(
  raw: RawChapter,
  window: TranscriptParagraph[],
): { bullets: string[]; gist: string; startParagraphId: string; title: string } | null {
  const title = String(raw.title || "").trim()
  const startParagraphId = String(raw.startParagraphId || "").trim()
  if (!title || !window.some((paragraph) => paragraph.id === startParagraphId)) {
    return null
  }
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
    : []
  return {
    title: title.slice(0, 40),
    gist: String(raw.gist || "").trim().slice(0, 120),
    startParagraphId,
    bullets,
  }
}

function mergeChapterDrafts(
  drafts: Array<{ bullets: string[]; gist: string; startParagraphId: string; title: string }>,
  paragraphs: TranscriptParagraph[],
): Chapter[] {
  const indexOf = new Map(paragraphs.map((paragraph, index) => [paragraph.id, index]))
  const ordered = drafts
    .filter((draft) => indexOf.has(draft.startParagraphId))
    .sort((a, b) => (indexOf.get(a.startParagraphId) || 0) - (indexOf.get(b.startParagraphId) || 0))

  const deduped: typeof ordered = []
  for (const draft of ordered) {
    const previous = deduped[deduped.length - 1]
    if (previous && previous.startParagraphId === draft.startParagraphId) {
      // 重叠窗口造成的重复章节：保留信息更完整的一条
      if (draft.bullets.length > previous.bullets.length) {
        deduped[deduped.length - 1] = draft
      }
      continue
    }
    deduped.push(draft)
  }

  if (deduped.length > 0) {
    const firstIndex = indexOf.get(deduped[0].startParagraphId) || 0
    if (firstIndex > 0) {
      deduped[0] = { ...deduped[0], startParagraphId: paragraphs[0].id }
    }
  }

  return deduped.map((draft, index) => {
    const startIndex = indexOf.get(draft.startParagraphId) || 0
    const endIndex = deduped[index + 1] ? (indexOf.get(deduped[index + 1].startParagraphId) || 0) - 1 : paragraphs.length - 1
    const safeEnd = Math.max(startIndex, Math.min(endIndex, paragraphs.length - 1))
    const slice = paragraphs.slice(startIndex, safeEnd + 1)
    return {
      id: `ch${String(index + 1).padStart(2, "0")}`,
      index,
      title: draft.title,
      gist: draft.gist || slice[0]?.text.slice(0, 60) || "",
      start: slice[0]?.start ?? 0,
      end: slice[slice.length - 1]?.end ?? 0,
      paragraphIds: slice.map((paragraph) => paragraph.id),
      bullets: draft.bullets,
    } satisfies Chapter
  })
}

/** 模型不可用时的确定性兜底：按固定时长切章。 */
function fallbackOutline(paragraphs: TranscriptParagraph[]): OutlineDoc {
  const targetChapters = Math.max(2, Math.min(8, Math.round(paragraphs.length / 8) || 2))
  const perChapter = Math.ceil(paragraphs.length / targetChapters)
  const chapters: Chapter[] = []
  for (let index = 0; index < paragraphs.length; index += perChapter) {
    const slice = paragraphs.slice(index, index + perChapter)
    const chapterIndex = chapters.length
    chapters.push({
      id: `ch${String(chapterIndex + 1).padStart(2, "0")}`,
      index: chapterIndex,
      title: `${formatTimecode(slice[0].start)} 起的片段`,
      gist: slice[0].text.slice(0, 60),
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      paragraphIds: slice.map((paragraph) => paragraph.id),
      bullets: slice.slice(0, 3).map((paragraph) => paragraph.text.slice(0, 60)),
    })
  }
  return { chapters, generatedBy: "fallback-timeout-chunks", createdAt: new Date().toISOString() }
}

export function chapterAt(chapters: Chapter[], time: number): Chapter | null {
  return chapters.find((chapter) => time >= chapter.start && time <= chapter.end) || null
}

export function chapterRelativeWeight(chapter: Chapter, durationSeconds: number): number {
  if (durationSeconds <= 0) {
    return 0
  }
  return clamp01((chapter.end - chapter.start) / durationSeconds)
}
