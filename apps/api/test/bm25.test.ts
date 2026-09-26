import { describe, expect, it } from "vitest"

import { buildBm25Index, searchBm25 } from "../src/retrieval/bm25.js"

const DOCUMENTS = [
  { id: "a", text: "探索者使用 GPT-6 Luna 模型，默认 Fast 模式，用于快速定位需要修改的代码位置。" },
  { id: "b", text: "Reviewer 角色负责代码审查，关注过度复杂、组件化不足等问题。" },
  { id: "c", text: "Simplify 规范用于批量编码后的多角度审查，可以并行多个子 Agent。" },
]

describe("bm25", () => {
  const index = buildBm25Index(DOCUMENTS)

  it("ranks the document containing the query term first", () => {
    const results = searchBm25(index, "代码审查")
    expect(results[0].id).toBe("b")
  })

  it("matches latin keywords case-insensitively", () => {
    const results = searchBm25(index, "simplify")
    expect(results[0].id).toBe("c")
  })

  it("boosts documents that match in extra fields", () => {
    const withExtras = buildBm25Index([
      { id: "a", text: "普通正文内容", extras: ["这段内容能回答：什么是向量检索？"] },
      { id: "b", text: "另一段正文内容" },
    ])
    const results = searchBm25(withExtras, "向量检索")
    expect(results[0].id).toBe("a")
  })

  it("returns nothing for an unmatched query", () => {
    expect(searchBm25(index, "完全无关的词汇 xyzzy")).toEqual([])
  })

  it("returns nothing for an empty query", () => {
    expect(searchBm25(index, "   ")).toEqual([])
  })

  it("honours the result limit", () => {
    const results = searchBm25(index, "代码", 1)
    expect(results).toHaveLength(1)
  })
})
