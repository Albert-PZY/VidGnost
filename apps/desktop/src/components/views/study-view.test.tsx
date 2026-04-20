import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { StudyView } from "./study-view"
import type { TaskDetailResponse } from "@/lib/types"
import type { NormalizedStudyWorkspace } from "@/lib/study-workbench"

const baseTask = {
  id: "task-study-view",
  title: "Study View Task",
  workflow: "notes",
  source_type: "youtube",
  source_input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  source_local_path: null,
  language: "zh",
  duration_seconds: 180,
  status: "completed",
  progress: 100,
  updated_at: "2026-04-20T10:00:00.000Z",
  study_preview: {
    readiness: "ready",
    generation_tier: "llm",
    highlight_count: 1,
    question_count: 1,
    note_count: 1,
    is_favorite: true,
    last_opened_at: "2026-04-20T10:00:00.000Z",
  },
} as TaskDetailResponse

const baseWorkspace: NormalizedStudyWorkspace = {
  taskId: "task-study-view",
  taskTitle: "Study View Task",
  preview: {
    readiness: "ready",
    generationTier: "llm",
    highlightCount: 1,
    questionCount: 1,
    noteCount: 1,
    isFavorite: true,
    lastOpenedAt: "2026-04-20T10:00:00.000Z",
    lastExportedAt: "2026-04-20T11:00:00.000Z",
    overview: "学习概览",
  },
  studyPack: {
    overview: "学习概览",
    generationTier: "llm",
    readiness: "ready",
    fallbackUsed: false,
    highlights: [
      {
        id: "highlight-1",
        title: "重点片段 1",
        summary: "这是重点摘要",
        startSeconds: 12,
        endSeconds: 24,
        order: 0,
        transcriptText: "重点原文",
      },
    ],
    themes: [
      {
        id: "theme-1",
        title: "主题 1",
        summary: "主题摘要",
        order: 0,
      },
    ],
    questions: [
      {
        id: "question-1",
        question: "为什么这一段很重要？",
        order: 0,
        themeId: "theme-1",
      },
    ],
    quotes: [
      {
        id: "quote-1",
        text: "关键引用",
        speaker: "讲者",
        startSeconds: 13,
        endSeconds: 18,
        order: 0,
        themeId: "theme-1",
      },
    ],
  },
  subtitleTracks: [
    {
      id: "track-zh",
      label: "中文字幕",
      language: "zh",
      kind: "whisper",
      availability: "generated",
      isDefault: true,
      artifactPath: "subtitle/zh.vtt",
      sourceUrl: null,
    },
    {
      id: "track-en",
      label: "English 字幕",
      language: "en",
      kind: "platform_translation",
      availability: "available",
      isDefault: false,
      artifactPath: null,
      sourceUrl: "https://example.com/subtitle-en.vtt",
    },
  ],
  translationRecords: [
    {
      id: "translation-1",
      source: "machine_translation",
      status: "ready",
      subtitleTrackId: "track-en",
      artifactPath: "exports/translation-records.json",
      target: {
        language: "en",
        label: "English",
      },
      createdAt: "2026-04-20T10:10:00.000Z",
      updatedAt: "2026-04-20T10:12:00.000Z",
    },
  ],
  studyState: {
    playbackPositionSeconds: 32,
    selectedThemeId: "theme-1",
    activeHighlightId: "highlight-1",
    selectedSubtitleTrackId: "track-en",
    isFavorite: true,
    lastOpenedAt: "2026-04-20T10:00:00.000Z",
  },
  exportRecords: [
    {
      id: "export-1",
      exportKind: "study_pack",
      format: "md",
      filePath: "exports/study-pack.md",
      createdAt: "2026-04-20T11:00:00.000Z",
    },
  ],
}

describe("StudyView", () => {
  it("renders subtitle tracks, translation records and export records from the workspace payload", () => {
    const html = renderToStaticMarkup(
      <StudyView
        task={baseTask}
        isLoading={false}
        errorMessage=""
        workspace={baseWorkspace}
        defaultTranslationTarget="ja"
        isPersistingStudyState={false}
        onSeek={vi.fn()}
        onSelectSubtitleTrack={vi.fn()}
        onSelectHighlight={vi.fn()}
        onSelectTheme={vi.fn()}
        onToggleFavorite={vi.fn()}
        onExportArtifact={vi.fn()}
      />,
    )

    expect(html).toContain("字幕与翻译")
    expect(html).toContain("中文字幕")
    expect(html).toContain("English 字幕")
    expect(html).toContain("当前已选轨道：English 字幕")
    expect(html).toContain("machine_translation")
    expect(html).toContain("English")
    expect(html).toContain("导出记录")
    expect(html).toContain("exports/study-pack.md")
    expect(html).toContain("导出字幕")
    expect(html).toContain("导出翻译记录")
    expect(html).toContain("当前阅读定位")
    expect(html).toContain("当前 Study 阅读轨道")
    expect(html).toContain("不会直接切换左侧旧转写面板")
    expect(html).toContain("当前主题")
    expect(html).toContain("0:32")
  })
})
