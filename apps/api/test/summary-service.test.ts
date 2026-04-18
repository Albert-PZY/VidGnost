import { describe, expect, it } from "vitest"

import type { TranscriptSegment } from "@vidgnost/contracts"

import { SummaryService } from "../src/modules/summary/summary-service.js"
import { TranscriptCorrectionService } from "../src/modules/summary/transcript-correction-service.js"

const BASE_SEGMENTS: TranscriptSegment[] = [
  { start: 0, end: 5, text: "第一段 原文" },
  { start: 5, end: 9, text: "第二段 原文" },
  { start: 9, end: 14, text: "第三段 原文" },
  { start: 14, end: 18, text: "第四段 原文" },
]

const BATCH_SEGMENTS: TranscriptSegment[] = [
  { start: 0, end: 5, text: "第一段 原文" },
  { start: 5, end: 9, text: "第二段 原文" },
  { start: 9, end: 14, text: "第三段 原文" },
  { start: 14, end: 18, text: "第四段 原文" },
  { start: 18, end: 22, text: "第五段 原文" },
  { start: 22, end: 27, text: "第六段 原文" },
  { start: 27, end: 32, text: "第七段 原文" },
  { start: 32, end: 36, text: "第八段 原文" },
]

describe("TranscriptCorrectionService", () => {
  it("skips llm correction entirely when mode is off", async () => {
    const client = createFakeClient([])
    const service = new TranscriptCorrectionService(client as never)

    const result = await service.apply({
      transcriptSegments: BASE_SEGMENTS,
      transcriptText: BASE_SEGMENTS.map((segment) => segment.text).join("\n"),
      promptTemplate: "请纠错：{text}",
      correctionMode: "off",
      correctionBatchSize: 6,
      correctionOverlap: 1,
    })

    expect(client.calls).toHaveLength(0)
    expect(result.correctedSegments).toEqual(BASE_SEGMENTS)
    expect(result.correctedText).toBe("第一段 原文\n第二段 原文\n第三段 原文\n第四段 原文")
    expect(result.index).toMatchObject({
      mode: "off",
      status: "skipped",
      fallback_used: false,
      source_mode: "raw_transcript",
      batch_count: 0,
      batch_size: 6,
      overlap: 1,
    })
  })

  it("applies strict correction in overlapping batches while preserving timestamps", async () => {
    const client = createFakeClient([
      "1. 第一段 修正\n2. 第二段 修正\n3. 第三段 修正\n4. 第四段 修正\n5. 第五段 修正\n6. 第六段 修正",
      "1. 第五段 修正\n2. 第六段 修正\n3. 第七段 修正\n4. 第八段 修正",
    ])
    const service = new TranscriptCorrectionService(client as never)

    const result = await service.apply({
      transcriptSegments: BATCH_SEGMENTS,
      transcriptText: BATCH_SEGMENTS.map((segment) => segment.text).join("\n"),
      promptTemplate: "请逐行纠错并按编号返回：{text}",
      correctionMode: "strict",
      correctionBatchSize: 6,
      correctionOverlap: 2,
    })

    expect(client.calls).toHaveLength(2)
    expect(result.correctedSegments).toEqual([
      { start: 0, end: 5, text: "第一段 修正" },
      { start: 5, end: 9, text: "第二段 修正" },
      { start: 9, end: 14, text: "第三段 修正" },
      { start: 14, end: 18, text: "第四段 修正" },
      { start: 18, end: 22, text: "第五段 修正" },
      { start: 22, end: 27, text: "第六段 修正" },
      { start: 27, end: 32, text: "第七段 修正" },
      { start: 32, end: 36, text: "第八段 修正" },
    ])
    expect(result.correctedText).toBe(
      "第一段 修正\n第二段 修正\n第三段 修正\n第四段 修正\n第五段 修正\n第六段 修正\n第七段 修正\n第八段 修正",
    )
    expect(result.index).toMatchObject({
      mode: "strict",
      status: "completed",
      fallback_used: false,
      source_mode: "llm_strict",
      batch_count: 2,
      batch_size: 6,
      overlap: 2,
    })
    expect(JSON.parse(result.strictSegmentsJson || "[]")).toHaveLength(8)
  })

  it("applies rewrite correction in overlapping batches while preserving timestamps", async () => {
    const client = createFakeClient([
      "1. 第一段 重写\n2. 第二段 重写\n3. 第三段 重写\n4. 第四段 重写\n5. 第五段 重写\n6. 第六段 重写",
      "1. 第五段 重写\n2. 第六段 重写\n3. 第七段 重写\n4. 第八段 重写",
    ])
    const streamedPreviewSegments: TranscriptSegment[] = []
    const service = new TranscriptCorrectionService(client as never)

    const result = await service.apply({
      transcriptSegments: BATCH_SEGMENTS,
      transcriptText: BATCH_SEGMENTS.map((segment) => segment.text).join("\n"),
      promptTemplate: "请逐行重写并按编号返回：{text}",
      correctionMode: "rewrite",
      correctionBatchSize: 6,
      correctionOverlap: 2,
      onPreviewEvent: async (event) => {
        if (event.segment) {
          streamedPreviewSegments.push(event.segment)
        }
      },
    })

    expect(client.calls).toHaveLength(2)
    expect(result.correctedSegments).toEqual([
      { start: 0, end: 5, text: "第一段 重写" },
      { start: 5, end: 9, text: "第二段 重写" },
      { start: 9, end: 14, text: "第三段 重写" },
      { start: 14, end: 18, text: "第四段 重写" },
      { start: 18, end: 22, text: "第五段 重写" },
      { start: 22, end: 27, text: "第六段 重写" },
      { start: 27, end: 32, text: "第七段 重写" },
      { start: 32, end: 36, text: "第八段 重写" },
    ])
    expect(result.correctedText).toBe(
      "第一段 重写\n第二段 重写\n第三段 重写\n第四段 重写\n第五段 重写\n第六段 重写\n第七段 重写\n第八段 重写",
    )
    expect(result.index).toMatchObject({
      mode: "rewrite",
      status: "completed",
      fallback_used: false,
      source_mode: "llm_rewrite",
      batch_count: 2,
      batch_size: 6,
      overlap: 2,
    })
    expect(streamedPreviewSegments).toEqual(result.correctedSegments)
  })

  it("marks rewrite fallback metadata when llm rewrite output is empty", async () => {
    const client = createFakeClient(["   "])
    const service = new TranscriptCorrectionService(client as never)

    const result = await service.apply({
      transcriptSegments: BATCH_SEGMENTS,
      transcriptText: BATCH_SEGMENTS.map((segment) => segment.text).join("\n"),
      promptTemplate: "请重写全文：{text}",
      correctionMode: "rewrite",
      correctionBatchSize: 6,
      correctionOverlap: 2,
    })

    expect(client.calls).toHaveLength(2)
    expect(result.correctedSegments).toEqual(BATCH_SEGMENTS)
    expect(result.correctedText).toBe(
      "第一段 原文\n第二段 原文\n第三段 原文\n第四段 原文\n第五段 原文\n第六段 原文\n第七段 原文\n第八段 原文",
    )
    expect(result.index).toMatchObject({
      mode: "rewrite",
      status: "fallback",
      fallback_used: true,
      source_mode: "rewrite_fallback",
      batch_count: 2,
      batch_size: 6,
      overlap: 2,
    })
    expect(result.index.fallback_reason).toContain("empty")
    expect(result.rewriteText).toBe(
      "第一段 原文\n第二段 原文\n第三段 原文\n第四段 原文\n第五段 原文\n第六段 原文\n第七段 原文\n第八段 原文",
    )
  })

  it("strips echoed timestamp prefixes from rewrite lines before writing corrected segments", async () => {
    const client = createFakeClient([
      "1. [00:00 - 00:05] 第一句 修正\n2. [00:05 - 00:09] 第二句 修正\n3. [00:09 - 00:14] 第三句 修正\n4. [00:14 - 00:18] 第四句 修正",
    ])
    const service = new TranscriptCorrectionService(client as never)

    const result = await service.apply({
      transcriptSegments: BASE_SEGMENTS,
      transcriptText: BASE_SEGMENTS.map((segment) => segment.text).join("\n"),
      promptTemplate: "请逐行重写并按编号返回：{text}",
      correctionMode: "rewrite",
      correctionBatchSize: 6,
      correctionOverlap: 1,
    })

    expect(result.correctedSegments).toEqual([
      { start: 0, end: 5, text: "第一句 修正" },
      { start: 5, end: 9, text: "第二句 修正" },
      { start: 9, end: 14, text: "第三句 修正" },
      { start: 14, end: 18, text: "第四句 修正" },
    ])
    expect(result.correctedText).toBe("第一句 修正\n第二句 修正\n第三句 修正\n第四句 修正")
  })
})

describe("SummaryService", () => {
  it("uses the rewrite-mode correction system prompt instead of forcing the strict prompt", async () => {
    const calls: Array<{ systemPrompt?: string; userPrompt: string }> = []
    const service = new SummaryService(
      {
        async get() {
          return {
            api_key: "ollama",
            base_url: "http://127.0.0.1:11434/v1",
            model: "qwen2.5:3b",
            correction_mode: "rewrite",
            correction_batch_size: 6,
            correction_overlap: 1,
          }
        },
        async isUserConfigured() {
          return false
        },
      } as never,
      {
        async getBundle() {
          return {
            templates: [
              { id: "correction-template", content: "请逐行重写：{text}" },
              { id: "notes-template", content: "请整理笔记：{text}" },
              { id: "mindmap-template", content: "请整理导图：{text}" },
            ],
            selection: {
              correction: "correction-template",
              notes: "notes-template",
              mindmap: "mindmap-template",
              vqa: "notes-template",
            },
          }
        },
      } as never,
      {
        async generateText(input: { systemPrompt?: string; userPrompt: string }) {
          calls.push(input)
          return {
            content: calls.length === 1
              ? "1. 第一段 重写\n2. 第二段 重写\n3. 第三段 重写\n4. 第四段 重写"
              : calls.length === 2
                ? "## 笔记"
                : "# 导图",
            raw: null,
          }
        },
      } as never,
    )

    await service.buildArtifacts({
      taskId: "task-summary-rewrite-prompt",
      taskTitle: "重写模式任务",
      workflow: "notes",
      transcriptSegments: BASE_SEGMENTS,
      transcriptText: BASE_SEGMENTS.map((segment) => segment.text).join("\n"),
    })

    expect(calls[0]?.systemPrompt).toContain("中文转写润色助手")
    expect(calls[0]?.systemPrompt).not.toContain("严格的中文转写纠错助手")
  })

  it("uses loopback llm config even when user_configured flag is still false", async () => {
    const client = createFakeClient(["## 本地笔记\n", "# 本地导图\n"])
    const service = new SummaryService(
      {
        async get() {
          return {
            api_key: "ollama",
            base_url: "http://127.0.0.1:11434/v1",
            model: "qwen2.5:3b",
            correction_mode: "off",
            correction_batch_size: 6,
            correction_overlap: 1,
          }
        },
        async isUserConfigured() {
          return false
        },
      } as never,
      {
        async getBundle() {
          return {
            templates: [
              { id: "correction-template", content: "请纠错：{text}" },
              { id: "notes-template", content: "请整理笔记：{text}" },
              { id: "mindmap-template", content: "请整理导图：{text}" },
            ],
            selection: {
              correction: "correction-template",
              notes: "notes-template",
              mindmap: "mindmap-template",
              vqa: "notes-template",
            },
          }
        },
      } as never,
      client as never,
    )

    const result = await service.buildArtifacts({
      taskId: "task-summary-loopback",
      taskTitle: "本地模型任务",
      workflow: "notes",
      transcriptSegments: BASE_SEGMENTS,
      transcriptText: BASE_SEGMENTS.map((segment) => segment.text).join("\n"),
    })

    const manifest = JSON.parse(result.artifactManifestJson) as {
      notes: { generated_by: string }
      mindmap: { generated_by: string }
      summary: { generated_by: string }
    }

    expect(client.calls).toHaveLength(2)
    expect(manifest.notes.generated_by).toBe("llm")
    expect(manifest.mindmap.generated_by).toBe("llm")
    expect(manifest.summary.generated_by).toBe("llm")
    expect(result.notesMarkdown).toContain("本地笔记")
    expect(result.notesMarkdown).not.toContain("当前为回退生成结果")
  })

  it("records fallback artifact metadata when notes and mindmap generation falls back", async () => {
    const service = new SummaryService(
      {
        async get() {
          return {
            api_key: "secret",
            base_url: "https://example.com/v1",
            model: "test-model",
            correction_mode: "off",
            correction_batch_size: 6,
            correction_overlap: 1,
          }
        },
        async isUserConfigured() {
          return true
        },
      } as never,
      {
        async getBundle() {
          return {
            templates: [
              { id: "correction-template", content: "请纠错：{text}" },
              { id: "notes-template", content: "请整理笔记：{text}" },
              { id: "mindmap-template", content: "请整理导图：{text}" },
            ],
            selection: {
              correction: "correction-template",
              notes: "notes-template",
              mindmap: "mindmap-template",
              vqa: "notes-template",
            },
          }
        },
      } as never,
      {
        async generateText() {
          throw new Error("llm unavailable")
        },
      } as never,
    )

    const result = await service.buildArtifacts({
      taskId: "task-summary-fallback",
      taskTitle: "回退任务",
      workflow: "notes",
      transcriptSegments: BASE_SEGMENTS,
      transcriptText: BASE_SEGMENTS.map((segment) => segment.text).join("\n"),
    })

    const manifest = JSON.parse(result.artifactManifestJson) as {
      notes: { fallback_reason: string; generated_by: string }
      mindmap: { generated_by: string }
      summary: { generated_by: string }
    }

    expect(manifest.notes.generated_by).toBe("fallback")
    expect(manifest.mindmap.generated_by).toBe("fallback")
    expect(manifest.summary.generated_by).toBe("fallback")
    expect(manifest.notes.fallback_reason).toContain("llm_generate_failed")
    expect(result.notesMarkdown).toContain("当前为回退生成结果")
    expect(result.mindmapMarkdown).toContain("当前为回退生成结果")
  })
})

function createFakeClient(responses: Array<string | Error>) {
  const calls: Array<{ model: string; systemPrompt?: string; userPrompt: string }> = []
  let index = 0

  return {
    calls,
    async generateText(input: { model: string; systemPrompt?: string; userPrompt: string }) {
      calls.push(input)
      const response = responses[index++]
      if (response instanceof Error) {
        throw response
      }
      return {
        content: response ?? "",
        raw: null,
      }
    },
  }
}
