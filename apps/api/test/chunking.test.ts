import { describe, expect, it } from "vitest"

import type { Chapter, TranscriptParagraph } from "@vidgnost/contracts"

import { buildChunks, mapFramesToParagraphs } from "../src/retrieval/chunking.js"

function paragraph(index: number, text: string): TranscriptParagraph {
  return { id: `p${index}`, start: index * 10, end: index * 10 + 9, text, segmentIds: [`s${index}`] }
}

const CHAPTERS: Chapter[] = [
  {
    id: "ch01",
    index: 0,
    title: "第一章",
    gist: "第一章概括",
    start: 0,
    end: 49,
    paragraphIds: ["p0", "p1", "p2", "p3", "p4"],
    bullets: [],
  },
  {
    id: "ch02",
    index: 1,
    title: "第二章",
    gist: "第二章概括",
    start: 50,
    end: 99,
    paragraphIds: ["p5", "p6", "p7", "p8", "p9"],
    bullets: [],
  },
]

describe("buildChunks", () => {
  const paragraphs = Array.from({ length: 10 }, (_, index) => paragraph(index, "内容".repeat(60)))

  it("never crosses chapter boundaries", () => {
    const chunks = buildChunks({ chapters: CHAPTERS, paragraphs })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const chunk of chunks) {
      const chapter = CHAPTERS.find((item) => item.id === chunk.chapterId)
      expect(chapter).toBeDefined()
      for (const paragraphId of chunk.paragraphIds) {
        expect(chapter?.paragraphIds).toContain(paragraphId)
      }
    }
  })

  it("carries chapter metadata and monotonic time ranges", () => {
    const chunks = buildChunks({ chapters: CHAPTERS, paragraphs })
    for (const chunk of chunks) {
      expect(chunk.chapterTitle).toBeTruthy()
      expect(chunk.end).toBeGreaterThanOrEqual(chunk.start)
    }
  })

  it("appends frame captions when visual notes are provided", () => {
    const frameNotes = new Map([["p0", ["画面里是一个终端窗口，显示 codex-team-mode"]], ["p1", ["画面上写着 Fast 模式"]]])
    const chunks = buildChunks({ chapters: CHAPTERS, paragraphs, frameNotesByParagraph: frameNotes })
    const first = chunks.find((chunk) => chunk.paragraphIds.includes("p0"))
    expect(first?.text).toContain("【画面信息】")
    expect(first?.text).toContain("codex-team-mode")
  })

  it("overlaps the tail of the previous chunk", () => {
    const many = Array.from({ length: 30 }, (_, index) => paragraph(index, "内容".repeat(80)))
    const chapter: Chapter = {
      id: "ch01",
      index: 0,
      title: "长章节",
      gist: "",
      start: 0,
      end: 300,
      paragraphIds: many.map((item) => item.id),
      bullets: [],
    }
    const chunks = buildChunks({ chapters: [chapter], paragraphs: many })
    expect(chunks.length).toBeGreaterThan(1)
    const shared = chunks[0].paragraphIds.filter((id) => chunks[1].paragraphIds.includes(id))
    expect(shared.length).toBeGreaterThan(0)
  })

  it("returns nothing when there are no chapters", () => {
    expect(buildChunks({ chapters: [], paragraphs })).toEqual([])
  })
})

describe("mapFramesToParagraphs", () => {
  const paragraphs = [paragraph(0, "零"), paragraph(1, "一"), paragraph(2, "二")]

  it("maps a frame to the paragraph covering its time", () => {
    const mapping = mapFramesToParagraphs({ frames: [{ caption: "画面 A", time: 12 }], paragraphs })
    expect(mapping.get("p1")).toEqual(["画面 A"])
  })

  it("falls back to the nearest paragraph within tolerance", () => {
    const mapping = mapFramesToParagraphs({ frames: [{ caption: "画面 B", time: 31 }], paragraphs })
    expect(mapping.get("p2")).toEqual(["画面 B"])
  })

  it("drops frames that are too far away", () => {
    const mapping = mapFramesToParagraphs({ frames: [{ caption: "画面 C", time: 900 }], paragraphs })
    expect(mapping.size).toBe(0)
  })

  it("drops frames without any text", () => {
    const mapping = mapFramesToParagraphs({ frames: [{ time: 5 }], paragraphs })
    expect(mapping.size).toBe(0)
  })
})
