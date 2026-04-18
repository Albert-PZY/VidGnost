import path from "node:path"

import type {
  TaskDetailResponse,
  TaskListResponse,
  VqaCitationItem,
  VqaChatStreamEvent,
  VqaTraceResponse,
} from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import type { LlmConfigRepository } from "../llm/llm-config-repository.js"
import { LlmServiceReadinessProbe, isLoopbackUrl } from "../llm/loopback-readiness.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
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
  private readonly llmConfigRepository: LlmConfigRepository | null
  private readonly llmClient: OpenAiCompatibleClient | null
  private readonly llmReadinessProbe: LlmServiceReadinessProbe

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly modelCatalogRepository: ModelCatalogRepository,
    third: string | LlmConfigRepository,
    fourth?: OpenAiCompatibleClient | string,
    fifth?: string,
  ) {
    const usesLegacyArgs = typeof third === "string"
    const traceLogDir = usesLegacyArgs ? third : (typeof fifth === "string" ? fifth : String(fourth || ""))
    this.llmConfigRepository = usesLegacyArgs ? null : third
    this.llmClient = usesLegacyArgs ? null : (fourth && typeof fourth !== "string" ? fourth : null)
    this.llmReadinessProbe = new LlmServiceReadinessProbe(this.llmClient)
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

    const textHits = result.textHits.slice(0, topK).map((item) => toHit(item))
    const imageHits = result.imageHits.slice(0, topK).map((item) => toHit(item))
    const fusedHits = result.initialHits.slice(0, topK).map((item) => toHit(item))

    await this.traceStore.write(traceId, "retrieval_text", {
      query_text: queryText,
      task_id: input.taskId || null,
      hit_count: textHits.length,
      hits: textHits,
    })
    await this.traceStore.write(traceId, "retrieval_image", {
      query_text: queryText,
      task_id: input.taskId || null,
      hit_count: imageHits.length,
      hits: imageHits,
    })
    await this.traceStore.write(traceId, "retrieval_fused", {
      query_text: queryText,
      task_id: input.taskId || null,
      hit_count: fusedHits.length,
      hits: fusedHits,
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
    const chat = await this.buildChatBundleWithLlm(search.query_text, search.hits, search.trace_id)
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

    const frameSemantic = await this.readFrameSemanticSegments(task.id)
    const persisted = await this.taskRepository.readTaskArtifactText(task.id, "D/vqa-prewarm/index.json")
    const parsed = persisted ? this.retrievalIndexService.parseIndex(persisted) : null
    if (parsed && parsed.items.length > 0) {
      if (hasFrameSemanticItems(parsed) || frameSemantic.length === 0) {
        this.rememberPreparedIndex(task.id, {
          updatedAt: task.updated_at,
          index: parsed,
        })
        return parsed
      }

      const upgraded = await this.retrievalIndexService.buildIndexAsync({
        taskId: task.id,
        taskTitle: task.title || path.basename(task.source_input) || task.id,
        transcriptSegments: task.transcript_segments,
        transcriptText: task.transcript_text || "",
        frameSemanticSegments: frameSemantic,
      })
      await this.taskRepository.writeTaskArtifactText(task.id, "D/vqa-prewarm/index.json", upgraded.indexJson)
      this.rememberPreparedIndex(task.id, {
        updatedAt: task.updated_at,
        index: {
          version: upgraded.version,
          retrieval_mode: upgraded.retrieval_mode,
          item_count: upgraded.item_count,
          items: upgraded.items,
        },
      })
      return upgraded
    }

    const built = await this.retrievalIndexService.buildIndexAsync({
      taskId: task.id,
      taskTitle: task.title || path.basename(task.source_input) || task.id,
      transcriptSegments: task.transcript_segments,
      transcriptText: task.transcript_text || "",
      frameSemanticSegments: frameSemantic,
    })
    if (built.items.length > 0) {
      await this.taskRepository.writeTaskArtifactText(task.id, "D/vqa-prewarm/index.json", built.indexJson)
      await this.taskRepository.writeTaskArtifactText(
        task.id,
        "D/vqa-prewarm/multimodal/index.json",
        JSON.stringify({
          task_id: task.id,
          mode: "multimodal",
          entries: [
            {
              artifact_path: "D/vqa-prewarm/index.json",
              modality: "text",
              kind: "retrieval_index",
            },
            {
              artifact_path: "D/vqa-prewarm/frame-semantic/index.json",
              modality: "image",
              kind: "frame_semantic",
            },
          ],
          generated_at: new Date().toISOString(),
        }, null, 2),
      )
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

  private async readFrameSemanticSegments(taskId: string): Promise<Array<{
    start: number
    end: number
    text: string
    image_path?: string
    visual_text?: string
    frame_index?: number
    frame_timestamp?: number
  }>> {
    const raw = await this.taskRepository.readTaskArtifactText(taskId, "D/vqa-prewarm/frame-semantic/index.json")
    if (raw) {
      try {
        const payload = JSON.parse(raw) as {
          items?: Array<{
            start?: number
            end?: number
            text?: string
            image_path?: string
            visual_text?: string
            frame_index?: number
            frame_timestamp?: number
          }>
        }
        const items = Array.isArray(payload.items) ? payload.items : []
        return items.map((item) => ({
          start: Number(item.start) || Number(item.frame_timestamp) || 0,
          end: Number(item.end) || Number(item.frame_timestamp) || Number(item.start) || 0,
          text: String(item.visual_text || item.text || "").trim(),
          image_path: String(item.image_path || "").trim() || undefined,
          visual_text: String(item.visual_text || item.text || "").trim(),
          frame_index: Number.isInteger(Number(item.frame_index)) ? Number(item.frame_index) : undefined,
          frame_timestamp: Number.isFinite(Number(item.frame_timestamp)) ? Number(item.frame_timestamp) : undefined,
        })).filter((item) => Boolean(item.text))
      } catch {
        return []
      }
    }

    const manifestRaw = await this.taskRepository.readTaskArtifactText(taskId, "D/vqa-prewarm/frames/manifest.json")
    if (!manifestRaw) {
      return []
    }

    try {
      const manifest = JSON.parse(manifestRaw) as {
        frames?: Array<{
          frame_index?: number
          path?: string
          timestamp_seconds?: number
        }>
      }
      const frames = Array.isArray(manifest.frames) ? manifest.frames : []
      const synthesized = frames
        .map((frame, index) => {
          const frameTimestamp = Number(frame.timestamp_seconds)
          const normalizedTimestamp = Number.isFinite(frameTimestamp) ? frameTimestamp : 0
          const frameIndex = Number(frame.frame_index)
          const normalizedFrameIndex = Number.isInteger(frameIndex) ? frameIndex : index
          const imagePath = String(frame.path || "").trim()
          const visualText = buildFallbackFrameSemanticText(normalizedFrameIndex, normalizedTimestamp)
          return {
            start: normalizedTimestamp,
            end: normalizedTimestamp,
            text: visualText,
            image_path: imagePath || undefined,
            visual_text: visualText,
            frame_index: normalizedFrameIndex,
            frame_timestamp: normalizedTimestamp,
          }
        })
        .filter((item) => Boolean(item.image_path || item.text))

      if (synthesized.length === 0) {
        return []
      }

      await this.taskRepository.writeTaskArtifactText(
        taskId,
        "D/vqa-prewarm/frame-semantic/index.json",
        JSON.stringify({
          task_id: taskId,
          item_count: synthesized.length,
          items: synthesized.map((item) => ({
            image_path: item.image_path,
            visual_text: item.visual_text,
            start: item.start,
            end: item.end,
            frame_index: item.frame_index,
            frame_timestamp: item.frame_timestamp,
          })),
          generated_at: new Date().toISOString(),
          generated_by: "manifest_fallback",
        }, null, 2),
      )
      return synthesized
    } catch {
      return []
    }
  }

  private async buildChatBundleWithLlm(queryText: string, hits: RetrievalHit[], traceId: string): Promise<ChatBundle> {
    const fallbackBundle = buildFallbackChatBundle(queryText, hits)
    const prompt = buildVqaAnswerPrompt(queryText, hits)
    const llmConfig = this.llmConfigRepository ? await this.llmConfigRepository.get() : null
    const llmConfigured = this.llmConfigRepository ? await this.llmConfigRepository.isUserConfigured() : false
    const llmEnabled = await this.isLlmEnabled(llmConfig, llmConfigured)
    const llmStatus = !llmEnabled || !llmConfig || !this.llmClient ? "disabled" : "enabled"

    await this.traceStore.write(traceId, "llm_request", {
      status: llmStatus,
      prompt_preview: prompt.slice(0, 320),
      hit_count: hits.length,
      model: llmConfig?.model || "",
      base_url: llmConfig?.base_url || "",
    })

    if (!llmEnabled || !llmConfig || !this.llmClient) {
      return fallbackBundle
    }

    try {
      const response = await this.llmClient.generateText({
        apiKey: llmConfig.api_key,
        baseUrl: llmConfig.base_url,
        model: llmConfig.model,
        timeoutSeconds: llmConfigured ? 120 : (isLoopbackUrl(llmConfig.base_url) ? 4 : 6),
        systemPrompt:
          "你是视频问答助手。必须基于给定证据回答，不可捏造。若证据不足，明确说明不确定并建议补充问题。",
        userPrompt: prompt,
      })
      const answer = String(response.content || "").trim()
      if (!answer) {
        await this.traceStore.write(traceId, "llm_request", {
          status: "empty_response",
          prompt_preview: prompt.slice(0, 320),
          hit_count: hits.length,
        })
        return fallbackBundle
      }
      await this.traceStore.write(traceId, "llm_request", {
        status: "ok",
        prompt_preview: prompt.slice(0, 320),
        hit_count: hits.length,
      })
      return {
        ...fallbackBundle,
        answer,
      }
    } catch (error) {
      await this.traceStore.write(traceId, "llm_request", {
        status: "fallback",
        error: error instanceof Error ? error.message : String(error),
        prompt_preview: prompt.slice(0, 320),
        hit_count: hits.length,
      })
      return fallbackBundle
    }
  }

  private async isLlmEnabled(
    llmConfigOverride?: Awaited<ReturnType<LlmConfigRepository["get"]>> | null,
    configuredOverride?: boolean,
  ): Promise<boolean> {
    if (!this.llmConfigRepository || !this.llmClient) {
      return false
    }
    const llmConfig = llmConfigOverride ?? await this.llmConfigRepository.get()
    const configured = configuredOverride ?? await this.llmConfigRepository.isUserConfigured()
    if (!llmConfig.base_url.trim() || !llmConfig.model.trim()) {
      return false
    }
    if (!llmConfig.api_key.trim() && !isLoopbackUrl(llmConfig.base_url)) {
      return false
    }
    if (!configured || isLoopbackUrl(llmConfig.base_url)) {
      return this.llmReadinessProbe.isReachable({
        apiKey: llmConfig.api_key,
        baseUrl: llmConfig.base_url,
        timeoutSeconds: 2,
      })
    }
    return true
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
    citation_type: item.citation_type || (item.source === "frame_semantic" ? "image" : "transcript"),
    image_path: item.image_path,
    visual_text: item.visual_text,
    image_evidence: item.image_evidence,
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

function buildFallbackChatBundle(queryText: string, hits: RetrievalHit[]): ChatBundle {
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

function buildVqaAnswerPrompt(queryText: string, hits: RetrievalHit[]): string {
  const evidence = hits
    .slice(0, 8)
    .map((item, index) =>
      [
        `证据 ${index + 1}`,
        `时间: ${formatTimeRange(item.start, item.end)}`,
        `来源: ${item.source}`,
        `内容: ${item.text}`,
      ].join("\n"),
    )
    .join("\n\n")

  return [
    `问题: ${queryText}`,
    "",
    "请基于以下证据给出简洁、可追溯的中文回答。",
    "要求：",
    "1. 先给结论，再给2-4条关键依据。",
    "2. 明确标注不确定性，不得扩展到证据外。",
    "3. 不要输出 markdown 标题。",
    "",
    evidence || "（无可用证据）",
  ].join("\n")
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

function hasFrameSemanticItems(index: RetrievalIndexPayload): boolean {
  return index.items.some((item) =>
    item.source === "frame_semantic" || item.source_set.includes("frame_semantic"),
  )
}

function buildFallbackFrameSemanticText(frameIndex: number, timestampSeconds: number): string {
  return `画面帧 ${frameIndex + 1}，时间 ${formatSeconds(timestampSeconds)}，等待视觉语义补全`
}
