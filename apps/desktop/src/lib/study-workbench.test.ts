import { describe, expect, it } from "vitest"

import {
  buildKnowledgeLibraryExportDocument,
  buildKnowledgeNoteCreatePayload,
  buildStudyStateUpdatePayload,
  normalizeKnowledgeLibrary,
  normalizeStudyPreview,
  normalizeStudyWorkspace,
  resolveKnowledgeNoteContext,
  resolveStudyPlaybackSource,
  resolveSubtitleTrackSelection,
} from "./study-workbench"

describe("study-workbench normalization", () => {
  it("normalizes contracts study preview fields for history and workspace headers", () => {
    const preview = normalizeStudyPreview({
      readiness: "ready",
      generation_tier: "llm",
      highlight_count: 6,
      question_count: 4,
      note_count: 3,
      is_favorite: true,
      last_opened_at: "2026-04-20T08:00:00.000Z",
      last_exported_at: "2026-04-20T09:00:00.000Z",
    })

    expect(preview.readiness).toBe("ready")
    expect(preview.generationTier).toBe("llm")
    expect(preview.highlightCount).toBe(6)
    expect(preview.questionCount).toBe(4)
    expect(preview.noteCount).toBe(3)
    expect(preview.isFavorite).toBe(true)
    expect(preview.lastOpenedAt).toBe("2026-04-20T08:00:00.000Z")
    expect(preview.lastExportedAt).toBe("2026-04-20T09:00:00.000Z")
  })

  it("maps legacy study preview payloads into the normalized shape", () => {
    const preview = normalizeStudyPreview({
      task_id: "task-legacy",
      task_title: "Legacy Study Task",
      generation_tier: "transcript_study",
      highlight_count: 2,
      overview: "一段遗留学习概览",
    })

    expect(preview.readiness).toBe("ready")
    expect(preview.generationTier).toBe("transcript_study")
    expect(preview.highlightCount).toBe(2)
    expect(preview.questionCount).toBe(0)
    expect(preview.noteCount).toBe(0)
    expect(preview.overview).toBe("一段遗留学习概览")
  })

  it("maps degraded and failed readiness to non-ready states", () => {
    expect(normalizeStudyPreview({ readiness: "degraded" }).readiness).toBe("missing")
    expect(normalizeStudyPreview({ readiness: "failed" }).readiness).toBe("missing")
    expect(normalizeStudyPreview({ readiness: "pending" }).readiness).toBe("processing")
  })

  it("normalizes current study-pack route payloads into a study workspace model", () => {
    const workspace = normalizeStudyWorkspace({
      task_id: "task-study-pack",
      pack: {
        overview: "学习概览",
        generation_tier: "transcript_study",
        highlights: [
          { id: "highlight-1", summary: "高亮摘要", start: 12, end: 30 },
        ],
        themes: [
          { id: "theme-1", title: "核心主题", summary: "主题摘要" },
        ],
        questions: [
          { id: "question-1", prompt: "这一段的重点是什么？" },
        ],
        quotes: [
          { id: "quote-1", text: "关键引用", start: 14, end: 18 },
        ],
        subtitle_tracks: {
          default_track_id: "track-1",
          tracks: [
            {
              track_id: "track-1",
              label: "中文字幕",
              language: "zh",
              kind: "platform_translation",
              cues: [],
            },
          ],
        },
        translation: {
          mode: "platform_track",
          target_language: "zh",
        },
      },
      state: {
        active_highlight_id: "highlight-1",
        last_position_seconds: 96,
        last_selected_subtitle_track_id: "track-1",
        selected_theme_id: "theme-1",
      },
    })

    expect(workspace.studyPack.overview).toBe("学习概览")
    expect(workspace.studyPack.generationTier).toBe("transcript_study")
    expect(workspace.studyPack.highlights[0]?.startSeconds).toBe(12)
    expect(workspace.studyPack.questions[0]?.question).toBe("这一段的重点是什么？")
    expect(workspace.studyPack.quotes[0]?.text).toBe("关键引用")
    expect(workspace.subtitleTracks[0]?.id).toBe("track-1")
    expect(workspace.studyState.playbackPositionSeconds).toBe(96)
    expect(workspace.studyState.selectedSubtitleTrackId).toBe("track-1")
  })

  it("normalizes contracts study workspace responses with study_pack and subtitle_tracks", () => {
    const workspace = normalizeStudyWorkspace({
      task: {
        id: "task-contracts-study-pack",
        title: "Contracts Study Task",
        workflow: "notes",
        source_type: "youtube",
        source_input: "https://example.com/video",
        source_local_path: null,
        language: "zh",
        duration_seconds: 180,
        status: "completed",
        progress: 100,
        updated_at: "2026-04-20T09:00:00.000Z",
      },
      preview: {
        readiness: "ready",
        generation_tier: "llm",
        highlight_count: 1,
        question_count: 1,
        note_count: 2,
        is_favorite: true,
        last_opened_at: "2026-04-20T09:00:00.000Z",
        last_exported_at: null,
      },
      study_pack: {
        task_id: "task-contracts-study-pack",
        overview: "正式 contracts 学习概览",
        generation_tier: "llm",
        readiness: "ready",
        fallback_used: false,
        generated_at: "2026-04-20T09:00:00.000Z",
        highlights: [
          {
            id: "highlight-1",
            title: "重点 1",
            summary: "高亮摘要",
            start_seconds: 12,
            end_seconds: 30,
            order: 0,
            transcript_text: "高亮原文",
          },
        ],
        themes: [
          { id: "theme-1", title: "核心主题", summary: "主题摘要", order: 0 },
        ],
        questions: [
          { id: "question-1", question: "这一段为什么重要？", order: 0, theme_id: "theme-1" },
        ],
        quotes: [
          {
            id: "quote-1",
            quote: "关键引用",
            speaker: "讲者",
            start_seconds: 14,
            end_seconds: 18,
            order: 0,
            theme_id: "theme-1",
          },
        ],
      },
      subtitle_tracks: [
        {
          task_id: "task-contracts-study-pack",
          track_id: "track-1",
          label: "中文字幕",
          language: "zh",
          kind: "platform_translation",
          availability: "available",
          is_default: true,
          artifact_path: null,
          source_url: null,
          created_at: "2026-04-20T09:00:00.000Z",
          updated_at: "2026-04-20T09:00:00.000Z",
        },
      ],
      translation_records: [
        {
          id: "translation-1",
          task_id: "task-contracts-study-pack",
          source: "platform_track",
          status: "ready",
          target: { language: "en", label: "English" },
          subtitle_track_id: "track-1",
          artifact_path: null,
          created_at: "2026-04-20T09:00:00.000Z",
          updated_at: "2026-04-20T09:00:00.000Z",
        },
      ],
      study_state: {
        playback_position_seconds: 88,
        selected_theme_id: "theme-1",
        active_highlight_id: "highlight-1",
        is_favorite: true,
        last_selected_subtitle_track_id: "track-1",
        last_opened_at: "2026-04-20T09:00:00.000Z",
      },
      export_records: [
        {
          id: "export-1",
          task_id: "task-contracts-study-pack",
          export_kind: "study_pack",
          format: "md",
          file_path: "exports/study-pack.md",
          created_at: "2026-04-20T09:05:00.000Z",
        },
      ],
    })

    expect(workspace.taskId).toBe("task-contracts-study-pack")
    expect(workspace.taskTitle).toBe("Contracts Study Task")
    expect(workspace.preview.noteCount).toBe(2)
    expect(workspace.studyPack.overview).toBe("正式 contracts 学习概览")
    expect(workspace.studyPack.highlights[0]?.title).toBe("重点 1")
    expect(workspace.studyPack.questions[0]?.themeId).toBe("theme-1")
    expect(workspace.studyPack.quotes[0]?.speaker).toBe("讲者")
    expect(workspace.subtitleTracks[0]?.isDefault).toBe(true)
    expect(workspace.studyState.playbackPositionSeconds).toBe(88)
    expect(workspace.studyState.selectedSubtitleTrackId).toBe("track-1")
    expect(workspace.translationRecords[0]?.target?.language).toBe("en")
    expect(workspace.exportRecords[0]?.exportKind).toBe("study_pack")
  })

  it("normalizes knowledge library payloads into editable note models", () => {
    const library = normalizeKnowledgeLibrary({
      items: [
        {
          id: "note-1",
          task_id: "task-1",
          study_theme_id: "theme-1",
        source_type: "local_file",
        source_kind: "highlight",
        title: "知识卡片标题",
        excerpt: "摘录正文",
        note_markdown: "补充笔记",
        source_start_seconds: 12,
        source_end_seconds: 18,
        source_reference_id: "highlight-1",
        source_reference_label: "重点片段 1",
        tags: ["重点", "复习"],
        created_at: "2026-04-20T08:00:00.000Z",
        updated_at: "2026-04-20T09:00:00.000Z",
      },
      ],
      total: 1,
      filters: { task_id: "task-1" },
      export_records: [],
    })

    expect(library.total).toBe(1)
    expect(library.items[0]?.title).toBe("知识卡片标题")
    expect(library.items[0]?.excerpt).toBe("摘录正文")
    expect(library.items[0]?.noteMarkdown).toBe("补充笔记")
    expect(library.items[0]?.studyThemeId).toBe("theme-1")
    expect(library.items[0]?.sourceStartSeconds).toBe(12)
    expect(library.items[0]?.sourceEndSeconds).toBe(18)
    expect(library.items[0]?.sourceReferenceId).toBe("highlight-1")
    expect(library.items[0]?.sourceReferenceLabel).toBe("重点片段 1")
  })

  it("builds a front-end knowledge export document for current filtered results", () => {
    const document = buildKnowledgeLibraryExportDocument({
      exportedAt: "2026-04-20T12:30:00.000Z",
      scopeLabel: "全部任务",
      sourceFilterLabel: "重点片段",
      notes: [
        {
          id: "note-1",
          taskId: "task-1",
          title: "知识卡片标题",
          excerpt: "摘录正文",
          noteMarkdown: "补充笔记",
          sourceKind: "highlight",
          studyThemeId: "theme-1",
          sourceStartSeconds: 12,
          sourceEndSeconds: 18,
          sourceReferenceId: "highlight-1",
          sourceReferenceLabel: "重点片段 1",
          tags: ["重点", "复习"],
          createdAt: "2026-04-20T08:00:00.000Z",
          updatedAt: "2026-04-20T09:00:00.000Z",
        },
      ],
    })

    expect(document.fileName).toContain("knowledge-library")
    expect(document.mimeType).toBe("text/markdown;charset=utf-8")
    expect(document.content).toContain("范围：全部任务")
    expect(document.content).toContain("来源过滤：重点片段")
    expect(document.content).toContain("知识卡片数：1")
    expect(document.content).toContain("任务：task-1")
    expect(document.content).toContain("时间上下文：0:12 - 0:18")
    expect(document.content).toContain("引用上下文：重点片段 1")
    expect(document.content).toContain("知识卡片标题")
  })

  it("builds study state patch payloads including subtitle track selection", () => {
    expect(
      buildStudyStateUpdatePayload({
        is_favorite: true,
        last_opened_at: "2026-04-20T10:30:00.000Z",
        playback_position_seconds: 24,
        selected_theme_id: "theme-1",
        active_highlight_id: "highlight-1",
        last_selected_subtitle_track_id: "track-1",
      }),
    ).toEqual({
      is_favorite: true,
      last_opened_at: "2026-04-20T10:30:00.000Z",
      playback_position_seconds: 24,
      last_position_seconds: 24,
      selected_theme_id: "theme-1",
      active_highlight_id: "highlight-1",
      last_selected_subtitle_track_id: "track-1",
    })
  })

  it("builds knowledge note payloads with study timestamp and reference context", () => {
    expect(
      buildKnowledgeNoteCreatePayload({
        taskId: "task-1",
        title: "知识卡片标题",
        excerpt: "摘录正文",
        noteMarkdown: "补充笔记",
        sourceKind: "highlight",
        studyThemeId: "theme-1",
        sourceStartSeconds: 12,
        sourceEndSeconds: 18,
        sourceReferenceId: "highlight-1",
        sourceReferenceLabel: "重点片段 1",
        tags: ["重点", "复习"],
      }),
    ).toEqual({
      task_id: "task-1",
      title: "知识卡片标题",
      excerpt: "摘录正文",
      note_markdown: "补充笔记",
      source_kind: "highlight",
      study_theme_id: "theme-1",
      source_start_seconds: 12,
      source_end_seconds: 18,
      source_reference_id: "highlight-1",
      source_reference_label: "重点片段 1",
      tags: ["重点", "复习"],
    })
  })

  it("defaults missing knowledge note context fields to null for legacy payloads", () => {
    const library = normalizeKnowledgeLibrary({
      items: [
        {
          id: "legacy-note",
          task_id: "task-1",
          study_theme_id: null,
          source_type: "local_file",
          source_kind: "manual",
          title: "历史知识卡片",
          excerpt: "旧 payload 没有上下文。",
          note_markdown: null,
          tags: [],
          created_at: "2026-04-20T08:00:00.000Z",
          updated_at: "2026-04-20T09:00:00.000Z",
        },
      ],
      total: 1,
      filters: {},
      export_records: [],
    })

    expect(library.items[0]).toMatchObject({
      sourceStartSeconds: null,
      sourceEndSeconds: null,
      sourceReferenceId: null,
      sourceReferenceLabel: null,
    })
  })

  it("does not fabricate zero-second context when no study focus is selected", () => {
    expect(resolveKnowledgeNoteContext({
      studyPack: {
        overview: "",
        generationTier: "heuristic",
        readiness: "ready",
        fallbackUsed: false,
        highlights: [],
        themes: [
          {
            id: "theme-1",
            title: "核心主题",
            summary: "主题摘要",
            order: 0,
          },
        ],
        questions: [],
        quotes: [],
      },
      studyState: {
        playbackPositionSeconds: 0,
        selectedThemeId: "theme-1",
        activeHighlightId: null,
        selectedSubtitleTrackId: null,
        isFavorite: false,
        lastOpenedAt: null,
      },
    })).toEqual({
      sourceStartSeconds: null,
      sourceEndSeconds: null,
      sourceReferenceId: "theme-1",
      sourceReferenceLabel: "核心主题",
    })
  })

  it("prefers persisted subtitle selection before falling back to translation-target matches", () => {
    const workspace = normalizeStudyWorkspace({
      task: {
        id: "task-study-selection",
        title: "Selection Task",
        workflow: "notes",
        source_type: "youtube",
        source_input: "https://youtu.be/demo-study-selection",
        source_local_path: null,
        language: "zh",
        duration_seconds: 180,
        status: "completed",
        progress: 100,
        updated_at: "2026-04-20T09:00:00.000Z",
      },
      preview: {
        readiness: "ready",
        generation_tier: "heuristic",
        highlight_count: 0,
        question_count: 0,
        note_count: 0,
        is_favorite: false,
        last_opened_at: null,
        last_exported_at: null,
      },
      study_pack: {
        task_id: "task-study-selection",
        overview: "学习概览",
        generation_tier: "heuristic",
        readiness: "ready",
        fallback_used: false,
        highlights: [],
        themes: [],
        questions: [],
        quotes: [],
        generated_at: "2026-04-20T09:00:00.000Z",
      },
      subtitle_tracks: [
        {
          task_id: "task-study-selection",
          track_id: "track-zh",
          label: "中文字幕",
          language: "zh",
          kind: "whisper",
          availability: "generated",
          is_default: true,
          artifact_path: "subtitle/zh.vtt",
          source_url: null,
          created_at: "2026-04-20T09:00:00.000Z",
          updated_at: "2026-04-20T09:00:00.000Z",
        },
        {
          task_id: "task-study-selection",
          track_id: "track-en",
          label: "English",
          language: "en",
          kind: "platform_translation",
          availability: "available",
          is_default: false,
          artifact_path: null,
          source_url: "https://example.com/subtitle-en.vtt",
          created_at: "2026-04-20T09:00:00.000Z",
          updated_at: "2026-04-20T09:00:00.000Z",
        },
      ],
      translation_records: [],
      study_state: {
        playback_position_seconds: 0,
        selected_theme_id: null,
        active_highlight_id: null,
        is_favorite: false,
        last_selected_subtitle_track_id: "track-en",
        last_opened_at: null,
      },
      export_records: [],
    })

    expect(resolveSubtitleTrackSelection(workspace, "ja")).toBe("track-en")
    expect(resolveSubtitleTrackSelection({
      ...workspace,
      studyState: {
        ...workspace.studyState,
        selectedSubtitleTrackId: null,
      },
    }, "en")).toBe("track-en")
  })

  it("builds playback sources for remote iframe tasks and local files", () => {
    expect(resolveStudyPlaybackSource({
      id: "task-youtube",
      source_type: "youtube",
      source_input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      source_local_path: null,
    }, "/api/tasks/task-youtube/source-media", 37)).toEqual({
      kind: "remote-iframe",
      provider: "youtube",
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0&start=37",
    })

    expect(resolveStudyPlaybackSource({
      id: "task-bilibili",
      source_type: "bilibili",
      source_input: "https://www.bilibili.com/video/BV1xx411c7mD",
      source_local_path: null,
    }, "/api/tasks/task-bilibili/source-media", 12)).toEqual({
      kind: "remote-iframe",
      provider: "bilibili",
      src: "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&page=1&autoplay=0&t=12",
    })

    expect(resolveStudyPlaybackSource({
      id: "task-local",
      source_type: "local_file",
      source_input: "F:/fixtures/local.mp4",
      source_local_path: "F:/fixtures/local.mp4",
    }, "/api/tasks/task-local/source-media")).toEqual({
      kind: "local-video",
      src: "/api/tasks/task-local/source-media",
    })
  })
})
