import { describe, expect, it } from "vitest"

import {
  parseCaptionXmlSegments,
  parseJsonSubtitleSegments,
  parseJson3Segments,
  parseVttSegments,
} from "../src/modules/asr/transcript-segment-normalizer.js"

describe("transcript segment normalizer", () => {
  it("parses webvtt subtitles into transcript segments", () => {
    const rawVtt = `WEBVTT

1
00:00:00.000 --> 00:00:01.500
<c.colorE5E5E5>第一句</c>

2
00:00:01.500 --> 00:00:03.000
第二句
`

    expect(parseVttSegments(rawVtt)).toEqual([
      { start: 0, end: 1.5, text: "第一句" },
      { start: 1.5, end: 3, text: "第二句" },
    ])
  })

  it("parses youtube json3 subtitles into transcript segments", () => {
    const rawJson = JSON.stringify({
      events: [
        {
          dDurationMs: 1200,
          segs: [{ utf8: "第一句" }],
          tStartMs: 0,
        },
        {
          dDurationMs: 1800,
          segs: [{ utf8: "第二句\n" }],
          tStartMs: 1200,
        },
      ],
    })

    expect(parseJson3Segments(rawJson)).toEqual([
      { start: 0, end: 1.2, text: "第一句" },
      { start: 1.2, end: 3, text: "第二句" },
    ])
  })

  it("parses caption xml subtitles into transcript segments", () => {
    const rawXml = `<transcript>
  <text start="0.0" dur="1.5">Hello &amp; world</text>
  <text start="1.5" dur="1.0">第二句</text>
</transcript>`

    expect(parseCaptionXmlSegments(rawXml)).toEqual([
      { start: 0, end: 1.5, text: "Hello & world" },
      { start: 1.5, end: 2.5, text: "第二句" },
    ])
  })

  it("parses bilibili json subtitles into transcript segments", () => {
    const rawJson = JSON.stringify({
      body: [
        {
          content: "第一句",
          from: 0,
          to: 1.5,
        },
        {
          content: "第二句",
          from: 1.5,
          to: 3.2,
        },
      ],
    })

    expect(parseJsonSubtitleSegments(rawJson)).toEqual([
      { start: 0, end: 1.5, text: "第一句" },
      { start: 1.5, end: 3.2, text: "第二句" },
    ])
  })
})
