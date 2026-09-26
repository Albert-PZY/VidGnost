import { describe, expect, it } from "vitest"

import type { TranscriptDoc } from "@vidgnost/contracts"

import { renderParagraphsForPrompt, segmentTranscript, windowParagraphs } from "../src/insight/segmenter.js"

function buildTranscript(texts: Array<{ gap: number; text: string }>): TranscriptDoc {
  let cursor = 0
  const segments = texts.map((item, index) => {
    cursor += item.gap
    const start = cursor
    const end = start + 2
    cursor = end
    return { id: `seg-${index}`, start, end, text: item.text }
  })
  return {
    language: "zh",
    engine: "dashscope-filetrans",
    engineDetail: "test",
    durationSeconds: cursor,
    speakers: [],
    segments,
    text: segments.map((segment) => segment.text).join("\n"),
    createdAt: new Date().toISOString(),
  }
}

describe("segmentTranscript", () => {
  it("splits on long pauses and keeps time ranges", () => {
    const transcript = buildTranscript([
      { gap: 0, text: "第一句话。" },
      { gap: 0.2, text: "第二句话。" },
      { gap: 2.5, text: "停顿之后的新话题。" },
      { gap: 0.2, text: "继续展开。" },
    ])
    const result = segmentTranscript(transcript, { minTokens: 1, maxTokens: 500 })
    expect(result.paragraphs).toHaveLength(2)
    expect(result.paragraphs[0].text).toContain("第一句话")
    expect(result.paragraphs[1].start).toBeGreaterThan(result.paragraphs[0].end)
    expect(result.paragraphs[0].segmentIds).toEqual(["seg-0", "seg-1"])
  })

  it("splits when the token budget is exceeded", () => {
    const transcript = buildTranscript(
      Array.from({ length: 8 }, (_, index) => ({ gap: 0.1, text: `第${index}句内容描述了一些细节。` })),
    )
    const result = segmentTranscript(transcript, { maxTokens: 30, minTokens: 1 })
    expect(result.paragraphs.length).toBeGreaterThan(1)
  })

  it("merges tiny trailing paragraphs forward", () => {
    const transcript = buildTranscript([
      { gap: 0, text: "这是一个足够长的段落，用来避免被合并进相邻段落中。" },
      { gap: 2.5, text: "短。" },
    ])
    const result = segmentTranscript(transcript, { minTokens: 10, maxTokens: 1000 })
    expect(result.paragraphs).toHaveLength(1)
  })

  it("drops empty segments", () => {
    const transcript = buildTranscript([
      { gap: 0, text: "有内容。" },
      { gap: 1, text: "   " },
    ])
    const result = segmentTranscript(transcript, { minTokens: 1 })
    expect(result.paragraphs).toHaveLength(1)
  })
})

describe("windowParagraphs", () => {
  it("overlaps consecutive windows and covers all paragraphs", () => {
    const paragraphs = Array.from({ length: 10 }, (_, index) => ({
      id: `p${index}`,
      start: index * 10,
      end: index * 10 + 8,
      text: "内容".repeat(60),
      segmentIds: [`s${index}`],
    }))
    const windows = windowParagraphs(paragraphs, { tokenBudget: 200, overlap: 1 })
    expect(windows.length).toBeGreaterThan(1)
    const seen = new Set(windows.flat().map((paragraph) => paragraph.id))
    expect(seen.size).toBe(10)
  })

  it("returns a single window for short input", () => {
    const paragraphs = [{ id: "p0", start: 0, end: 3, text: "短", segmentIds: ["s0"] }]
    expect(windowParagraphs(paragraphs)).toHaveLength(1)
  })
})

describe("renderParagraphsForPrompt", () => {
  it("includes ids and timecodes", () => {
    const rendered = renderParagraphsForPrompt([
      { id: "p0001", start: 65, end: 90, text: "正文", segmentIds: [] },
    ])
    expect(rendered).toBe("p0001 [01:05-01:30] 正文")
  })

  it("omits timecodes when asked", () => {
    const rendered = renderParagraphsForPrompt(
      [{ id: "p0001", start: 65, end: 90, text: "正文", segmentIds: [] }],
      { includeTime: false },
    )
    expect(rendered).toBe("p0001 正文")
  })
})
