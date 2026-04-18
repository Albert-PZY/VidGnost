import { describe, expect, it } from "vitest"

import { planAudioChunks } from "../src/modules/asr/audio-chunker.js"

describe("planAudioChunks", () => {
  it("uses a fast-start chunk before capped live chunks for long audio", () => {
    expect(planAudioChunks({
      durationSeconds: 95,
      requestedChunkSeconds: 180,
    })).toEqual([
      { index: 0, startSeconds: 0, durationSeconds: 8 },
      { index: 1, startSeconds: 8, durationSeconds: 30 },
      { index: 2, startSeconds: 38, durationSeconds: 30 },
      { index: 3, startSeconds: 68, durationSeconds: 27 },
    ])
  })

  it("keeps a single chunk when the audio already fits into the effective live chunk window", () => {
    expect(planAudioChunks({
      durationSeconds: 21.235,
      requestedChunkSeconds: 180,
    })).toEqual([
      { index: 0, startSeconds: 0, durationSeconds: 21.235 },
    ])
  })
})
