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

const SQL_QA_SEGMENTS: TranscriptSegment[] = [
  { start: 0, end: 3, text: "我们还有一个项目级别的一个 SQL。" },
  { start: 3, end: 5, text: "在发版之前。" },
  { start: 5, end: 8, text: "它一定会走这个 SQL。" },
  { start: 8, end: 11, text: "这个 SQL 里定义了这些 QA。" },
  { start: 11, end: 15, text: "执行的时候会用到 Playwright 来操作页面。" },
]

const SQL_QA_WITH_DISTRACTORS: TranscriptSegment[] = [
  { start: 0, end: 3, text: "从 AI Coding 到成为 Agent 工程师的实战篇。" },
  { start: 3, end: 6, text: "更偏向于是从0到1的这样的一个项目开发。" },
  ...SQL_QA_SEGMENTS.map((segment) => ({
    ...segment,
    start: segment.start + 6,
    end: segment.end + 6,
  })),
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
    expect(index.items[0]?.terms.length).toBeGreaterThan(0)

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

  it("retrieves merged context for multi-segment SQL and QA workflow questions", () => {
    const service = new RetrievalIndexService(
      new EmbeddingRuntimeService(),
      new RerankRuntimeService(),
    )

    const index = service.buildIndex({
      taskId: "task-vqa-sql-qa",
      taskTitle: "Fixture SQL QA Task",
      transcriptSegments: SQL_QA_SEGMENTS,
      transcriptText: SQL_QA_SEGMENTS.map((segment) => segment.text).join("\n"),
    })

    const result = service.searchIndex({
      index,
      queryText: "项目级 SQL / QA 流程是怎么工作的",
      topK: 3,
      rerankTopN: 2,
    })

    expect(result.rerankedHits[0]?.text).toContain("发版之前")
    expect(result.rerankedHits[0]?.text).toContain("QA")
    expect(result.rerankedHits[0]?.text).toContain("Playwright")
  })

  it("ranks SQL and QA workflow evidence ahead of generic AI Coding context", () => {
    const service = new RetrievalIndexService(
      new EmbeddingRuntimeService(),
      new RerankRuntimeService(),
    )

    const index = service.buildIndex({
      taskId: "task-vqa-sql-qa-ranking",
      taskTitle: "Fixture SQL QA Ranking Task",
      transcriptSegments: SQL_QA_WITH_DISTRACTORS,
      transcriptText: SQL_QA_WITH_DISTRACTORS.map((segment) => segment.text).join("\n"),
    })

    const result = service.searchIndex({
      index,
      queryText: "项目级 SQL / QA 流程是怎么工作的",
      topK: 5,
      rerankTopN: 3,
    })

    expect(result.rerankedHits[0]?.text).toContain("项目级别")
    expect(result.rerankedHits[0]?.text).toContain("QA")
  })
})
