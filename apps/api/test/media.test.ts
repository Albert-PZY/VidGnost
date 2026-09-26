import { describe, expect, it } from "vitest"

import { detectPlatform, isHttpUrl } from "../src/media/media-service.js"
import { dedupeByHash, dHash, hammingDistance } from "../src/media/perceptual-hash.js"

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://www.bilibili.com/video/BV1xx")).toBe(true)
    expect(isHttpUrl("http://127.0.0.1:8666/a.mp4")).toBe(true)
  })

  it("rejects local paths and file urls", () => {
    expect(isHttpUrl("F:\\videos\\a.mp4")).toBe(false)
    expect(isHttpUrl("file:///F:/videos/a.mp4")).toBe(false)
    expect(isHttpUrl("")).toBe(false)
  })
})

describe("detectPlatform", () => {
  it("detects youtube", () => {
    expect(detectPlatform("https://www.youtube.com/watch?v=abc")).toBe("youtube")
    expect(detectPlatform("https://youtu.be/abc")).toBe("youtube")
  })

  it("detects bilibili", () => {
    expect(detectPlatform("https://www.bilibili.com/video/BV1xx")).toBe("bilibili")
    expect(detectPlatform("https://b23.tv/abcd")).toBe("bilibili")
  })

  it("detects direct media links", () => {
    expect(detectPlatform("https://cdn.example.com/lesson.mp4")).toBe("direct")
  })

  it("falls back to other for unknown hosts", () => {
    expect(detectPlatform("https://example.com/watch/123")).toBe("other")
    expect(detectPlatform("not a url")).toBe("other")
  })
})

describe("hammingDistance", () => {
  it("counts differing bits", () => {
    expect(hammingDistance(0b1010n, 0b1000n)).toBe(1)
    expect(hammingDistance(0n, 0n)).toBe(0)
    expect(hammingDistance(0b111n, 0n)).toBe(3)
  })
})

describe("dHash", () => {
  it("is stable for identical input", () => {
    const buffer = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251))
    expect(dHash(buffer)).toBe(dHash(buffer))
  })

  it("returns the same top bit for the same first comparison", () => {
    const rising = Buffer.alloc(1024, 0)
    rising[0] = 10
    rising[1] = 5
    expect(dHash(rising) & 1n).toBe(1n)
  })

  it("handles buffers shorter than the sample count", () => {
    expect(() => dHash(Buffer.from([1, 2, 3]))).not.toThrow()
  })
})

describe("dedupeByHash", () => {
  const near = (value: bigint) => ({ hash: value, time: 0 })

  it("keeps the first item unconditionally", () => {
    const items = [near(0n), near(0n)]
    expect(dedupeByHash(items, 10)).toHaveLength(1)
  })

  it("keeps items that differ enough", () => {
    const items = [near(0n), near(0b111111111111n), near(0b111111111111111111111111n)]
    expect(dedupeByHash(items, 10)).toHaveLength(3)
  })

  it("respects the maximum item count", () => {
    const items = Array.from({ length: 20 }, (_, index) => near(BigInt(index) * 0b1111111111111111n))
    expect(dedupeByHash(items, 3).length).toBeLessThanOrEqual(3)
  })

  it("returns nothing for empty input", () => {
    expect(dedupeByHash([], 5)).toEqual([])
  })
})
