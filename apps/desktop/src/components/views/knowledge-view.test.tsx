import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { KnowledgeView } from "./knowledge-view"

describe("KnowledgeView", () => {
  it("shows a one-click export action for current filtered results in global mode", () => {
    const html = renderToStaticMarkup(
      <KnowledgeView taskId={null} workspace={null} />,
    )

    expect(html).toContain("导出当前筛选结果")
    expect(html).toContain("当前筛选结果会在前端整理后直接下载")
  })

  it("prompts task-scoped note creation to carry current study context", () => {
    const html = renderToStaticMarkup(
      <KnowledgeView
        taskId="task-knowledge-view"
        workspace={{
          taskId: "task-knowledge-view",
          taskTitle: "Knowledge Task",
          preview: {
            readiness: "ready",
            generationTier: "llm",
            highlightCount: 1,
            questionCount: 0,
            noteCount: 0,
            isFavorite: false,
            lastOpenedAt: "2026-04-20T10:00:00.000Z",
            lastExportedAt: null,
            overview: "学习概览",
          },
          studyPack: {
            overview: "学习概览",
            generationTier: "llm",
            readiness: "ready",
            fallbackUsed: false,
            highlights: [],
            themes: [],
            questions: [],
            quotes: [],
          },
          subtitleTracks: [],
          translationRecords: [],
          studyState: {
            playbackPositionSeconds: 32,
            selectedThemeId: "theme-1",
            activeHighlightId: "highlight-1",
            selectedSubtitleTrackId: null,
            isFavorite: false,
            lastOpenedAt: "2026-04-20T10:00:00.000Z",
          },
          exportRecords: [],
        }}
      />,
    )

    expect(html).toContain("自动附带当前 Study 上下文")
  })
})
