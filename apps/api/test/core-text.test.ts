import { describe, expect, it } from "vitest"

import { estimateTokens, extractJson, formatTimecode, parseTimecode, splitByTokenBudget, splitSentences, tokenize } from "../src/core/text.js"

describe("formatTimecode", () => {
  it("formats under one hour as mm:ss", () => {
    expect(formatTimecode(0)).toBe("00:00")
    expect(formatTimecode(75)).toBe("01:15")
    expect(formatTimecode(599.9)).toBe("09:59")
  })

  it("formats over one hour as h:mm:ss", () => {
    expect(formatTimecode(3725)).toBe("1:02:05")
  })
})

describe("parseTimecode", () => {
  it("parses mm:ss and h:mm:ss", () => {
    expect(parseTimecode("01:15")).toBe(75)
    expect(parseTimecode("1:02:05")).toBe(3725)
    expect(parseTimecode("42")).toBe(42)
  })

  it("returns null for invalid input", () => {
    expect(parseTimecode("abc")).toBeNull()
    expect(parseTimecode("")).toBeNull()
  })
})

describe("tokenize", () => {
  it("keeps latin words and splits CJK runs into bigrams", () => {
    const tokens = tokenize("向量检索 BM25")
    expect(tokens).toEqual(["向量", "量检", "检索", "bm25"])
  })

  it("keeps isolated CJK characters", () => {
    expect(tokenize("量 a")).toEqual(["量", "a"])
  })

  it("does not emit single characters for CJK runs, to avoid noisy matches", () => {
    expect(tokenize("向量检索")).not.toContain("向")
  })

  it("drops punctuation", () => {
    expect(tokenize("a，b。c")).toEqual(["a", "b", "c"])
  })
})

describe("estimateTokens", () => {
  it("counts CJK per character and latin per four characters", () => {
    expect(estimateTokens("中文")).toBe(2)
    expect(estimateTokens("abcdefgh")).toBe(2)
  })
})

describe("splitByTokenBudget", () => {
  it("keeps short text intact", () => {
    expect(splitByTokenBudget("短文本", 100)).toEqual(["短文本"])
  })

  it("splits on paragraph boundaries and respects the budget", () => {
    const text = Array.from({ length: 12 }, (_, index) => `第${index}段内容`.repeat(4)).join("\n\n")
    const chunks = splitByTokenBudget(text, 40)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(estimateTokens(chunk)).toBeLessThanOrEqual(60)
    }
    expect(chunks.join("")).toContain("第0段内容")
  })
})

describe("splitSentences", () => {
  it("splits on CJK sentence punctuation", () => {
    expect(splitSentences("第一句。第二句！第三句？")).toEqual(["第一句。", "第二句！", "第三句？"])
  })
})

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
  })

  it("parses fenced JSON with surrounding text", () => {
    const raw = '这是结果：\n```json\n{"a": [1, 2]}\n```\n以上。'
    expect(extractJson<{ a: number[] }>(raw)).toEqual({ a: [1, 2] })
  })

  it("ignores braces inside strings", () => {
    const raw = '{"text":"包含 } 的花括号","ok":true}'
    expect(extractJson<{ ok: boolean }>(raw)).toEqual({ text: "包含 } 的花括号", ok: true })
  })

  it("returns null when there is no JSON", () => {
    expect(extractJson("没有任何结构")).toBeNull()
  })
})
