import { describe, expect, it } from "vitest"

import type { TranscriptSegment } from "@vidgnost/contracts"

import { buildTranscriptDoc, normalizeSegments, transcriptToSrt } from "../src/asr/transcription-service.js"

function segment(index: number, start: number, end: number, text: string): TranscriptSegment {
  return { id: `seg-${index}`, start, end, text }
}

describe("normalizeSegments", () => {
  it("drops empty text and sorts by start", () => {
    const result = normalizeSegments([
      segment(0, 10, 12, "第二句"),
      segment(1, 0, 2, "第一句"),
      segment(2, 4, 6, "   "),
    ])
    expect(result.map((item) => item.text)).toEqual(["第一句", "第二句"])
  })

  it("merges duplicated consecutive segments across chunk boundaries", () => {
    const result = normalizeSegments([
      segment(0, 0, 3, "同一句话"),
      segment(1, 3.2, 6, "同一句话"),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].end).toBe(6)
  })

  it("keeps distinct segments separate", () => {
    const result = normalizeSegments([segment(0, 0, 3, "第一句"), segment(1, 3, 6, "第二句")])
    expect(result).toHaveLength(2)
  })

  it("collapses internal whitespace", () => {
    const result = normalizeSegments([segment(0, 0, 3, "  多余   空格  ")])
    expect(result[0].text).toBe("多余 空格")
  })
})

describe("buildTranscriptDoc", () => {
  it("builds plain text and empty speaker list", () => {
    const doc = buildTranscriptDoc({
      durationSeconds: 12.3456,
      engine: "dashscope-filetrans",
      engineDetail: "qwen-audio",
      language: "zh",
      segments: [segment(0, 0, 3, "第一句"), segment(1, 3, 6, "第二句")],
    })
    expect(doc.text).toBe("第一句\n第二句")
    expect(doc.speakers).toEqual([])
    expect(doc.durationSeconds).toBe(12.346)
  })

  it("collects distinct speakers", () => {
    const doc = buildTranscriptDoc({
      durationSeconds: 10,
      engine: "faster-whisper",
      engineDetail: "local",
      language: "zh",
      segments: [
        { ...segment(0, 0, 3, "A"), speaker: "S1" },
        { ...segment(1, 3, 6, "B"), speaker: "S2" },
        { ...segment(2, 6, 9, "C"), speaker: "S1" },
      ],
    })
    expect(doc.speakers).toEqual(["S1", "S2"])
  })
})

describe("transcriptToSrt", () => {
  it("renders sequential SRT blocks with millisecond timestamps", () => {
    const srt = transcriptToSrt([segment(0, 0.2, 3.5, "第一句"), segment(1, 65, 70, "第二句")])
    const blocks = srt.trim().split("\n\n")
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toContain("00:00:00,200 --> 00:00:03,500")
    expect(blocks[1]).toContain("00:01:05,000 --> 00:01:10,000")
    expect(blocks[0].startsWith("1\n")).toBe(true)
    expect(blocks[1].startsWith("2\n")).toBe(true)
  })

  it("prefixes speaker labels when present", () => {
    const srt = transcriptToSrt([{ ...segment(0, 0, 3, "内容"), speaker: "S1" }])
    expect(srt).toContain("[S1] 内容")
  })
})
