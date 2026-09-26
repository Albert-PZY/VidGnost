import type {
  AskAnswer,
  AskStreamEvent,
  Chapter,
  Citation,
  RetrievalHit,
  RetrievalTrace,
  SummaryDoc,
} from "@vidgnost/contracts"

import { logger } from "../core/logger.js"
import { formatTimecode, parseTimecode, snippet } from "../core/text.js"
import type { ModelGateway } from "../providers/gateway.js"
import { RetrievalIndexService, type IndexSnapshot } from "./index-service.js"

const log = logger.child({ scope: "qa" })

const GLOBAL_INTENT_PATTERN =
  /(整体|全局|通篇|整个视频|全片|这门|这个视频|这段视频|主要讲|讲了什么|在讲什么|核心主题|主线|总结一下|串起来|overall|summary of)/i

const ANSWER_SYSTEM_PROMPT = [
  "你是视频内容助理。你只会基于给定的证据片段回答用户问题。",
  "",
  "输出格式：",
  "1. 第一句直接给出结论，不要复述问题，不要写「根据证据」「以上片段」这类元叙述。",
  "2. 需要展开时用短横线列表，每条不超过两行。",
  "3. 每一条事实后面必须紧跟形如 [mm:ss] 的引用标记，时间码取自证据片段开头标注的时间区间。",
  "",
  "内容约束：",
  "- 允许基于证据做归纳、对比与因果推断，但不得引入证据之外的事实、数字、名称或结论。",
  "- 只有当所有证据都与问题无关时，才用一句话说明无法回答，并指出视频里可能相关的位置。",
  "- 除非确实无法回答，不要输出「片段有限」「需要更多信息」这类免责说明。",
].join("\n")

export interface AskInput {
  chapters: Chapter[]
  chapterNotes?: Map<string, Array<{ start: number; text: string }>>
  history?: Array<{ role: "user" | "assistant"; content: string }>
  question: string
  signal?: AbortSignal
  snapshot: IndexSnapshot | null
  summary?: SummaryDoc | null
  title: string
  topK?: number
  videoDuration: number
}

export class QaService {
  private readonly indexService: RetrievalIndexService

  constructor(private readonly gateway: ModelGateway) {
    this.indexService = new RetrievalIndexService(gateway)
  }

  /**
   * 流式问答。事件顺序：trace → delta* → answer。引用在流结束后统一校验。
   */
  async *ask(input: AskInput): AsyncGenerator<AskStreamEvent, void, unknown> {
    const isGlobal = GLOBAL_INTENT_PATTERN.test(input.question)
    let trace: RetrievalTrace
    let evidence: Array<{ chapterTitle?: string; end: number; id: string; start: number; text: string }>

    if (isGlobal || !input.snapshot) {
      const routed = this.buildGlobalEvidence(input)
      evidence = routed.evidence
      trace = routed.trace
    } else {
      const result = await this.indexService.search({
        query: input.question,
        snapshot: input.snapshot,
        topK: input.topK,
        signal: input.signal,
      })
      evidence = result.hits.map((hit) => ({
        id: hit.chunkId,
        start: hit.start,
        end: hit.end,
        text: hit.text,
        ...(hit.chapterTitle ? { chapterTitle: hit.chapterTitle } : {}),
      }))
      trace = result.trace
    }

    yield { type: "trace", trace }

    if (evidence.length === 0) {
      const answer: AskAnswer = {
        id: `ans-${Date.now().toString(36)}`,
        question: input.question,
        answer: "这个视频还没有生成可检索的索引，或者索引里没有匹配内容。请先完成处理，或换一种问法。",
        citations: [],
        model: "none",
        trace,
        createdAt: new Date().toISOString(),
      }
      yield { type: "answer", answer }
      return
    }

    const userPrompt = [
      `视频标题：${input.title}`,
      `视频时长：${formatTimecode(input.videoDuration)}`,
      "",
      "证据片段：",
      evidence
        .map(
          (item, index) =>
            `[${index + 1}] ${formatTimecode(item.start)}-${formatTimecode(item.end)}${
              item.chapterTitle ? ` （${item.chapterTitle}）` : ""
            }\n${snippet(item.text, 1200)}`,
        )
        .join("\n\n"),
      "",
      input.history && input.history.length > 0
        ? `对话历史（仅供理解指代）：\n${input.history
            .slice(-4)
            .map((turn) => `${turn.role === "user" ? "用户" : "助理"}：${snippet(turn.content, 300)}`)
            .join("\n")}`
        : "",
      "",
      `用户问题：${input.question}`,
      "",
      "请回答，并在每条事实后附上形如 [mm:ss] 的引用。",
    ]
      .filter(Boolean)
      .join("\n")

    const role = isGlobal ? "llm.quality" : "llm.fast"
    let answerText = ""
    let model = role

    try {
      for await (const delta of this.gateway.chatStream(role, {
        systemPrompt: ANSWER_SYSTEM_PROMPT,
        userPrompt,
        signal: input.signal,
        maxTokens: 4000,
        temperature: 0.25,
      })) {
        answerText += delta
        yield { type: "delta", text: delta }
      }
    } catch (error) {
      log.warn({ error: String(error) }, "answer stream failed")
      if (!answerText) {
        yield { type: "error", message: "生成回答失败，请检查模型配置后重试。" }
        return
      }
    }

    const { citations, answer } = attachCitations(answerText, evidence, input.videoDuration, trace.hits)
    const finalAnswer: AskAnswer = {
      id: `ans-${Date.now().toString(36)}`,
      question: input.question,
      answer,
      citations,
      model,
      trace,
      createdAt: new Date().toISOString(),
    }
    model = finalAnswer.model
    yield { type: "answer", answer: finalAnswer }
  }

  /** 全局问题：走章节摘要 map-reduce，用章节笔记作为证据。 */
  private buildGlobalEvidence(input: AskInput): {
    evidence: Array<{ chapterTitle?: string; end: number; id: string; start: number; text: string }>
    trace: RetrievalTrace
  } {
    const evidence = input.chapters.map((chapter) => {
      const points = input.chapterNotes?.get(chapter.id) || chapter.bullets.map((text) => ({ text, start: chapter.start }))
      return {
        id: chapter.id,
        start: chapter.start,
        end: chapter.end,
        chapterTitle: chapter.title,
        text: [
          `${chapter.title}：${chapter.gist}`,
          ...points.map((point) => `- [${formatTimecode(point.start)}] ${point.text}`),
        ].join("\n"),
      }
    })

    const trace: RetrievalTrace = {
      question: input.question,
      subQueries: [input.question],
      candidateCounts: {
        bm25: 0,
        vector: 0,
        fused: evidence.length,
        reranked: 0,
      },
      hits: evidence.map((item) => ({
        chunkId: item.id,
        source: "bm25",
        scores: {},
        text: item.text,
        start: item.start,
        end: item.end,
        ...(item.chapterTitle ? { chapterTitle: item.chapterTitle } : {}),
      })),
      embeddingModel: input.snapshot?.model || "chapter-map-reduce",
      latencyMs: 0,
      degradation: "全局意图问题走章节摘要路由（query-focused summarization），不使用片段 top-k 检索。",
    }

    return { evidence, trace }
  }
}

function emptyTrace(question: string): RetrievalTrace {
  return {
    question,
    subQueries: [question],
    candidateCounts: { bm25: 0, vector: 0, fused: 0, reranked: 0 },
    hits: [],
    embeddingModel: "unknown",
    latencyMs: 0,
  }
}

/**
 * 引用校验：把答案中的 `[mm:ss]` 映射到具体证据片段。
 * 模型给出的时间码可能与片段起点略有偏差，用容差匹配到最近的证据。
 */
export function attachCitations(
  answer: string,
  evidence: Array<{ chapterTitle?: string; end: number; id: string; start: number; text: string }>,
  videoDuration: number,
  hits: RetrievalHit[],
): { answer: string; citations: Citation[] } {
  const citations: Citation[] = []
  const matchToCitation = (seconds: number): Citation | null => {
    const tolerance = 12
    let best: (typeof evidence)[number] | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const item of evidence) {
      if (seconds >= item.start - tolerance && seconds <= item.end + tolerance) {
        const distance = Math.abs(seconds - item.start)
        if (distance < bestDistance) {
          bestDistance = distance
          best = item
        }
      }
    }
    if (!best) {
      return null
    }
    const existing = citations.find((citation) => citation.chunkId === best?.id)
    if (existing) {
      return existing
    }
    const hit = hits.find((item) => item.chunkId === best?.id)
    const citation: Citation = {
      index: citations.length + 1,
      chunkId: best.id,
      start: Number(best.start.toFixed(2)),
      end: Number(best.end.toFixed(2)),
      quote: snippet(best.text, 220),
      ...(best.chapterTitle ? { chapterTitle: best.chapterTitle } : {}),
      score: hit?.scores.rerank ?? hit?.scores.rrf ?? 0,
    }
    citations.push(citation)
    return citation
  }

  const normalized = answer.replace(/\[(\d{1,3}):([0-5]?\d)\]/g, (raw, minutes: string, seconds: string) => {
    const total = Number(minutes) * 60 + Number(seconds)
    const citation = matchToCitation(Math.min(total, videoDuration))
    if (!citation) {
      return raw
    }
    return `[^${citation.index}]`
  })

  // 兜底：模型完全没给引用时，至少挂上第一条证据，避免回答无出处
  if (citations.length === 0 && evidence.length > 0) {
    const fallback = evidence[0]
    citations.push({
      index: 1,
      chunkId: fallback.id,
      start: Number(fallback.start.toFixed(2)),
      end: Number(fallback.end.toFixed(2)),
      quote: snippet(fallback.text, 220),
      ...(fallback.chapterTitle ? { chapterTitle: fallback.chapterTitle } : {}),
      score: 0,
    })
  }

  return { answer: normalized.trim(), citations }
}

export function parseCitationTimecodes(text: string): number[] {
  const times: number[] = []
  const pattern = /\[(\d{1,3}):([0-5]?\d)\]/g
  let match = pattern.exec(text)
  while (match) {
    times.push(Number(match[1]) * 60 + Number(match[2]))
    match = pattern.exec(text)
  }
  return times
}

export { parseTimecode }
