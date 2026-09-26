import type { Chapter, OutlineDoc, TranscriptParagraph } from "@vidgnost/contracts"

import { logger } from "../core/logger.js"
import { clamp01, extractJson, formatTimecode, snippet } from "../core/text.js"
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

export interface RawChapter {
  bullets?: unknown
  gist?: unknown
  startParagraphId?: unknown
  title?: unknown
}

/** 模型既可能返回 `{chapters:[...]}`，也可能直接返回数组，甚至换个键名。 */
export type OutlinePayload = { chapters?: RawChapter[]; items?: RawChapter[]; outline?: RawChapter[] } | RawChapter[]

export function chapterArrayOf(payload: OutlinePayload | null): RawChapter[] {
  if (!payload) {
    return []
  }
  if (Array.isArray(payload)) {
    return payload
  }
  return payload.chapters || payload.items || payload.outline || []
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
        const parsed = extractJson<OutlinePayload>(result.text)
        let accepted = 0
        for (const raw of chapterArrayOf(parsed)) {
          const draft = normalizeChapter(raw, window)
          if (draft) {
            chapterDrafts.push(draft)
            accepted += 1
          }
        }
        if (accepted === 0) {
          // 保留原始响应片段，便于区分「模型返回结构不对」与「返回了不存在的段落编号」。
          log.warn(
            { window: index, windowSize: window.length, head: result.text.slice(0, 300) },
            "outline window produced no usable chapter",
          )
        }
      } catch (error) {
        log.warn({ error: String(error), window: index }, "outline window failed")
      }
    }

    const minimum = Math.max(2, Math.floor(targetChapters / 2))
    let merged = mergeChapterDrafts(chapterDrafts, input.paragraphs)
    let source = "llm.balanced"

    // 完全没有可用章节时，换更强的模型再试一次；仍失败才退化为确定性切分。
    if (merged.length === 0) {
      merged = await this.retryWithStricterGranularity(input, windows, targetChapters, 0)
      source = "llm.quality"
      if (merged.length === 0) {
        log.warn({ paragraphs: input.paragraphs.length, target: targetChapters }, "outline fell back to paragraph chunks")
        return fallbackOutline(input.paragraphs)
      }
    }

    // 章节数明显低于目标时先升级模型重试一次；仍不足则按段落边界确定性拆分。
    if (merged.length < minimum) {
      const retried = await this.retryWithStricterGranularity(input, windows, targetChapters, merged.length)
      const upgraded = retried.length > merged.length
      const best = upgraded ? retried : merged
      if (upgraded) {
        source = "llm.quality"
      }
      const split = splitOverlongChapters(best, input.paragraphs, targetChapters)
      return {
        chapters: split.length > best.length ? split : best,
        generatedBy: split.length > best.length ? `${source}+granularity-split` : `${source}+granularity-retry`,
        createdAt: new Date().toISOString(),
      }
    }

    return { chapters: merged, generatedBy: source, createdAt: new Date().toISOString() }
  }

  /** 用「上一版切得太粗」的显式反馈，换更强的模型再切一次。 */
  private async retryWithStricterGranularity(
    input: { durationSeconds: number; paragraphs: TranscriptParagraph[]; signal?: AbortSignal; title: string },
    windows: TranscriptParagraph[][],
    targetChapters: number,
    produced: number,
  ): Promise<Chapter[]> {
    const drafts: Array<{ bullets: string[]; gist: string; startParagraphId: string; title: string }> = []
    for (const [index, window] of windows.entries()) {
      try {
        const result = await this.gateway.chat("llm.quality", {
          systemPrompt: OUTLINE_SYSTEM_PROMPT,
          userPrompt: [
            `视频标题：${input.title}`,
            `上一次只切出了 ${produced} 个章节，粒度太粗，观众无法按章节跳转。`,
            `视频总时长 ${formatTimecode(input.durationSeconds)}，这次必须切出约 ${targetChapters} 个章节。`,
            `这是第 ${index + 1}/${windows.length} 段转写。`,
            "",
            "转写段落：",
            renderParagraphsForPrompt(window),
            "",
            "请输出 JSON：",
            '{"chapters":[{"startParagraphId":"p0003","title":"章节标题","gist":"一句话概括","bullets":["要点1","要点2"]}]}',
          ].join("\n"),
          responseFormat: { type: "json_object" },
          signal: input.signal,
          maxTokens: 5000,
        })
        const parsed = extractJson<OutlinePayload>(result.text)
        for (const raw of chapterArrayOf(parsed)) {
          const draft = normalizeChapter(raw, window)
          if (draft) {
            drafts.push(draft)
          }
        }
      } catch (error) {
        log.warn({ error: String(error), window: index }, "outline retry window failed")
      }
    }
    return mergeChapterDrafts(drafts, input.paragraphs)
  }
}

/**
 * 确定性拆分：模型始终给出过粗的章节时，把段落最多的章节按段落边界一分为二。
 * 新章节标题取自该半段对应要点，保证信息来自模型已有产出而不是凭空生成。
 */
function splitOverlongChapters(chapters: Chapter[], paragraphs: TranscriptParagraph[], targetChapters: number): Chapter[] {
  let result = [...chapters]
  const paragraphIndex = new Map(paragraphs.map((paragraph, index) => [paragraph.id, index]))
  let guard = 0

  while (result.length < targetChapters && guard < targetChapters * 2) {
    guard += 1
    // 选择段落数最多、且仍有拆分空间的章节
    const candidate = result
      .filter((chapter) => chapter.paragraphIds.length >= 4)
      .sort((a, b) => b.paragraphIds.length - a.paragraphIds.length)[0]
    if (!candidate) {
      break
    }

    const half = Math.floor(candidate.paragraphIds.length / 2)
    const headIds = candidate.paragraphIds.slice(0, half)
    const tailIds = candidate.paragraphIds.slice(half)
    const headPoints = candidate.bullets.slice(0, Math.ceil(candidate.bullets.length / 2))
    const tailPoints = candidate.bullets.slice(Math.ceil(candidate.bullets.length / 2))

    const spanOf = (ids: string[]) => {
      const indices = ids.map((id) => paragraphIndex.get(id) ?? 0)
      const start = paragraphs[Math.min(...indices)]?.start ?? candidate.start
      const end = paragraphs[Math.max(...indices)]?.end ?? candidate.end
      return { start, end }
    }

    const head = { ...candidate, ...spanOf(headIds), paragraphIds: headIds, bullets: headPoints.length > 0 ? headPoints : candidate.bullets.slice(0, 2) }
    const tail = {
      ...candidate,
      id: `${candidate.id}b`,
      ...spanOf(tailIds),
      paragraphIds: tailIds,
      title: tailPoints[0] ? snippet(tailPoints[0], 18) : `${candidate.title}（续）`,
      gist: tailPoints[0] ? snippet(tailPoints[0], 45) : candidate.gist,
      bullets: tailPoints.length > 0 ? tailPoints : candidate.bullets.slice(-2),
    }

    result = result.flatMap((chapter) => (chapter.id === candidate.id ? [head, tail] : [chapter]))
  }

  return result
    .sort((a, b) => a.start - b.start)
    .map((chapter, index) => ({ ...chapter, id: `ch${String(index + 1).padStart(2, "0")}`, index }))
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
  return { chapters, generatedBy: "fallback-paragraph-chunks", createdAt: new Date().toISOString() }
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
