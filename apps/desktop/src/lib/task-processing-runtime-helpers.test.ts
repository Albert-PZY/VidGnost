import { describe, expect, it } from "vitest"

import {
  EMPTY_RUNTIME_TRANSCRIPT_INDEX,
  buildTranscriptSegmentKey,
  mergeTranscriptIndexState,
  resolveDisplayedCorrectionSegments,
} from "./task-processing-runtime-helpers"

describe("task-processing-runtime-helpers", () => {
  it("keeps timestamp keys unique for millisecond-different transcript segments", () => {
    const first = { start: 1.2341, end: 2.3451 }
    const second = { start: 1.2344, end: 2.3454 }

    expect(buildTranscriptSegmentKey(first)).not.toBe(buildTranscriptSegmentKey(second))

    const merged = mergeTranscriptIndexState(EMPTY_RUNTIME_TRANSCRIPT_INDEX, [
      { ...first, text: "第一段" },
      { ...second, text: "第二段" },
    ])

    expect(merged.order).toHaveLength(2)
    expect(Object.keys(merged.byKey)).toHaveLength(2)
  })

  it("keeps correction result empty until timestamp-aligned preview segments arrive", () => {
    const transcriptSegments = [
      { start: 0, end: 1.2, text: "原始片段" },
    ]

    expect(
      resolveDisplayedCorrectionSegments({
        correctionMode: "rewrite",
        correctionPreviewSegments: [],
        transcriptSegments,
      }),
    ).toEqual([])

    expect(
      resolveDisplayedCorrectionSegments({
        correctionMode: "rewrite",
        correctionPreviewSegments: [{ start: 0, end: 1.2, text: "修正片段" }],
        transcriptSegments,
      }),
    ).toEqual([{ start: 0, end: 1.2, text: "修正片段" }])
  })
})
