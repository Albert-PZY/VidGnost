import type { Chapter, RetrievalChunk, TranscriptParagraph } from "@vidgnost/contracts"

import { logger } from "../core/logger.js"
import { extractJson, formatTimecode, snippet } from "../core/text.js"
import type { ModelGateway } from "../providers/gateway.js"

const log = logger.child({ scope: "contextualizer" })

const SYSTEM_PROMPT = [
  "你在为视频转写切块生成「检索增强元数据」。",
  "规则：",
  "1. context 是 50-80 字的定位说明：本片段在整段视频的什么位置、承接什么、其中的代词与简写分别指什么。",
  "2. questions 是 3 个「这段内容能回答的问题」，用自然口语提问，必须包含片段里的关键实体名。",
  "3. 不要编造片段中没有的信息。",
  '4. 只输出 JSON：{"items":[{"id":"ck-0001","context":"...","questions":["..."]}]}',
].join("\n")

export interface ChunkContext {
  /** 前置到正文之前的定位说明，同时参与 embedding 与 BM25。 */
  context: string
  questions: string[]
}

/**
 * 为每个切块生成上下文前缀与问题变体。
 * 依据 Anthropic Contextual Retrieval（chunk 定位前缀）与 RAGFlow 的「索引问题而不只索引正文」实践：
 * 前缀解决转写稿中的指代丢失，问题变体显著提高自然语言提问的召回率。
 */
export async function buildChunkContexts(input: {
  chapters: Chapter[]
  chunks: RetrievalChunk[]
  gateway: ModelGateway
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
  title: string
}): Promise<Map<string, ChunkContext>> {
  const result = new Map<string, ChunkContext>()
  for (const item of input.chunks) {
    result.set(item.id, { context: "", questions: [] })
  }
  if (input.chunks.length === 0) {
    return result
  }

  const chapterById = new Map(input.chapters.map((chapter) => [chapter.id, chapter]))
  const overview = input.chapters
    .map((chapter) => `${chapter.title}（${formatTimecode(chapter.start)}）: ${chapter.gist}`)
    .join("\n")

  const batches = chunkItems(input.chunks, 6)
  let done = 0
  for (const batch of batches) {
    const payload = batch.map((item) => {
      const chapter = item.chapterId ? chapterById.get(item.chapterId) : undefined
      return {
        id: item.id,
        chapter: chapter?.title || "",
        time: `${formatTimecode(item.start)}-${formatTimecode(item.end)}`,
        text: snippet(item.text, 700),
      }
    })

    try {
      const response = await input.gateway.chat("llm.fast", {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: [
          `视频标题：${input.title}`,
          "全片章节结构：",
          overview,
          "",
          "待处理的切块：",
          JSON.stringify(payload, null, 1),
          "",
          "请输出 JSON。",
        ].join("\n"),
        responseFormat: { type: "json_object" },
        signal: input.signal,
        maxTokens: 3000,
      })
      const parsed = extractJson<{ items?: Array<{ context?: unknown; id?: unknown; questions?: unknown }> }>(response.text)
      for (const item of parsed?.items || []) {
        const id = String(item.id || "").trim()
        if (!id || !result.has(id)) {
          continue
        }
        result.set(id, {
          context: String(item.context || "").trim().slice(0, 220),
          questions: Array.isArray(item.questions)
            ? item.questions.map((question) => String(question || "").trim()).filter(Boolean).slice(0, 4)
            : [],
        })
      }
    } catch (error) {
      log.warn({ error: String(error) }, "chunk context batch failed")
    }
    done += batch.length
    input.onProgress?.(done, input.chunks.length)
  }

  return result
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}
