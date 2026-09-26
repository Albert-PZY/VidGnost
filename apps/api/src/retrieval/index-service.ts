import { readFile } from "node:fs/promises"
import path from "node:path"

import type { RetrievalChunk, RetrievalHit, RetrievalTrace } from "@vidgnost/contracts"

import { AppError, describeError } from "../core/errors.js"
import { readJsonFile, writeJsonFile, writeTextFile } from "../core/fs.js"
import { logger } from "../core/logger.js"
import type { ModelGateway } from "../providers/gateway.js"
import { buildBm25Index, searchBm25, type Bm25IndexDoc } from "./bm25.js"
import type { ChunkContext } from "./contextualizer.js"

const log = logger.child({ scope: "retrieval" })

export interface IndexSnapshot {
  bm25: Bm25IndexDoc
  chunkMap: Map<string, RetrievalChunk>
  contexts: Record<string, ChunkContext>
  dimensions: number
  model: string
  vectors: Float32Array
  vectorOrder: string[]
}

interface IndexManifest {
  version: 1
  chunks: RetrievalChunk[]
  contexts: Record<string, ChunkContext>
  createdAt: string
  dimensions: number
  model: string
  vectorFile: string
  vectorOrder: string[]
}

const CHUNKS_FILE = "index/chunks.json"
const VECTORS_FILE = "index/vectors.bin"

export class RetrievalIndexService {
  constructor(private readonly gateway: ModelGateway) {}

  /** 构建索引：embedding 输入为「上下文前缀 + 正文」。 */
  async build(input: {
    chunks: RetrievalChunk[]
    contexts: Map<string, ChunkContext>
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
    taskDir: string
  }): Promise<{ dimensions: number; model: string; chunkCount: number }> {
    if (input.chunks.length === 0) {
      throw AppError.conflict("没有可索引的切块。", { code: "INDEX_NO_CHUNKS" })
    }

    const contexts: Record<string, ChunkContext> = {}
    const embeddingInputs = input.chunks.map((chunk) => {
      const context = input.contexts.get(chunk.id) || { context: "", questions: [] }
      contexts[chunk.id] = context
      return composeEmbeddingText(chunk, context)
    })

    const { vectors, dimensions, model } = await this.gateway.embed({
      inputs: embeddingInputs,
      signal: input.signal,
    })
    input.onProgress?.(input.chunks.length, input.chunks.length)

    const normalized = vectors.map((vector) => normalizeVector(vector))
    const flattened = new Float32Array(normalized.length * dimensions)
    normalized.forEach((vector, index) => {
      flattened.set(vector, index * dimensions)
    })

    const manifest: IndexManifest = {
      version: 1,
      chunks: input.chunks,
      contexts,
      createdAt: new Date().toISOString(),
      dimensions,
      model,
      vectorFile: path.basename(VECTORS_FILE),
      vectorOrder: input.chunks.map((chunk) => chunk.id),
    }

    await writeJsonFile(path.join(input.taskDir, CHUNKS_FILE), manifest)
    await writeTextFile(path.join(input.taskDir, VECTORS_FILE), Buffer.from(flattened.buffer).toString("base64"))

    // BM25 同时索引正文、上下文前缀与问题变体
    const bm25 = buildBm25Index(
      input.chunks.map((chunk) => {
        const context = contexts[chunk.id]
        return {
          id: chunk.id,
          text: chunk.text,
          extras: context ? [context.context, ...context.questions] : [],
        }
      }),
    )
    await writeJsonFile(path.join(input.taskDir, "index/bm25.json"), bm25)

    return { dimensions, model, chunkCount: input.chunks.length }
  }

  async load(taskDir: string): Promise<IndexSnapshot | null> {
    const manifest = await readJsonFile<IndexManifest>(path.join(taskDir, CHUNKS_FILE))
    if (!manifest) {
      return null
    }
    const bm25 = await readJsonFile<Bm25IndexDoc>(path.join(taskDir, "index/bm25.json"))
    if (!bm25) {
      return null
    }
    const vectorBase64 = await readFile(path.join(taskDir, VECTORS_FILE), "utf8").catch(() => "")
    if (!vectorBase64.trim()) {
      return null
    }
    const buffer = Buffer.from(vectorBase64.trim(), "base64")
    const vectors = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))

    return {
      bm25,
      chunkMap: new Map(manifest.chunks.map((chunk) => [chunk.id, chunk])),
      contexts: manifest.contexts || {},
      dimensions: manifest.dimensions,
      model: manifest.model,
      vectors,
      vectorOrder: manifest.vectorOrder,
    }
  }

  /** 混合检索：向量 top-40 + BM25 top-40 → RRF(k=60) → rerank 前 30 → top-K。 */
  async search(input: {
    query: string
    signal?: AbortSignal
    snapshot: IndexSnapshot
    /** 传入时跳过向量召回（用于纯关键词场景）。 */
    topK?: number
  }): Promise<{ hits: RetrievalHit[]; trace: RetrievalTrace }> {
    const started = Date.now()
    const topK = input.topK ?? 8
    const candidateLimit = 40
    const subQueries = [input.query]

    const bm25Hits = searchBm25(input.snapshot.bm25, input.query, candidateLimit)
    let vectorHits: Array<{ id: string; score: number }> = []
    let embeddingModel = input.snapshot.model
    let degradation: string | undefined

    try {
      const embedded = await this.gateway.embed({ inputs: [input.query], signal: input.signal })
      embeddingModel = embedded.model
      const queryVector = normalizeVector(embedded.vectors[0] || [])
      vectorHits = this.searchVectors(input.snapshot, queryVector, candidateLimit)
    } catch (error) {
      degradation = `向量召回失败，仅使用 BM25：${describeError(error)}`
      log.warn({ error: describeError(error) }, "vector recall failed")
    }

    const fused = fuseRrf([
      { source: "bm25", items: bm25Hits },
      { source: "vector", items: vectorHits },
    ])

    const candidateIds = fused.slice(0, 30).map((item) => item.id)
    const documents = candidateIds.map((id) => {
      const chunk = input.snapshot.chunkMap.get(id)
      const context = input.snapshot.contexts[id]
      return chunk ? composeEmbeddingText(chunk, context) : id
    })

    let rerankScores = new Map<string, number>()
    let rerankModel = ""
    if (documents.length > 0) {
      const reranked = await this.gateway.rerank({
        query: input.query,
        documents,
        topN: documents.length,
        signal: input.signal,
      })
      rerankModel = reranked.model
      degradation = degradation || reranked.degradation
      for (const item of reranked.results) {
        const id = candidateIds[item.index]
        if (id) {
          rerankScores.set(id, item.score)
        }
      }
    }

    const finalOrder = candidateIds
      .map((id) => ({ id, score: rerankScores.get(id) }))
      .sort((a, b) => {
        if (a.score === undefined && b.score === undefined) {
          return 0
        }
        if (a.score === undefined) {
          return 1
        }
        if (b.score === undefined) {
          return -1
        }
        return b.score - a.score
      })
      .slice(0, topK)

    const fusedMap = new Map(fused.map((item) => [item.id, item]))
    const hits: RetrievalHit[] = []
    for (const item of finalOrder) {
      const chunk = input.snapshot.chunkMap.get(item.id)
      if (!chunk) {
        continue
      }
      const fusedEntry = fusedMap.get(item.id)
      const source: RetrievalHit["source"] = item.score === undefined ? "bm25" : "rerank"
      hits.push({
        chunkId: chunk.id,
        source,
        scores: {
          ...(fusedEntry?.bm25 === undefined ? {} : { bm25: fusedEntry.bm25 }),
          ...(fusedEntry?.vector === undefined ? {} : { vector: fusedEntry.vector }),
          ...(fusedEntry?.rrf === undefined ? {} : { rrf: fusedEntry.rrf }),
          ...(item.score === undefined ? {} : { rerank: item.score }),
        },
        text: chunk.text,
        start: chunk.start,
        end: chunk.end,
        ...(chunk.chapterTitle ? { chapterTitle: chunk.chapterTitle } : {}),
      })
    }

    return {
      hits,
      trace: {
        question: input.query,
        subQueries,
        candidateCounts: {
          bm25: bm25Hits.length,
          vector: vectorHits.length,
          fused: fused.length,
          reranked: rerankScores.size,
        },
        hits,
        ...(rerankModel ? { rerankModel } : {}),
        embeddingModel,
        latencyMs: Date.now() - started,
        ...(degradation ? { degradation } : {}),
      },
    }
  }

  private searchVectors(snapshot: IndexSnapshot, queryVector: Float32Array | number[], limit: number): Array<{ id: string; score: number }> {
    const { dimensions, vectors, vectorOrder } = snapshot
    if (dimensions <= 0 || vectors.length === 0 || queryVector.length !== dimensions) {
      return []
    }
    const scores: Array<{ id: string; score: number }> = []
    for (let index = 0; index < vectorOrder.length; index += 1) {
      const offset = index * dimensions
      let dot = 0
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        dot += vectors[offset + dimension] * queryVector[dimension]
      }
      scores.push({ id: vectorOrder[index], score: dot })
    }
    return scores.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}

/** 组合 embedding / rerank 的输入文本：上下文前缀 + 正文。 */
export function composeEmbeddingText(chunk: RetrievalChunk, context?: ChunkContext): string {
  const parts: string[] = []
  if (chunk.chapterTitle) {
    parts.push(`章节：${chunk.chapterTitle}`)
  }
  if (context?.context) {
    parts.push(context.context)
  }
  parts.push(chunk.text)
  return parts.join("\n")
}

/** Reciprocal Rank Fusion。 */
export function fuseRrf(
  channels: Array<{ source: "bm25" | "vector"; items: Array<{ id: string; score: number }> }>,
  k = 60,
): Array<{ bm25?: number; id: string; rrf: number; vector?: number }> {
  const merged = new Map<string, { bm25?: number; id: string; rrf: number; vector?: number }>()
  for (const channel of channels) {
    channel.items.forEach((item, rank) => {
      const entry = merged.get(item.id) || { id: item.id, rrf: 0 }
      entry.rrf += 1 / (k + rank + 1)
      if (channel.source === "bm25") {
        entry.bm25 = item.score
      } else {
        entry.vector = item.score
      }
      merged.set(item.id, entry)
    })
  }
  return [...merged.values()].sort((a, b) => b.rrf - a.rrf)
}

function normalizeVector(vector: number[]): Float32Array {
  const output = new Float32Array(vector.length)
  let norm = 0
  for (const value of vector) {
    norm += value * value
  }
  norm = Math.sqrt(norm) || 1
  for (let index = 0; index < vector.length; index += 1) {
    output[index] = vector[index] / norm
  }
  return output
}
