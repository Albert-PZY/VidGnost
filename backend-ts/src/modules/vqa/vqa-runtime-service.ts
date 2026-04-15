import path from "node:path"

import type {
  TaskDetailResponse,
  TaskListResponse,
  VqaCitationItem,
  VqaChatStreamEvent,
  VqaTraceResponse,
} from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import type { TaskRepository } from "../tasks/task-repository.js"
import { VqaTraceStore } from "./trace-store.js"

interface RetrievalHit extends VqaCitationItem {
  dense_score: number
  final_score: number
  rrf_score: number
  sparse_score: number
}

interface SearchBundle {
  dense_hits: RetrievalHit[]
  query_text: string
  rerank_hits: RetrievalHit[]
  rrf_hits: RetrievalHit[]
  sparse_hits: RetrievalHit[]
  trace_id: string
}

interface ChatBundle {
  answer: string
  citations: VqaCitationItem[]
  context_tokens_approx: number
  error: { code: string; message: string } | null
}

interface AnalyzeBundle {
  chat: ChatBundle
  search: SearchBundle
}

interface EvidenceCandidate {
  end: number
  source: string
  source_set: string[]
  start: number
  task_id: string
  task_title: string
  text: string
}

const RRF_K = 60

export class VqaRuntimeService {
  private readonly traceStore: VqaTraceStore

  constructor(
    private readonly taskRepository: TaskRepository,
    traceLogDir: string,
  ) {
    this.traceStore = new VqaTraceStore(traceLogDir)
  }

  async search(input: {
    queryText: string
    taskId?: string | null
    topK?: number | null
    videoPaths?: string[]
  }): Promise<SearchBundle> {
    const queryText = resolveQueryText(input.queryText)
    const topK = clampTopK(input.topK)
    const tasks = await this.resolveTasks({
      taskId: input.taskId,
      videoPaths: input.videoPaths || [],
    })
    const candidates = collectCandidates(tasks)
    if (candidates.length === 0) {
      throw AppError.conflict("当前任务还没有可用于问答的转写证据。", {
        code: "VQA_TASK_NOT_READY",
        hint: "请先等待任务完成转写，再执行视频问答。",
      })
    }

    const queryTokens = tokenize(queryText)
    const scored = candidates
      .map((candidate, index) => ({
        candidate,
        dense_score: scoreDense(queryText, candidate.text, queryTokens),
        index,
        sparse_score: scoreSparse(queryText, candidate.text, queryTokens),
      }))
      .filter((item) => item.dense_score > 0 || item.sparse_score > 0)

    if (scored.length === 0) {
      const traceId = this.traceStore.newTrace({
        metadata: {
          query_text: queryText,
          task_id: input.taskId || null,
          video_paths: input.videoPaths || [],
          top_k: topK,
        },
        configSnapshot: {
          retrieval: {
            mode: "hybrid-heuristic",
            rrf: true,
            rerank: true,
            query_expansion: false,
            dedupe: "segment-doc-id",
            rerank_top_n: topK,
          },
        },
      })
      const emptyBundle: SearchBundle = {
        trace_id: traceId,
        query_text: queryText,
        dense_hits: [],
        sparse_hits: [],
        rrf_hits: [],
        rerank_hits: [],
      }
      await this.traceStore.write(traceId, "retrieval", {
        query_text: queryText,
        task_id: input.taskId || null,
        video_paths: input.videoPaths || [],
        top_k: topK,
        query_expansion: false,
        dedupe: "segment-doc-id",
        dense_hits: [],
        sparse_hits: [],
        rrf_hits: [],
        rerank_hits: [],
      })
      return emptyBundle
    }

    const denseRank = rankBy(scored, "dense_score")
    const sparseRank = rankBy(scored, "sparse_score")
    const enriched = scored.map((item) => {
      const denseRankIndex = denseRank.get(item.index) || 9999
      const sparseRankIndex = sparseRank.get(item.index) || 9999
      const rrfScore = roundScore((1 / (RRF_K + denseRankIndex)) + (1 / (RRF_K + sparseRankIndex)))
      const finalScore = roundScore(rrfScore + item.dense_score * 0.35 + item.sparse_score * 0.35)
      return {
        ...item,
        final_score: finalScore,
        rrf_score: rrfScore,
      }
    })

    const denseHits = enriched
      .filter((item) => item.dense_score > 0)
      .sort((left, right) => right.dense_score - left.dense_score)
      .slice(0, topK)
      .map((item) => toHit(item))
    const sparseHits = enriched
      .filter((item) => item.sparse_score > 0)
      .sort((left, right) => right.sparse_score - left.sparse_score)
      .slice(0, topK)
      .map((item) => toHit(item))
    const rrfHits = enriched
      .sort((left, right) => right.rrf_score - left.rrf_score)
      .slice(0, topK)
      .map((item) => toHit(item))
    const rerankHits = enriched
      .sort((left, right) => right.final_score - left.final_score)
      .slice(0, topK)
      .map((item) => toHit(item))

    const traceId = this.traceStore.newTrace({
      metadata: {
        query_text: queryText,
        task_id: input.taskId || null,
        video_paths: input.videoPaths || [],
        top_k: topK,
      },
      configSnapshot: {
        retrieval: {
          mode: "hybrid-heuristic",
          rrf: true,
          rerank: true,
          query_expansion: false,
          dedupe: "segment-doc-id",
          rerank_top_n: topK,
        },
      },
    })
    await this.traceStore.write(traceId, "retrieval", {
      query_text: queryText,
      task_id: input.taskId || null,
      video_paths: input.videoPaths || [],
      top_k: topK,
      query_expansion: false,
      dedupe: "segment-doc-id",
      dense_hits: denseHits,
      sparse_hits: sparseHits,
      rrf_hits: rrfHits,
      rerank_hits: rerankHits,
    })

    return {
      trace_id: traceId,
      query_text: queryText,
      dense_hits: denseHits,
      sparse_hits: sparseHits,
      rrf_hits: rrfHits,
      rerank_hits: rerankHits,
    }
  }

  async analyze(input: {
    queryText: string
    taskId?: string | null
    topK?: number | null
    videoPaths?: string[]
  }): Promise<AnalyzeBundle> {
    const search = await this.search(input)
    const chat = buildChatBundle(search.query_text, search.rerank_hits)
    await this.traceStore.write(search.trace_id, "llm_stream", {
      answer_preview: chat.answer.slice(0, 800),
      citation_count: chat.citations.length,
      error: chat.error,
    })
    await this.traceStore.finalize(search.trace_id, {
      ok: chat.error === null,
      result_count: search.rerank_hits.length,
      citation_count: chat.citations.length,
      answer_size: chat.answer.length,
    })
    return { search, chat }
  }

  async *streamChat(input: {
    queryText: string
    taskId?: string | null
    topK?: number | null
    videoPaths?: string[]
  }): AsyncIterable<VqaChatStreamEvent> {
    yield {
      type: "status",
      status: "retrieving",
      message: "正在检索相关片段...",
    }

    const analysis = await this.analyze(input)
    const { search, chat } = analysis

    yield {
      trace_id: search.trace_id,
      type: "status",
      status: "generating",
      hit_count: search.rerank_hits.length,
      message: search.rerank_hits.length > 0 ? "已完成证据检索，正在组织回答..." : "未检索到直接证据，正在组织回答...",
    }
    yield {
      trace_id: search.trace_id,
      type: "citations",
      citations: chat.citations,
      context_tokens_approx: chat.context_tokens_approx,
    }
    for (const chunk of splitAnswer(chat.answer)) {
      yield {
        trace_id: search.trace_id,
        type: "chunk",
        delta: chunk,
      }
    }
    yield {
      trace_id: search.trace_id,
      type: "done",
    }
  }

  async readTrace(traceId: string): Promise<VqaTraceResponse> {
    return {
      trace_id: traceId,
      records: (await this.traceStore.read(traceId)).map((record) => ({
        ...record,
        payload: record.payload,
      })),
    }
  }

  buildSearchPayload(bundle: SearchBundle) {
    return {
      trace_id: bundle.trace_id,
      query_text: bundle.query_text,
      dense_hits: bundle.dense_hits,
      sparse_hits: bundle.sparse_hits,
      rrf_hits: bundle.rrf_hits,
      rerank_hits: bundle.rerank_hits,
      hits: bundle.rerank_hits,
      results: bundle.rerank_hits.map((item) => ({
        timestamp: item.start,
        relevance: item.final_score,
        context: item.text,
        source: item.source,
        start: item.start,
        end: item.end,
      })),
    }
  }

  buildAnalyzePayload(bundle: AnalyzeBundle) {
    return {
      trace_id: bundle.search.trace_id,
      query_text: bundle.search.query_text,
      retrieval: this.buildSearchPayload(bundle.search),
      chat: {
        answer: bundle.chat.answer,
        citations: bundle.chat.citations,
        error: bundle.chat.error,
        context_tokens_approx: bundle.chat.context_tokens_approx,
      },
      hits: bundle.search.rerank_hits,
      results: bundle.search.rerank_hits.map((item) => ({
        timestamp: item.start,
        relevance: item.final_score,
        context: item.text,
        source: item.source,
        start: item.start,
        end: item.end,
      })),
    }
  }

  buildChatPayload(bundle: AnalyzeBundle) {
    return {
      trace_id: bundle.search.trace_id,
      answer: bundle.chat.answer,
      citations: bundle.chat.citations,
      error: bundle.chat.error,
      context_tokens_approx: bundle.chat.context_tokens_approx,
      hits: bundle.search.rerank_hits,
      results: bundle.search.rerank_hits.map((item) => ({
        timestamp: item.start,
        relevance: item.final_score,
        context: item.text,
        source: item.source,
        start: item.start,
        end: item.end,
      })),
    }
  }

  private async resolveTasks(input: {
    taskId?: string | null
    videoPaths: string[]
  }): Promise<TaskDetailResponse[]> {
    const details: TaskDetailResponse[] = []
    const taskIds = new Set<string>()
    const directTaskId = String(input.taskId || "").trim()
    if (directTaskId) {
      taskIds.add(directTaskId)
    }

    if (taskIds.size === 0 && input.videoPaths.length > 0) {
      const candidates = await this.taskRepository.list({
        limit: 10_000,
        offset: 0,
        sortBy: "date",
      })
      resolveTaskIdsFromVideoPaths(taskIds, input.videoPaths, candidates)
    }

    if (taskIds.size === 0) {
      throw AppError.badRequest("task_id or video_paths is required", {
        code: "VQA_TASK_REQUIRED",
        hint: "请传入 task_id，或提供可解析到已完成任务的 video_paths。",
      })
    }

    for (const taskId of taskIds) {
      const detail = await this.taskRepository.getDetail(taskId)
      if (!detail) {
        throw AppError.notFound(`Task not found: ${taskId}`, {
          code: "TASK_NOT_FOUND",
        })
      }
      details.push(detail)
    }

    return details
  }
}

function resolveQueryText(queryText: string): string {
  const normalized = String(queryText || "").trim()
  if (!normalized) {
    throw AppError.badRequest("query_text or question is required", {
      code: "VQA_QUERY_REQUIRED",
      hint: "请传入 query_text（兼容字段 question）。",
    })
  }
  return normalized
}

function clampTopK(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return 5
  }
  return Math.max(1, Math.min(50, Math.trunc(value || 5)))
}

function resolveTaskIdsFromVideoPaths(target: Set<string>, videoPaths: string[], candidates: TaskListResponse): void {
  const normalizedPaths = new Set(videoPaths.map((item) => normalizePathKey(item)))
  for (const candidate of candidates.items) {
    if (normalizedPaths.has(normalizePathKey(candidate.source_input))) {
      target.add(candidate.id)
    }
  }
}

function collectCandidates(tasks: TaskDetailResponse[]): EvidenceCandidate[] {
  const items: EvidenceCandidate[] = []
  for (const task of tasks) {
    const title = task.title || path.basename(task.source_input) || task.id
    if (task.transcript_segments.length > 0) {
      task.transcript_segments.forEach((segment) => {
        const text = String(segment.text || "").trim()
        if (!text) {
          return
        }
        items.push({
          task_id: task.id,
          task_title: title,
          source: "transcript",
          source_set: ["transcript"],
          start: Number(segment.start) || 0,
          end: Number(segment.end) || 0,
          text,
        })
      })
      continue
    }
    const transcriptText = String(task.transcript_text || "").trim()
    if (!transcriptText) {
      continue
    }
    items.push({
      task_id: task.id,
      task_title: title,
      source: "transcript",
      source_set: ["transcript"],
      start: 0,
      end: task.duration_seconds || 0,
      text: transcriptText,
    })
  }
  return items
}

function rankBy(
  items: Array<{ index: number; dense_score: number; sparse_score: number }>,
  key: "dense_score" | "sparse_score",
): Map<number, number> {
  return new Map(
    [...items]
      .sort((left, right) => right[key] - left[key])
      .map((item, index) => [item.index, index + 1] as const),
  )
}

function toHit(input: {
  candidate: EvidenceCandidate
  dense_score: number
  final_score: number
  rrf_score: number
  sparse_score: number
}): RetrievalHit {
  return {
    doc_id: buildDocId(input.candidate),
    task_id: input.candidate.task_id,
    task_title: input.candidate.task_title,
    source: input.candidate.source,
    source_set: [...input.candidate.source_set],
    start: input.candidate.start,
    end: input.candidate.end,
    text: input.candidate.text,
    image_path: "",
    dense_score: input.dense_score,
    sparse_score: input.sparse_score,
    rrf_score: input.rrf_score,
    final_score: input.final_score,
  }
}

function buildDocId(candidate: EvidenceCandidate): string {
  return `${candidate.task_id}:${candidate.start.toFixed(2)}:${candidate.end.toFixed(2)}:${candidate.source}`
}

function scoreSparse(queryText: string, text: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0
  }
  const candidateTokens = new Set(tokenize(text))
  const overlap = queryTokens.filter((token) => candidateTokens.has(token)).length
  const containsWholeQuery = text.includes(queryText) ? 0.35 : 0
  return roundScore((overlap / queryTokens.length) + containsWholeQuery)
}

function scoreDense(queryText: string, text: string, queryTokens: string[]): number {
  const queryBigrams = buildCharacterNgrams(queryText, 2)
  const textBigrams = new Set(buildCharacterNgrams(text, 2))
  const overlap = queryBigrams.filter((token) => textBigrams.has(token)).length
  const tokenCoverage = Math.min(1, queryTokens.length === 0 ? 0 : overlap / Math.max(queryTokens.length, 1))
  const jaccard = computeJaccard(queryBigrams, [...textBigrams])
  return roundScore((tokenCoverage * 0.55) + (jaccard * 0.45))
}

function tokenize(text: string): string[] {
  const normalized = String(text || "").toLowerCase()
  const latinTokens = normalized.match(/[a-z0-9]{2,}/g) || []
  const cjkText = [...normalized].filter((char) => /\p{Script=Han}/u.test(char)).join("")
  const cjkBigrams = buildCharacterNgrams(cjkText, 2)
  const cjkUnigrams = cjkText ? [...cjkText] : []
  return [...new Set([...latinTokens, ...cjkBigrams, ...cjkUnigrams])]
}

function buildCharacterNgrams(text: string, size: number): string[] {
  const chars = [...String(text || "").replace(/\s+/g, "")]
  if (chars.length === 0) {
    return []
  }
  if (chars.length <= size) {
    return [chars.join("")]
  }
  const items: string[] = []
  for (let index = 0; index <= chars.length - size; index += 1) {
    items.push(chars.slice(index, index + size).join(""))
  }
  return items
}

function computeJaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0
  }
  let overlap = 0
  leftSet.forEach((token) => {
    if (rightSet.has(token)) {
      overlap += 1
    }
  })
  const union = new Set([...leftSet, ...rightSet]).size
  return union === 0 ? 0 : overlap / union
}

function buildChatBundle(queryText: string, hits: RetrievalHit[]): ChatBundle {
  if (hits.length === 0) {
    return {
      answer:
        `当前没有从转写内容中检索到与“${queryText}”直接对应的证据。\n\n` +
        "建议尝试更具体的关键词，或者先确认任务已经完成转写与问答索引准备。",
      citations: [],
      context_tokens_approx: 0,
      error: null,
    }
  }

  const primary = hits[0]
  const supporting = hits.slice(1, 3)
  const answer = [
    `关于“${queryText}”，当前任务里最直接的证据来自 ${formatTimeRange(primary.start, primary.end)}：`,
    primary.text,
    supporting.length > 0 ? "" : undefined,
    supporting.length > 0 ? "补充证据：" : undefined,
    ...supporting.map((item) => `- ${formatTimeRange(item.start, item.end)} ${item.text}`),
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")

  return {
    answer,
    citations: hits.slice(0, 5).map((item) => ({
      doc_id: item.doc_id,
      task_id: item.task_id,
      task_title: item.task_title,
      source: item.source,
      source_set: [...item.source_set],
      start: item.start,
      end: item.end,
      text: item.text,
      image_path: item.image_path,
    })),
    context_tokens_approx: Math.max(
      1,
      Math.round(
        hits.slice(0, 5).reduce((total, item) => total + item.text.length, 0) / 2,
      ),
    ),
    error: null,
  }
}

function formatTimeRange(start: number, end: number): string {
  return `${formatSeconds(start)} - ${formatSeconds(end)}`
}

function formatSeconds(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function splitAnswer(answer: string): string[] {
  const normalized = String(answer || "").trim()
  if (!normalized) {
    return []
  }
  const coarse = normalized
    .split(/(?<=[。！？；\n])/u)
    .map((item) => item.trim())
    .filter(Boolean)
  const chunks: string[] = []
  for (const piece of coarse) {
    if (piece.length <= 28) {
      chunks.push(piece)
      continue
    }
    for (let index = 0; index < piece.length; index += 28) {
      chunks.push(piece.slice(index, index + 28))
    }
  }
  return chunks
}

function normalizePathKey(value: string): string {
  const normalized = path.normalize(String(value || "").trim())
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, value) * 1000) / 1000
}
