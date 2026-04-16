import { describe, expect, it } from "vitest"

import type { TranscriptSegment } from "@vidgnost/contracts"

import { EmbeddingRuntimeService } from "../src/modules/vqa/embedding-runtime-service.js"
import { RetrievalIndexService } from "../src/modules/vqa/retrieval-index-service.js"
import { RerankRuntimeService } from "../src/modules/vqa/rerank-runtime-service.js"

const SEGMENTS: TranscriptSegment[] = [
  { start: 0, end: 6, text: "用户体验设计要围绕真实用户目标展开。" },
  { start: 6, end: 12, text: "交互设计需要结合具体场景进行验证。" },
  { start: 12, end: 18, text: "核心目标是让用户更快完成关键任务。" },
  { start: 18, end: 25, text: "好的信息架构可以降低理解成本。" },
]

describe("RetrievalIndexService", () => {
  it("builds a persistent vector index and returns reranked hits", () => {
    const service = new RetrievalIndexService(
      new EmbeddingRuntimeService(),
      new RerankRuntimeService(),
    )

    const index = service.buildIndex({
      taskId: "task-vqa-unit",
      taskTitle: "Fixture VQA Task",
      transcriptSegments: SEGMENTS,
      transcriptText: SEGMENTS.map((segment) => segment.text).join("\n"),
    })

    expect(index.items.length).toBeGreaterThan(0)
    expect(index.indexJson).toContain("\"vector\"")

    const result = service.searchIndex({
      index,
      queryText: "用户体验设计的核心目标是什么",
      topK: 3,
      rerankTopN: 2,
    })

    expect(result.retrievalMode).toBe("vector-index")
    expect(result.initialHits.length).toBeGreaterThan(0)
    expect(result.rerankedHits[0]?.text).toContain("更快完成关键任务")
    expect(result.rerankedHits.length).toBeLessThanOrEqual(2)
  })
})
