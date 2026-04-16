import type { TranscriptSegment } from "@vidgnost/contracts"

import { EmbeddingRuntimeService, tokenizeText } from "./embedding-runtime-service.js"
import { RerankRuntimeService, scoreLexicalMatch } from "./rerank-runtime-service.js"

const RETRIEVAL_INDEX_VERSION = 2

export interface RetrievalIndexItem {
  doc_id: string
  task_id: string
  task_title: string
  source: string
  source_set: string[]
  start: number
  end: number
  text: string
  terms: string[]
  vector: number[]
}

export interface RetrievalIndexPayload {
  version: 2
  retrieval_mode: "vector-index"
  item_count: number
  items: RetrievalIndexItem[]
}

export interface RetrievalSearchHit extends RetrievalIndexItem {
  final_score: number
  lexical_score: number
  rerank_score: number
  vector_score: number
}

export class RetrievalIndexService {
  constructor(
    private readonly embeddingRuntimeService = new EmbeddingRuntimeService(),
    private readonly rerankRuntimeService = new RerankRuntimeService(),
  ) {}

  buildIndex(input: {
    taskId: string
    taskTitle: string
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
  }): RetrievalIndexPayload & { indexJson: string } {
    const normalizedSegments = normalizeSegments(input.transcriptSegments, input.transcriptText)
    return buildIndexPayload(normalizedSegments, input.taskId, input.taskTitle, (text) =>
      this.embeddingRuntimeService.embedText(text),
    )
  }

  async buildIndexAsync(input: {
    taskId: string
    taskTitle: string
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
  }): Promise<RetrievalIndexPayload & { indexJson: string }> {
    const normalizedSegments = normalizeSegments(input.transcriptSegments, input.transcriptText)
    const items: RetrievalIndexItem[] = []
    for (let index = 0; index < normalizedSegments.length; index += 1) {
      const segment = normalizedSegments[index]
      items.push(
        createIndexItem({
          taskId: input.taskId,
          taskTitle: input.taskTitle,
          segment,
          embedText: (text) => this.embeddingRuntimeService.embedText(text),
        }),
      )
      if ((index + 1) % 16 === 0) {
        await yieldToEventLoop()
      }
    }
    return toIndexPayload(items)
  }

  parseIndex(raw: string): RetrievalIndexPayload | null {
    try {
      const parsed = JSON.parse(String(raw || "")) as RetrievalIndexPayload
      if (!parsed || Number(parsed.version) !== RETRIEVAL_INDEX_VERSION || !Array.isArray(parsed.items)) {
        return null
      }
      return {
        version: RETRIEVAL_INDEX_VERSION,
        retrieval_mode: "vector-index",
        item_count: parsed.items.length,
        items: parsed.items
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            ...item,
            source_set: Array.isArray(item.source_set) ? item.source_set : ["transcript"],
            terms: Array.isArray(item.terms)
              ? item.terms.map((value) => String(value || "").trim()).filter(Boolean)
              : tokenizeText(String(item.text || "")),
            vector: Array.isArray(item.vector) ? item.vector.map((value) => Number(value) || 0) : [],
          })),
      }
    } catch {
      return null
    }
  }

  searchIndex(input: {
    index: RetrievalIndexPayload
    queryText: string
    topK: number
    rerankTopN: number
  }): {
    initialHits: RetrievalSearchHit[]
    rerankedHits: RetrievalSearchHit[]
    retrievalMode: "vector-index"
  } {
    const queryVector = this.embeddingRuntimeService.embedText(input.queryText)
    const queryTerms = tokenizeText(input.queryText)
    const normalizedQuery = String(input.queryText || "").trim()
    const initialHits = input.index.items
      .map((item) => ({
        ...item,
        lexical_score: scoreLexicalMatch(queryTerms, normalizedQuery, item.terms, item.text),
        rerank_score: 0,
        vector_score: this.embeddingRuntimeService.cosineSimilarity(queryVector, item.vector),
        final_score: 0,
      }))
      .map((item) => ({
        ...item,
        final_score: roundScore((item.vector_score * 0.68) + (Math.min(1.35, item.lexical_score) * 0.32)),
      }))
      .filter((item) => item.final_score > 0)
      .sort((left, right) => {
        if (right.final_score !== left.final_score) {
          return right.final_score - left.final_score
        }
        if (right.lexical_score !== left.lexical_score) {
          return right.lexical_score - left.lexical_score
        }
        return right.vector_score - left.vector_score
      })
      .slice(0, Math.max(1, input.topK))

    const rerankedHits = this.rerankRuntimeService
      .rerank(input.queryText, initialHits, input.rerankTopN)
      .map((item) => ({
        ...item,
        final_score: item.rerank_score,
      }))

    return {
      initialHits,
      rerankedHits,
      retrievalMode: "vector-index",
    }
  }
}

function buildIndexPayload(
  segments: TranscriptSegment[],
  taskId: string,
  taskTitle: string,
  embedText: (text: string) => number[],
): RetrievalIndexPayload & { indexJson: string } {
  return toIndexPayload(
    segments.map((segment) =>
      createIndexItem({
        taskId,
        taskTitle,
        segment,
        embedText,
      }),
    ),
  )
}

function createIndexItem(input: {
  taskId: string
  taskTitle: string
  segment: TranscriptSegment
  embedText: (text: string) => number[]
}): RetrievalIndexItem {
  return {
    doc_id: `${input.taskId}:${input.segment.start.toFixed(2)}:${input.segment.end.toFixed(2)}:transcript`,
    task_id: input.taskId,
    task_title: input.taskTitle,
    source: "transcript",
    source_set: ["transcript"],
    start: input.segment.start,
    end: input.segment.end,
    text: input.segment.text,
    terms: tokenizeText(input.segment.text),
    vector: input.embedText(input.segment.text),
  }
}

function toIndexPayload(items: RetrievalIndexItem[]): RetrievalIndexPayload & { indexJson: string } {
  const payload: RetrievalIndexPayload = {
    version: RETRIEVAL_INDEX_VERSION,
    retrieval_mode: "vector-index",
    item_count: items.length,
    items,
  }

  return {
    ...payload,
    indexJson: JSON.stringify(payload, null, 2),
  }
}

function normalizeSegments(segments: TranscriptSegment[], transcriptText: string): TranscriptSegment[] {
  const normalized = (segments || [])
    .map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || "").trim(),
    }))
    .filter((segment) => segment.text.length > 0)

  if (normalized.length > 0) {
    return expandRetrievalWindows(normalized)
  }

  const text = String(transcriptText || "").trim()
  if (!text) {
    return []
  }
  return [
    {
      start: 0,
      end: 0,
      text,
    },
  ]
}

function expandRetrievalWindows(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length < 2) {
    return segments
  }

  const expanded = [...segments]
  const seen = new Set(segments.map((segment) => `${segment.start}:${segment.end}:${segment.text}`))

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    const window = segments.slice(startIndex, startIndex + 5)
    if (window.length < 2) {
      continue
    }

    const merged = {
      start: window[0].start,
      end: window[window.length - 1].end,
      text: window.map((segment) => segment.text).join(" "),
    }
    const key = `${merged.start}:${merged.end}:${merged.text}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    expanded.push(merged)
  }

  return expanded
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000
}
