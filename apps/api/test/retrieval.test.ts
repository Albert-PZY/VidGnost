import { describe, expect, it } from "vitest"

import type { RetrievalHit } from "@vidgnost/contracts"

import { attachCitations, parseCitationTimecodes } from "../src/retrieval/qa-service.js"
import { fuseRrf } from "../src/retrieval/index-service.js"

const EVIDENCE = [
  { id: "ck-0001", start: 0, end: 36, text: "开头介绍 Skill 的四个角色与模型分配。", chapterTitle: "角色配置" },
  { id: "ck-0002", start: 70, end: 106, text: "探索者使用 GPT-6 Luna 并默认 Fast 模式。", chapterTitle: "成本优化" },
]

const HITS: RetrievalHit[] = [
  { chunkId: "ck-0002", source: "rerank", scores: { rerank: 0.4, rrf: 0.03 }, text: EVIDENCE[1].text, start: 70, end: 106 },
]

describe("attachCitations", () => {
  it("rewrites timecodes into numbered citation markers", () => {
    const result = attachCitations("探索者用 Luna。[01:10]", EVIDENCE, 600, HITS)
    expect(result.answer).toBe("探索者用 Luna。[^1]")
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].start).toBe(70)
  })

  it("matches timecodes inside the tolerance window", () => {
    const result = attachCitations("内容。[00:05]", EVIDENCE, 600, HITS)
    expect(result.citations[0].chunkId).toBe("ck-0001")
  })

  it("reuses the same citation for repeated timecodes", () => {
    const result = attachCitations("A。[01:11] B。[01:12]", EVIDENCE, 600, HITS)
    expect(result.citations).toHaveLength(1)
    expect(result.answer).toBe("A。[^1] B。[^1]")
  })

  it("keeps unmatched timecodes untouched", () => {
    const result = attachCitations("内容。[09:00]", EVIDENCE, 600, HITS)
    expect(result.answer).toBe("内容。[09:00]")
  })

  it("still returns one citation when the model omitted all anchors", () => {
    const result = attachCitations("没有任何引用的回答。", EVIDENCE, 600, HITS)
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].chunkId).toBe("ck-0001")
  })

  it("clamps the timecode into the video duration", () => {
    const result = attachCitations("内容。[10:00]", EVIDENCE, 90, HITS)
    expect(result.citations.length).toBeGreaterThan(0)
  })
})

describe("parseCitationTimecodes", () => {
  it("extracts every timecode", () => {
    expect(parseCitationTimecodes("a [01:10] b [2:03:04]")).toEqual([70])
  })
})

describe("fuseRrf", () => {
  it("ranks documents retrieved by both channels first", () => {
    const fused = fuseRrf([
      { source: "bm25", items: [{ id: "a", score: 9 }, { id: "b", score: 8 }] },
      { source: "vector", items: [{ id: "b", score: 0.9 }, { id: "c", score: 0.8 }] },
    ])
    expect(fused[0].id).toBe("b")
    expect(fused[0].bm25).toBe(8)
    expect(fused[0].vector).toBe(0.9)
  })

  it("keeps single-channel documents", () => {
    const fused = fuseRrf([{ source: "bm25", items: [{ id: "only", score: 1 }] }])
    expect(fused.map((item) => item.id)).toEqual(["only"])
  })

  it("returns nothing for empty channels", () => {
    expect(fuseRrf([])).toEqual([])
  })
})
