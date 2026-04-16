import type { TranscriptSegment } from "@vidgnost/contracts"

import { EmbeddingRuntimeService } from "./embedding-runtime-service.js"
import { RerankRuntimeService } from "./rerank-runtime-service.js"

export interface RetrievalIndexItem {
  doc_id: string
  task_id: string
  task_title: string
  source: string
  source_set: string[]
  start: number
  end: number
  text: string
  image_path: string
  vector: number[]
}

export interface RetrievalIndexPayload {
  version: 1
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
      if (!parsed || !Array.isArray(parsed.items)) {
        return null
      }
      return {
        version: 1,
        retrieval_mode: "vector-index",
        item_count: parsed.items.length,
        items: parsed.items
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            ...item,
            source_set: Array.isArray(item.source_set) ? item.source_set : ["transcript"],
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
    const initialHits = input.index.items
      .map((item) => ({
        ...item,
        final_score: 0,
        lexical_score: 0,
        rerank_score: 0,
        vector_score: this.embeddingRuntimeService.cosineSimilarity(queryVector, item.vector),
      }))
      .filter((item) => item.vector_score > 0)
      .sort((left, right) => right.vector_score - left.vector_score)
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
    image_path: "",
    vector: input.embedText(input.segment.text),
  }
}

function toIndexPayload(items: RetrievalIndexItem[]): RetrievalIndexPayload & { indexJson: string } {
  const payload: RetrievalIndexPayload = {
    version: 1,
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
    return normalized
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

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}
