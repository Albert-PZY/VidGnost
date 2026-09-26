import type { Chapter, KeyFrame, TaskOptions, TranscriptParagraph, TranslationDoc } from "@vidgnost/contracts"

import { readFile } from "node:fs/promises"
import path from "node:path"

import { logger } from "../core/logger.js"
import { extractJson, formatTimecode } from "../core/text.js"
import { mapWithConcurrency } from "../providers/http.js"
import type { ModelGateway } from "../providers/gateway.js"

const log = logger.child({ scope: "enrich" })

const PROOFREAD_SYSTEM_PROMPT = [
  "你是中文与英文语音转写校对员。输入是编号的转写段落。",
  "规则：",
  "1. 只修正明显的同音错字、专有名词拼写、英文术语大小写与常见技术名词写法。",
  "2. 严禁改写句子结构、删除口语内容、增补原文没有的信息。",
  "3. 保留原有的标点与断句风格；除修正错误外文本应逐字保持。",
  "4. 只输出 JSON：{\"items\":[{\"id\":\"p0001\",\"text\":\"修正后的文本\"}]}",
].join("\n")

export interface ProofreadResult {
  changedCount: number
  paragraphs: TranscriptParagraph[]
}

export class EnrichService {
  constructor(private readonly gateway: ModelGateway) {}

  /* ------------------------------------------------------------- 转写校对 */

  async proofread(input: {
    chapters: Chapter[]
    paragraphs: TranscriptParagraph[]
    signal?: AbortSignal
    title: string
  }): Promise<ProofreadResult> {
    if (input.paragraphs.length === 0) {
      return { changedCount: 0, paragraphs: [] }
    }
    const glossary = input.chapters
      .flatMap((chapter) => chapter.bullets)
      .slice(0, 12)
      .join("；")

    const batches = chunk(input.paragraphs, 12)
    const corrected: TranscriptParagraph[] = []
    let changedCount = 0

    for (const batch of batches) {
      try {
        const result = await this.gateway.chat("llm.fast", {
          systemPrompt: PROOFREAD_SYSTEM_PROMPT,
          userPrompt: [
            `视频标题：${input.title}`,
            glossary ? `已知上下文（仅供术语参考）：${glossary}` : "",
            "",
            batch.map((paragraph) => `${paragraph.id} ${paragraph.text}`).join("\n"),
          ]
            .filter(Boolean)
            .join("\n"),
          responseFormat: { type: "json_object" },
          signal: input.signal,
          maxTokens: 4000,
        })
        const parsed = extractJson<{ items?: Array<{ id?: unknown; text?: unknown }> }>(result.text)
        const byId = new Map(
          (parsed?.items || []).map((item) => [String(item.id || "").trim(), String(item.text || "").trim()]),
        )
        for (const paragraph of batch) {
          const next = byId.get(paragraph.id)
          if (next && isSafeCorrection(paragraph.text, next)) {
            const changed = next !== paragraph.text
            if (changed) {
              changedCount += 1
            }
            corrected.push({ ...paragraph, text: next, corrected: changed })
          } else {
            corrected.push(paragraph)
          }
        }
      } catch (error) {
        log.warn({ error: String(error) }, "proofread batch failed")
        corrected.push(...batch)
      }
    }

    return { changedCount, paragraphs: corrected }
  }

  /* ----------------------------------------------------------------- 翻译 */

  async translate(input: {
    paragraphs: TranscriptParagraph[]
    signal?: AbortSignal
    sourceLanguage: string
    targetLanguage: string
  }): Promise<TranslationDoc> {
    const texts = input.paragraphs.map((paragraph) => paragraph.text)
    const translated = await this.gateway.translate({
      texts,
      targetLang: input.targetLanguage,
      sourceLang: input.sourceLanguage === "auto" ? undefined : input.sourceLanguage,
      signal: input.signal,
    })
    return {
      targetLanguage: input.targetLanguage,
      engine: "qwen-mt-uni",
      paragraphs: input.paragraphs.map((paragraph, index) => ({
        paragraphId: paragraph.id,
        text: translated[index] || "",
      })),
      createdAt: new Date().toISOString(),
    }
  }

  /* -------------------------------------------------------------- 视觉图注 */

  /**
   * 逐帧多模态理解：每帧请求携带「上一帧的图注」作为上下文，保持时序连贯。
   * 返回的图注与屏上文字会参与文本检索，从而让画面内容也能被问出来。
   */
  async captionFrames(input: {
    frames: KeyFrame[]
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
    taskDir: string
    title: string
  }): Promise<KeyFrame[]> {
    if (input.frames.length === 0) {
      return []
    }

    const concurrency = 2
    let completed = 0
    const contexts = new Array<string>(input.frames.length).fill("")

    // 先串行生成上下文链（每帧依赖上一帧），再并发补齐兜底——这里采用「顺序 + 小并发窗口」折中：
    // 按批次处理，批内并发，批间用上一批最后一帧的图注作为上下文。
    const batchSize = concurrency
    for (let start = 0; start < input.frames.length; start += batchSize) {
      const batch = input.frames.slice(start, start + batchSize)
      const previousContext = start > 0 ? contexts[start - 1] : ""
      const results = await mapWithConcurrency(batch, batchSize, async (frame, indexInBatch) => {
        const absoluteIndex = start + indexInBatch
        const context = indexInBatch === 0 ? previousContext : contexts[absoluteIndex - 1] || previousContext
        return this.captionFrame({
          context,
          frame,
          signal: input.signal,
          taskDir: input.taskDir,
          title: input.title,
        })
      })
      for (const [indexInBatch, result] of results.entries()) {
        contexts[start + indexInBatch] = result.summary
        completed += 1
      }
      input.onProgress?.(completed, input.frames.length)
    }

    return input.frames.map((frame, index) => {
      const parsed = parseCaption(contexts[index])
      return {
        ...frame,
        caption: parsed.summary,
        ...(parsed.onScreenText ? { onScreenText: parsed.onScreenText } : {}),
        ...(parsed.slideLike === undefined ? {} : { slideLike: parsed.slideLike }),
      }
    })
  }

  private async captionFrame(input: {
    context: string
    frame: KeyFrame
    signal?: AbortSignal
    taskDir: string
    title: string
  }): Promise<{ summary: string }> {
    const absolutePath = path.join(input.taskDir, input.frame.path)
    const dataUri = await toDataUri(absolutePath)
    if (!dataUri) {
      return { summary: "" }
    }

    try {
      const text = await this.gateway.vision({
        images: [dataUri],
        signal: input.signal,
        systemPrompt:
          "你在为视频关键帧做结构化图注，输出会进入检索索引，因此必须具体、可搜索。",
        prompt: [
          `视频标题：${input.title}`,
          `当前时间码：${formatTimecode(input.frame.time)}`,
          input.context ? `上一帧的图注（保持时序连贯，不要重复）：${input.context}` : "这是第一个关键帧。",
          "",
          "请输出 JSON：",
          '{"caption":"这一帧画面上有什么（40 字内，具体到内容）","onScreenText":"画面上可读的文字，如标题/代码/表格；没有就空字符串","slideLike":true}',
          "说明：slideLike 表示画面是否为幻灯片、代码编辑器、图表或数据看板这类「信息型画面」。",
        ].join("\n"),
      })
      return { summary: text }
    } catch (error) {
      log.warn({ frame: input.frame.id, error: String(error) }, "frame caption failed")
      return { summary: "" }
    }
  }
}

function parseCaption(raw: string): { onScreenText: string; slideLike?: boolean; summary: string } {
  if (!raw.trim()) {
    return { onScreenText: "", summary: "" }
  }
  const parsed = extractJson<{ caption?: unknown; onScreenText?: unknown; slideLike?: unknown }>(raw)
  if (!parsed) {
    return { onScreenText: "", summary: raw.trim().slice(0, 160) }
  }
  return {
    summary: String(parsed.caption || "").trim(),
    onScreenText: String(parsed.onScreenText || "").trim(),
    ...(typeof parsed.slideLike === "boolean" ? { slideLike: parsed.slideLike } : {}),
  }
}

async function toDataUri(filePath: string): Promise<string> {
  try {
    const buffer = await readFile(filePath)
    if (buffer.byteLength === 0) {
      return ""
    }
    return `data:image/jpeg;base64,${buffer.toString("base64")}`
  } catch {
    return ""
  }
}

/** 纠错幅度保护：长度变化过大或差异比例过高时视为「改写」，丢弃该结果。 */
function isSafeCorrection(original: string, next: string): boolean {
  if (!next.trim()) {
    return false
  }
  const ratio = next.length / Math.max(1, original.length)
  if (ratio < 0.8 || ratio > 1.25) {
    return false
  }
  const distance = levenshtein(original.slice(0, 240), next.slice(0, 240))
  return distance / Math.max(1, Math.min(original.length, 240)) < 0.28
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  let previous = Array.from({ length: cols }, (_, index) => index)
  for (let row = 1; row < rows; row += 1) {
    const current = [row]
    for (let col = 1; col < cols; col += 1) {
      current[col] = Math.min(
        previous[col] + 1,
        current[col - 1] + 1,
        previous[col - 1] + (a[row - 1] === b[col - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[cols - 1]
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

export function resolveOptionsDefaults(options: TaskOptions): TaskOptions {
  return options
}
