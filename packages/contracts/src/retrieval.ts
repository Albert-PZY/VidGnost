import type { IsoDateTime } from "./common.js"

/** 检索块：语义段落切分后的最小检索单元。 */
export interface RetrievalChunk {
  id: string
  start: number
  end: number
  text: string
  chapterId?: string
  chapterTitle?: string
  paragraphIds: string[]
  /** 关键帧引用（多模态增强开启时）。 */
  frameIds?: string[]
}

export interface ChunkIndexDoc {
  chunks: RetrievalChunk[]
  model: string
  dimensions: number
  createdAt: IsoDateTime
  /** 向量以 base64 float32 存储，与 chunks 顺序一致。 */
  vectorFile: string
}

/** 单路召回命中。 */
export interface RetrievalHit {
  chunkId: string
  /** 召回来源。 */
  source: "bm25" | "vector" | "rerank"
  /** 各阶段分数，便于 Trace 展示。 */
  scores: {
    bm25?: number
    vector?: number
    rrf?: number
    rerank?: number
  }
  text: string
  start: number
  end: number
  chapterTitle?: string
}

export interface RetrievalTrace {
  question: string
  /** 查询改写后的子查询。 */
  subQueries: string[]
  /** 每路召回的候选数量。 */
  candidateCounts: { bm25: number; vector: number; fused: number; reranked: number }
  hits: RetrievalHit[]
  rerankModel?: string
  embeddingModel: string
  latencyMs: number
  /** 降级说明（例如 rerank 不可用时）。 */
  degradation?: string
}

export interface Citation {
  /** 1-based，对应答案中的 `[n]`。 */
  index: number
  chunkId: string
  start: number
  end: number
  /** 引用原文片段。 */
  quote: string
  chapterTitle?: string
  score: number
}

export interface AskTurn {
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  createdAt: IsoDateTime
}

export interface AskAnswer {
  id: string
  question: string
  answer: string
  citations: Citation[]
  model: string
  trace: RetrievalTrace
  createdAt: IsoDateTime
}

/* ------------------------------------------------------------ SSE 事件协议 */

export type AskStreamEvent =
  | { type: "trace"; trace: RetrievalTrace }
  | { type: "delta"; text: string }
  | { type: "answer"; answer: AskAnswer }
  | { type: "error"; message: string }
