import type { ExportRecord, StudyPack, StudyPreview, StudyState, StudyWorkbenchResponse } from "@vidgnost/contracts"

import type { StoredTaskRecord } from "../tasks/task-repository.js"
import { normalizeSourceType, parseTranscriptSegments, toPublicTaskStatus } from "../tasks/task-support.js"
import type { StudyWorkspaceDraft } from "./study-workspace-types.js"

export class StudyWorkspaceService {
  buildWorkspace(input: {
    exportRecords: ExportRecord[]
    noteCount: number
    state: StudyState
    studyPack: StudyPack
    subtitleTracks: StudyWorkspaceDraft["subtitle_tracks"]
    task: StoredTaskRecord
    translationRecords: StudyWorkspaceDraft["translation_records"]
  }): StudyWorkspaceDraft {
    const task = input.task
    const updatedAt = normalizeTimestamp(task.updated_at || task.created_at)
    const preview = buildStudyPreview({
      noteCount: input.noteCount,
      state: input.state,
      studyPack: input.studyPack,
      task,
      exportRecords: input.exportRecords,
    })

    return {
      export_records: input.exportRecords,
      preview,
      study_pack: input.studyPack,
      study_state: input.state,
      subtitle_tracks: input.subtitleTracks,
      task: buildWorkbenchTask(task, updatedAt),
      translation_records: input.translationRecords,
    }
  }
}

export function buildDefaultStudyState(): StudyState {
  return {
    playback_position_seconds: 0,
    selected_theme_id: null,
    active_highlight_id: null,
    last_selected_subtitle_track_id: null,
    is_favorite: false,
    last_opened_at: null,
  }
}

export function buildStudyPreview(input: {
  exportRecords: ExportRecord[]
  noteCount: number
  state: StudyState
  studyPack: StudyPack
  task: StoredTaskRecord
}): StudyPreview {
  return {
    readiness: resolveStudyReadiness(input.task, input.studyPack),
    generation_tier: input.studyPack.generation_tier,
    highlight_count: input.studyPack.highlights.length,
    question_count: input.studyPack.questions.length,
    note_count: input.noteCount,
    is_favorite: input.state.is_favorite,
    last_opened_at: input.state.last_opened_at,
    last_exported_at: input.exportRecords[0]?.created_at ?? null,
  }
}

function buildWorkbenchTask(task: StoredTaskRecord, updatedAt: string): StudyWorkbenchResponse["task"] {
  return {
    id: String(task.id || ""),
    title: normalizeNullableString(task.title),
    workflow: String(task.workflow || "").trim().toLowerCase() === "vqa" ? "vqa" : "notes",
    source_type: normalizeSourceType(task.source_type),
    source_input: String(task.source_input || ""),
    source_local_path: normalizeNullableString(task.source_local_path),
    language: String(task.language || "zh").trim() || "zh",
    duration_seconds: normalizeNullableNumber(task.duration_seconds),
    status: toPublicTaskStatus(task.status),
    progress: clampProgress(task.progress),
    updated_at: updatedAt,
  }
}

export function buildStudyPack(
  task: StoredTaskRecord,
  segments: ReturnType<typeof parseTranscriptSegments>,
  updatedAt: string,
): StudyPack {
  const taskId = String(task.id || "")
  const taskTitle = String(task.title || task.id || "学习任务").trim() || "学习任务"
  const highlights = segments.slice(0, 3).map((segment, index) => ({
    id: `highlight-${index + 1}`,
    title: `重点片段 ${index + 1}`,
    summary: segment.text,
    start_seconds: segment.start,
    end_seconds: segment.end,
    order: index,
    transcript_text: segment.text,
  }))
  const themes = segments.slice(0, 2).map((segment, index) => ({
    id: `theme-${index + 1}`,
    title: index === 0 ? "学习目标" : "方法要点",
    summary: segment.text,
    order: index,
  }))
  const questions = [
    {
      id: "question-1",
      question: `这段内容最值得优先复习的结论是什么？参考：${segments[0]?.text || "本视频"}`,
      order: 0,
      theme_id: themes[0]?.id ?? null,
    },
    {
      id: "question-2",
      question: `如果要把方法落地，应该先从哪一步开始？参考：${segments[1]?.text || segments[0]?.text || "本视频"}`,
      order: 1,
      theme_id: themes[1]?.id ?? themes[0]?.id ?? null,
    },
  ]
  const quotes = segments.slice(0, 2).map((segment, index) => ({
    id: `quote-${index + 1}`,
    quote: segment.text,
    speaker: segment.speaker ?? null,
    start_seconds: segment.start,
    end_seconds: segment.end,
    order: index,
    theme_id: themes[index]?.id ?? null,
  }))

  return {
    task_id: taskId,
    overview:
      highlights[0]?.summary ||
      `${taskTitle} 的学习内容已整理为 transcript-first 学习包，可直接进入学习模式继续浏览与提问。`,
    generation_tier: "heuristic",
    readiness: resolveStudyReadiness(task),
    fallback_used: false,
    highlights,
    themes,
    questions,
    quotes,
    generated_at: updatedAt,
  }
}

function resolveStudyReadiness(task: StoredTaskRecord, studyPack?: StudyPack): StudyPack["readiness"] {
  const status = toPublicTaskStatus(task.status)
  if (status === "failed" || status === "cancelled") {
    return studyPack && studyPack.highlights.length > 0 ? "degraded" : "failed"
  }
  if (studyPack && studyPack.highlights.length > 0) {
    return "ready"
  }
  if (String(task.transcript_text || "").trim() || String(task.transcript_segments_json || "").trim()) {
    return status === "completed" ? "ready" : "degraded"
  }
  return "pending"
}

function normalizeTimestamp(value: unknown): string {
  const parsed = Date.parse(String(value || "").trim())
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString()
}

function clampProgress(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const candidate = String(value)
  return candidate.length > 0 ? candidate : null
}

function normalizeNullableNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
