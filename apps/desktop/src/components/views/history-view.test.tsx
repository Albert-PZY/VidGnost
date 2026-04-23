import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { HistoryTaskStudyCard } from "./history-view"
import type { TaskSummaryItem } from "@/lib/types"

const task = {
  id: "task-history-card",
  title: "Study Library Task",
  workflow: "notes",
  source_type: "youtube",
  source_input: "https://example.com/video",
  source_local_path: null,
  language: "zh",
  duration_seconds: 540,
  status: "completed",
  progress: 100,
  created_at: "2026-04-20T08:00:00.000Z",
  updated_at: "2026-04-20T11:00:00.000Z",
  file_size_bytes: 1024,
  study_preview: {
    readiness: "ready",
    generation_tier: "llm",
    highlight_count: 4,
    question_count: 3,
    note_count: 5,
    is_favorite: true,
    last_opened_at: "2026-04-20T10:30:00.000Z",
    last_exported_at: "2026-04-20T11:00:00.000Z",
  },
} as TaskSummaryItem

describe("HistoryTaskStudyCard", () => {
  it("renders note count, export status, favorite state and continue-learning cues", () => {
    const html = renderToStaticMarkup(
      <HistoryTaskStudyCard
        task={task}
        selectionMode={false}
        isSelected={false}
        busyTaskId=""
        onOpenTask={vi.fn()}
        onExportTask={vi.fn()}
        onOpenLocation={vi.fn()}
        onRequestDelete={vi.fn()}
        onToggleTaskSelection={vi.fn()}
      />,
    )

    expect(html).toContain("知识卡片 5")
    expect(html).toContain("最近导出")
    expect(html).toContain("继续学习")
    expect(html).toContain("已收藏")
  })
})
