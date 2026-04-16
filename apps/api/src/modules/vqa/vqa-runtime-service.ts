import path from "node:path"

import type {
  TaskDetailResponse,
  TaskListResponse,
  VqaCitationItem,
  VqaChatStreamEvent,
  VqaTraceResponse,
} from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { TaskRepository } from "../tasks/task-repository.js"
import {
  RetrievalIndexService,
  type RetrievalIndexPayload,
  type RetrievalSearchHit,
} from "./retrieval-index-service.js"
import { VqaTraceStore } from "./trace-store.js"

interface RetrievalHit extends VqaCitationItem {
  final_score: number
}

interface SearchBundle {
  hits: RetrievalHit[]
  query_text: string
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

interface PreparedIndexCacheEntry {
  updatedAt: string
  index: RetrievalIndexPayload
}

export class VqaRuntimeService {
  private readonly traceStore: VqaTraceStore
  private readonly retrievalIndexService: RetrievalIndexService
  private readonly preparedIndexCache = new Map<string, PreparedIndexCacheEntry>()

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly modelCatalogRepository: ModelCatalogRepository,
    traceLogDir: string,
  ) {
    this.traceStore = new VqaTraceStore(traceLogDir)
    this.retrievalIndexService = new RetrievalIndexService()
  }

  async search(input: {
    queryText: string
    taskId?: string | null
    topK?: number | null
    videoPaths?: string[]
  }): Promise<SearchBundle> {
    const queryText = resolveQueryText(input.queryText)
    const topK = await this.resolveTopK(input.topK)
    const videoPaths = input.videoPaths || []
    const tasks = await this.resolveTasks({
      taskId: input.taskId,
      videoPaths,
    })
    const preparedIndexes = await Promise.all(tasks.map((task) => this.ensurePreparedIndex(task)))
    const vectorItems = preparedIndexes.flatMap((item) => item.items)
    if (vectorItems.length === 0) {
      throw buildTaskNotReadyError()
    }

    const candidatePoolSize = Math.min(vectorItems.length, Math.max(topK * 3, topK + 4))
    const result = this.retrievalIndexService.searchIndex({
      index: {
        version: 2,
        retrieval_mode: "vector-index",
        item_count: vectorItems.length,
        items: vectorItems,
      },
      queryText,
      topK: candidatePoolSize,
      rerankTopN: topK,
    })
    const hits = result.rerankedHits.map((item) => toHit(item))
    const traceId = this.traceStore.newTrace({
      metadata: {
        query_text: queryText,
        task_id: input.taskId || null,
        video_paths: videoPaths,
        top_k: topK,
      },
      configSnapshot: {
        retrieval: {
          mode: "vector-index",
          rerank: true,
          query_expansion: false,
          dedupe: "segment-doc-id",
          candidate_pool_size: candidatePoolSize,
          rerank_top_n: topK,
        },
      },
    })

    await this.traceStore.write(traceId, "retrieval", {
      query_text: queryText,
      task_id: input.taskId || null,
      video_paths: videoPaths,
      top_k: topK,
      query_expansion: false,
      dedupe: "segment-doc-id",
      candidate_pool_size: candidatePoolSize,
      hit_count: hits.length,
      hits,
    })

    return {
      trace_id: traceId,
      query_text: queryText,
      hits,
    }
  }

  async analyze(input: {
    queryText: string
    taskId?: string | null
    topK?: number | null
    videoPaths?: string[]
  }): Promise<AnalyzeBundle> {
    const search = await this.search(input)
    const chat = buildChatBundle(search.query_text, search.hits)
    await this.traceStore.write(search.trace_id, "llm_stream", {
      answer_preview: chat.answer.slice(0, 800),
      citation_count: chat.citations.length,
      error: chat.error,
    })
    await this.traceStore.finalize(search.trace_id, {
      ok: chat.error === null,
      result_count: search.hits.length,
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
      hit_count: search.hits.length,
      message: search.hits.length > 0 ? "已完成证据检索，正在组织回答..." : "未检索到直接证据，正在组织回答...",
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
      hit_count: bundle.hits.length,
      hits: bundle.hits,
      results: mapHitsToResults(bundle.hits),
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
      hits: bundle.search.hits,
      results: mapHitsToResults(bundle.search.hits),
    }
  }

  buildChatPayload(bundle: AnalyzeBundle) {
    return {
      trace_id: bundle.search.trace_id,
      answer: bundle.chat.answer,
      citations: bundle.chat.citations,
      error: bundle.chat.error,
      context_tokens_approx: bundle.chat.context_tokens_approx,
      hits: bundle.search.hits,
      results: mapHitsToResults(bundle.search.hits),
    }
  }

  private async resolveTasks(input: {
    taskId?: string | null
    videoPaths: string[]
  }): Promise<TaskDetailResponse[]> {
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

    return Promise.all(
      [...taskIds].map(async (taskId) => {
        const detail = await this.taskRepository.getDetail(taskId)
        if (!detail) {
          throw AppError.notFound(`Task not found: ${taskId}`, {
            code: "TASK_NOT_FOUND",
          })
        }
        return detail
      }),
    )
  }

  private async ensurePreparedIndex(task: TaskDetailResponse) {
    const cached = this.preparedIndexCache.get(task.id)
    if (cached && cached.updatedAt === task.updated_at) {
      this.rememberPreparedIndex(task.id, cached)
      return cached.index
    }

    const persisted = await this.taskRepository.readTaskArtifactText(task.id, "D/vqa-prewarm/index.json")
    const parsed = persisted ? this.retrievalIndexService.parseIndex(persisted) : null
    if (parsed && parsed.items.length > 0) {
      this.rememberPreparedIndex(task.id, {
        updatedAt: task.updated_at,
        index: parsed,
      })
      return parsed
    }

    const built = await this.retrievalIndexService.buildIndexAsync({
      taskId: task.id,
      taskTitle: task.title || path.basename(task.source_input) || task.id,
      transcriptSegments: task.transcript_segments,
      transcriptText: task.transcript_text || "",
    })
    if (built.items.length > 0) {
      await this.taskRepository.writeTaskArtifactText(task.id, "D/vqa-prewarm/index.json", built.indexJson)
      this.rememberPreparedIndex(task.id, {
        updatedAt: task.updated_at,
        index: {
          version: built.version,
          retrieval_mode: built.retrieval_mode,
          item_count: built.item_count,
          items: built.items,
        },
      })
    }
    return built
  }

  private async resolveTopK(value: number | null | undefined): Promise<number> {
    if (Number.isFinite(value)) {
      return clampTopK(value)
    }
    const models = await this.modelCatalogRepository.listModels()
    const rerankModel = models.items.find((item) => item.id === "rerank-default")
    return clampTopK(rerankModel?.rerank_top_n)
  }

  private rememberPreparedIndex(taskId: string, entry: PreparedIndexCacheEntry): void {
    this.preparedIndexCache.delete(taskId)
    this.preparedIndexCache.set(taskId, entry)

    while (this.preparedIndexCache.size > 12) {
      const oldestKey = this.preparedIndexCache.keys().next().value
      if (!oldestKey) {
        break
      }
      this.preparedIndexCache.delete(oldestKey)
    }
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

function toHit(item: RetrievalSearchHit): RetrievalHit {
  return {
    doc_id: item.doc_id,
    task_id: item.task_id,
    task_title: item.task_title,
    source: item.source,
    source_set: [...item.source_set],
    start: item.start,
    end: item.end,
    text: item.text,
    final_score: item.final_score,
  }
}

function mapHitsToResults(hits: RetrievalHit[]) {
  return hits.map((item) => ({
    timestamp: item.start,
    relevance: item.final_score,
    context: item.text,
    source: item.source,
    start: item.start,
    end: item.end,
  }))
}

function buildTaskNotReadyError(): AppError {
  return AppError.conflict("当前任务还没有可用于问答的转写证据。", {
    code: "VQA_TASK_NOT_READY",
    hint: "请先等待任务完成转写，再执行视频问答。",
  })
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
