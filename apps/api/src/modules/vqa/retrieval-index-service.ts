import type { TranscriptSegment } from "@vidgnost/contracts"

import { EmbeddingRuntimeService, tokenizeImageSemanticText, tokenizeText } from "./embedding-runtime-service.js"
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
  image_path?: string
  visual_text?: string
  frame_index?: number
  frame_timestamp?: number
  citation_type?: "transcript" | "image"
  image_evidence?: {
    frame_path?: string
    frame_uri?: string
    frame_index?: number
    frame_timestamp?: number
  }
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

export interface FrameSemanticSegment {
  start: number
  end: number
  text: string
  image_path?: string
  visual_text?: string
  frame_index?: number
  frame_timestamp?: number
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
    frameSemanticSegments?: FrameSemanticSegment[]
  }): RetrievalIndexPayload & { indexJson: string } {
    const normalizedSegments = normalizeSegments(input.transcriptSegments, input.transcriptText)
    const normalizedFrameSemanticSegments = normalizeFrameSemanticSegments(input.frameSemanticSegments || [])
    return buildIndexPayload(
      normalizedSegments,
      normalizedFrameSemanticSegments,
      input.taskId,
      input.taskTitle,
      (text) => this.embeddingRuntimeService.embedText(text),
      (text) => this.embeddingRuntimeService.embedImageSemantic(text),
    )
  }

  async buildIndexAsync(input: {
    taskId: string
    taskTitle: string
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
    frameSemanticSegments?: FrameSemanticSegment[]
  }): Promise<RetrievalIndexPayload & { indexJson: string }> {
    const transcriptItems = await this.buildTranscriptItemsAsync({
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      transcriptSegments: input.transcriptSegments,
      transcriptText: input.transcriptText,
    })
    const frameSemanticItems = await this.buildFrameSemanticItemsAsync({
      taskId: input.taskId,
      taskTitle: input.taskTitle,
      frameSemanticSegments: input.frameSemanticSegments || [],
    })
    return this.buildIndexFromItems([...transcriptItems, ...frameSemanticItems])
  }

  async buildTranscriptItemsAsync(input: {
    taskId: string
    taskTitle: string
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
  }): Promise<RetrievalIndexItem[]> {
    const normalizedSegments = normalizeSegments(input.transcriptSegments, input.transcriptText)
    const items: RetrievalIndexItem[] = []
    for (let index = 0; index < normalizedSegments.length; index += 1) {
      const segment = normalizedSegments[index]
      items.push(createTranscriptIndexItem({
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        segment,
        embedText: (text) => this.embeddingRuntimeService.embedText(text),
      }))
      if ((index + 1) % 16 === 0) {
        await yieldToEventLoop()
      }
    }
    return items
  }

  async buildFrameSemanticItemsAsync(input: {
    taskId: string
    taskTitle: string
    frameSemanticSegments: FrameSemanticSegment[]
  }): Promise<RetrievalIndexItem[]> {
    const normalizedFrameSemanticSegments = normalizeFrameSemanticSegments(input.frameSemanticSegments)
    const items: RetrievalIndexItem[] = []
    for (let index = 0; index < normalizedFrameSemanticSegments.length; index += 1) {
      const segment = normalizedFrameSemanticSegments[index]
      items.push(createFrameSemanticIndexItem({
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        segment,
        embedImageSemantic: (text) => this.embeddingRuntimeService.embedImageSemantic(text),
      }))
      if ((index + 1) % 16 === 0) {
        await yieldToEventLoop()
      }
    }
    return items
  }

  buildIndexFromItems(items: RetrievalIndexItem[]): RetrievalIndexPayload & { indexJson: string } {
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
            source_set: resolveSourceSet(item.source, item.source_set),
            terms: Array.isArray(item.terms)
              ? item.terms.map((value) => String(value || "").trim()).filter(Boolean)
              : resolveDefaultTerms(item.source, String(item.text || "")),
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
    textHits: RetrievalSearchHit[]
    imageHits: RetrievalSearchHit[]
    fusedHits: RetrievalSearchHit[]
    initialHits: RetrievalSearchHit[]
    rerankedHits: RetrievalSearchHit[]
    retrievalMode: "vector-index"
  } {
    const queryTerms = tokenizeText(input.queryText)
    const normalizedQuery = String(input.queryText || "").trim()
    const queryVectorText = this.embeddingRuntimeService.embedText(input.queryText)
    const queryVectorImage = this.embeddingRuntimeService.embedImageSemantic(input.queryText)
    const textCandidates = input.index.items.filter((item) => isSource(item, "transcript"))
    const imageCandidates = input.index.items.filter((item) => isSource(item, "frame_semantic"))

    const textHits = scoreRecallCandidates(textCandidates, {
      queryTerms,
      normalizedQuery,
      queryVector: queryVectorText,
      embeddingRuntimeService: this.embeddingRuntimeService,
      vectorWeight: 0.68,
      lexicalWeight: 0.32,
    })
    const imageHits = scoreRecallCandidates(imageCandidates, {
      queryTerms,
      normalizedQuery,
      queryVector: queryVectorImage,
      embeddingRuntimeService: this.embeddingRuntimeService,
      vectorWeight: 0.72,
      lexicalWeight: 0.28,
    })

    const branchTopK = Math.min(
      input.index.items.length,
      Math.max(6, Math.ceil(Math.max(1, input.topK) * 2)),
    )
    const fusedHits = dedupeCandidatesByDocId([
      ...textHits.slice(0, branchTopK),
      ...imageHits.slice(0, branchTopK),
    ])

    const initialHits = fusedHits
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
      textHits,
      imageHits,
      fusedHits,
      initialHits,
      rerankedHits,
      retrievalMode: "vector-index",
    }
  }
}

function buildIndexPayload(
  transcriptSegments: TranscriptSegment[],
  frameSemanticSegments: FrameSemanticSegment[],
  taskId: string,
  taskTitle: string,
  embedText: (text: string) => number[],
  embedImageSemantic: (text: string) => number[],
): RetrievalIndexPayload & { indexJson: string } {
  const items: RetrievalIndexItem[] = []
  for (const segment of transcriptSegments) {
    items.push(createTranscriptIndexItem({
      taskId,
      taskTitle,
      segment,
      embedText,
    }))
  }
  for (const segment of frameSemanticSegments) {
    items.push(createFrameSemanticIndexItem({
      taskId,
      taskTitle,
      segment,
      embedImageSemantic,
    }))
  }
  return toIndexPayload(items)
}

function createTranscriptIndexItem(input: {
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

function createFrameSemanticIndexItem(input: {
  taskId: string
  taskTitle: string
  segment: FrameSemanticSegment
  embedImageSemantic: (text: string) => number[]
}): RetrievalIndexItem {
  const frameSemanticText = String(input.segment.visual_text || input.segment.text || "").trim()
  const normalizedImagePath = String(input.segment.image_path || "").trim()
  const frameTimestamp = Number(input.segment.frame_timestamp)
  const normalizedFrameTimestamp = Number.isFinite(frameTimestamp) ? frameTimestamp : input.segment.start
  const frameIndex = Number(input.segment.frame_index)
  const normalizedFrameIndex = Number.isInteger(frameIndex) && frameIndex >= 0 ? frameIndex : undefined
  return {
    doc_id: `${input.taskId}:${input.segment.start.toFixed(2)}:${input.segment.end.toFixed(2)}:frame_semantic`,
    task_id: input.taskId,
    task_title: input.taskTitle,
    source: "frame_semantic",
    source_set: ["frame_semantic"],
    start: input.segment.start,
    end: input.segment.end,
    text: frameSemanticText,
    terms: tokenizeImageSemanticText(frameSemanticText),
    vector: input.embedImageSemantic(frameSemanticText),
    image_path: normalizedImagePath || undefined,
    visual_text: frameSemanticText,
    frame_index: normalizedFrameIndex,
    frame_timestamp: normalizedFrameTimestamp,
    citation_type: "image",
    image_evidence: {
      frame_path: normalizedImagePath || undefined,
      frame_index: normalizedFrameIndex,
      frame_timestamp: normalizedFrameTimestamp,
    },
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

function normalizeFrameSemanticSegments(segments: FrameSemanticSegment[]): FrameSemanticSegment[] {
  return (segments || [])
    .map((segment) => ({
      start: Number(segment.start) || 0,
      end: Number(segment.end) || 0,
      text: String(segment.text || "").trim(),
      image_path: String(segment.image_path || "").trim(),
      visual_text: String(segment.visual_text || "").trim(),
      frame_index: Number.isInteger(Number(segment.frame_index)) ? Number(segment.frame_index) : undefined,
      frame_timestamp: Number.isFinite(Number(segment.frame_timestamp)) ? Number(segment.frame_timestamp) : undefined,
    }))
    .filter((segment) => Boolean(segment.text || segment.visual_text))
}

function resolveDefaultTerms(source: string | undefined, text: string): string[] {
  if (String(source || "").trim() === "frame_semantic") {
    return tokenizeImageSemanticText(text)
  }
  return tokenizeText(text)
}

function resolveSourceSet(source: string | undefined, sourceSet: unknown): string[] {
  if (Array.isArray(sourceSet)) {
    const normalized = sourceSet.map((item) => String(item || "").trim()).filter(Boolean)
    if (normalized.length > 0) {
      return normalized
    }
  }
  if (String(source || "").trim() === "frame_semantic") {
    return ["frame_semantic"]
  }
  return ["transcript"]
}

function isSource(item: RetrievalIndexItem, source: "transcript" | "frame_semantic"): boolean {
  if (item.source === source) {
    return true
  }
  return item.source_set.includes(source)
}

function scoreRecallCandidates(
  items: RetrievalIndexItem[],
  input: {
    queryTerms: string[]
    normalizedQuery: string
    queryVector: number[]
    embeddingRuntimeService: EmbeddingRuntimeService
    vectorWeight: number
    lexicalWeight: number
  },
): RetrievalSearchHit[] {
  return items
    .map((item) => ({
      ...item,
      lexical_score: scoreLexicalMatch(input.queryTerms, input.normalizedQuery, item.terms, item.text),
      rerank_score: 0,
      vector_score: input.embeddingRuntimeService.cosineSimilarity(input.queryVector, item.vector),
      final_score: 0,
    }))
    .map((item) => ({
      ...item,
      final_score: roundScore((item.vector_score * input.vectorWeight) + (Math.min(1.35, item.lexical_score) * input.lexicalWeight)),
    }))
    .filter((item) => item.final_score > 0)
}

function dedupeCandidatesByDocId(items: RetrievalSearchHit[]): RetrievalSearchHit[] {
  const map = new Map<string, RetrievalSearchHit>()
  for (const item of items) {
    const current = map.get(item.doc_id)
    if (!current || item.final_score > current.final_score) {
      map.set(item.doc_id, item)
    }
  }
  return [...map.values()]
}
