import { describe, expect, it } from "vitest"

import { extractJson } from "../src/core/text.js"
import { chapterArrayOf, type OutlinePayload } from "../src/insight/outline-service.js"

/**
 * 章节解析的兼容性约束：模型可能返回 `{chapters:[...]}`、裸数组，
 * 或换用 `items` / `outline` 作为键名。三种形状都必须被接受，
 * 否则整段章节结果会被静默丢弃并退化为按段落切分的兜底结果。
 */
describe("chapterArrayOf", () => {
  it("accepts the documented object shape", () => {
    const parsed = extractJson<OutlinePayload>('{"chapters":[{"startParagraphId":"p0001","title":"A"}]}')
    expect(chapterArrayOf(parsed)).toHaveLength(1)
  })

  it("accepts a bare array, which some models return for json_object requests", () => {
    const parsed = extractJson<OutlinePayload>(
      '[{"startParagraphId":"p0001","title":"A"},{"startParagraphId":"p0002","title":"B"}]',
    )
    expect(chapterArrayOf(parsed)).toHaveLength(2)
  })

  it("accepts alternate key names", () => {
    expect(chapterArrayOf(extractJson<OutlinePayload>('{"items":[{"title":"A"}]}'))).toHaveLength(1)
    expect(chapterArrayOf(extractJson<OutlinePayload>('{"outline":[{"title":"A"}]}'))).toHaveLength(1)
  })

  it("returns nothing for unrelated payloads", () => {
    expect(chapterArrayOf(extractJson<OutlinePayload>('{"result":"ok"}'))).toEqual([])
    expect(chapterArrayOf(null)).toEqual([])
  })

  it("keeps an empty chapters array empty", () => {
    expect(chapterArrayOf(extractJson<OutlinePayload>('{"chapters":[]}'))).toEqual([])
  })
})
