import type {
  KnowledgeLibraryResponse,
  KnowledgeNoteCreateRequest,
  KnowledgeNoteItem,
  KnowledgeNoteUpdateRequest,
  StudyPackResponse,
  StudyPreview,
  StudyStateUpdateRequest,
  TaskDetailResponse,
  TaskRecentItem,
  TaskSummaryItem,
} from "./types"
import { formatSecondsAsClock } from "./format"

export interface NormalizedStudyPreview {
  readiness: "ready" | "processing" | "missing"
  generationTier: string
  highlightCount: number
  questionCount: number
  noteCount: number
  isFavorite: boolean
  lastOpenedAt: string | null
  lastExportedAt: string | null
  overview: string | null
}

export interface NormalizedStudyHighlight {
  id: string
  title: string
  summary: string
  startSeconds: number
  endSeconds: number
  order: number
  transcriptText: string | null
}

export interface NormalizedStudyTheme {
  id: string
  title: string
  summary: string
  order: number
}

export interface NormalizedStudyQuestion {
  id: string
  question: string
  order: number
  themeId: string | null
}

export interface NormalizedStudyQuote {
  id: string
  text: string
  speaker: string | null
  startSeconds: number
  endSeconds: number
  order: number
  themeId: string | null
}

export interface NormalizedSubtitleTrack {
  id: string
  label: string
  language: string
  kind: string
  availability: string
  isDefault: boolean
  artifactPath: string | null
  sourceUrl: string | null
}

export interface NormalizedTranslationRecord {
  id: string
  source: string
  status: string
  subtitleTrackId: string | null
  artifactPath: string | null
  target: {
    language: string
    label: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export interface NormalizedExportRecord {
  id: string
  exportKind: string
  format: string
  filePath: string
  createdAt: string
}

export interface NormalizedStudyState {
  playbackPositionSeconds: number
  selectedThemeId: string | null
  activeHighlightId: string | null
  selectedSubtitleTrackId: string | null
  isFavorite: boolean
  lastOpenedAt: string | null
}

export interface NormalizedStudyWorkspace {
  taskId: string
  taskTitle: string
  preview: NormalizedStudyPreview
  studyPack: {
    overview: string
    generationTier: string
    readiness: string
    fallbackUsed: boolean
    highlights: NormalizedStudyHighlight[]
    themes: NormalizedStudyTheme[]
    questions: NormalizedStudyQuestion[]
    quotes: NormalizedStudyQuote[]
  }
  subtitleTracks: NormalizedSubtitleTrack[]
  translationRecords: NormalizedTranslationRecord[]
  studyState: NormalizedStudyState
  exportRecords: NormalizedExportRecord[]
}

export type StudyPlaybackSource =
  | { kind: "local-video"; src: string }
  | { kind: "remote-iframe"; provider: "youtube" | "bilibili"; src: string }
  | { kind: "none"; reason: string }

export interface NormalizedKnowledgeNote {
  id: string
  taskId: string
  title: string
  excerpt: string
  noteMarkdown: string | null
  sourceKind: string
  studyThemeId: string | null
  sourceStartSeconds: number | null
  sourceEndSeconds: number | null
  sourceReferenceId: string | null
  sourceReferenceLabel: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface NormalizedKnowledgeLibrary {
  items: NormalizedKnowledgeNote[]
  total: number
}

export interface KnowledgeLibraryExportDocument {
  fileName: string
  mimeType: string
  content: string
}

export interface ResolvedKnowledgeNoteContext {
  sourceStartSeconds: number | null
  sourceEndSeconds: number | null
  sourceReferenceId: string | null
  sourceReferenceLabel: string | null
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function asNullableString(value: unknown): string | null {
  const next = asString(value).trim()
  return next ? next : null
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asBoolean(value: unknown): boolean {
  return Boolean(value)
}

function extractYoutubeVideoId(sourceInput: string): string | null {
  try {
    const url = new URL(sourceInput)
    if (url.hostname.includes("youtu.be")) {
      return asNullableString(url.pathname.split("/").filter(Boolean)[0] || null)
    }
    if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/")) {
      return asNullableString(url.pathname.split("/").filter(Boolean)[1] || null)
    }
    return asNullableString(url.searchParams.get("v"))
  } catch {
    return null
  }
}

function extractBilibiliVideoId(sourceInput: string): string | null {
  try {
    const url = new URL(sourceInput)
    const pathSegments = url.pathname.split("/").filter(Boolean)
    const bvSegment = pathSegments.find((segment) => /^BV/i.test(segment))
    if (bvSegment) {
      return bvSegment
    }
    return asNullableString(url.searchParams.get("bvid"))
  } catch {
    return null
  }
}

export function normalizeStudyPreview(value: unknown): NormalizedStudyPreview {
  const payload = asObject(value)
  const hasContractsReadiness = Boolean(asString(payload.readiness))
  const hasLegacyPreview = Boolean(asString(payload.task_id) || asString(payload.overview))
  const readiness = asString(payload.readiness).trim()
  return {
    readiness: hasContractsReadiness
      ? readiness === "ready"
        ? "ready"
        : readiness === "pending"
          ? "processing"
          : "missing"
      : hasLegacyPreview
        ? "ready"
        : "missing",
    generationTier:
      asString(payload.generation_tier).trim() ||
      (hasLegacyPreview ? "transcript_study" : "unknown"),
    highlightCount: asNumber(payload.highlight_count),
    questionCount: asNumber(payload.question_count),
    noteCount: asNumber(payload.note_count),
    isFavorite: asBoolean(payload.is_favorite ?? payload.favorite),
    lastOpenedAt: asNullableString(payload.last_opened_at),
    lastExportedAt: asNullableString(payload.last_exported_at ?? payload.latest_exported_at),
    overview: asNullableString(payload.overview),
  }
}

function normalizeStudyHighlight(value: unknown, index: number): NormalizedStudyHighlight {
  const payload = asObject(value)
  return {
    id: asString(payload.id) || `highlight-${index}`,
    title: asString(payload.title) || `重点片段 ${index + 1}`,
    summary: asString(payload.summary) || asString(payload.transcript_text) || "暂无摘要",
    startSeconds: asNumber(payload.start_seconds ?? payload.start),
    endSeconds: asNumber(payload.end_seconds ?? payload.end),
    order: asNumber(payload.order, index),
    transcriptText: asNullableString(payload.transcript_text),
  }
}

function normalizeStudyTheme(value: unknown, index: number): NormalizedStudyTheme {
  const payload = asObject(value)
  return {
    id: asString(payload.id) || `theme-${index}`,
    title: asString(payload.title) || `主题 ${index + 1}`,
    summary: asString(payload.summary) || "暂无主题摘要",
    order: asNumber(payload.order, index),
  }
}

function normalizeStudyQuestion(value: unknown, index: number): NormalizedStudyQuestion {
  const payload = asObject(value)
  return {
    id: asString(payload.id) || `question-${index}`,
    question: asString(payload.question) || asString(payload.prompt) || "暂无问题",
    order: asNumber(payload.order, index),
    themeId: asNullableString(payload.theme_id),
  }
}

function normalizeStudyQuote(value: unknown, index: number): NormalizedStudyQuote {
  const payload = asObject(value)
  return {
    id: asString(payload.id) || `quote-${index}`,
    text: asString(payload.quote) || asString(payload.text) || "暂无引用",
    speaker: asNullableString(payload.speaker),
    startSeconds: asNumber(payload.start_seconds ?? payload.start),
    endSeconds: asNumber(payload.end_seconds ?? payload.end),
    order: asNumber(payload.order, index),
    themeId: asNullableString(payload.theme_id),
  }
}

function normalizeSubtitleTrack(value: unknown, defaultTrackId: string | null): NormalizedSubtitleTrack {
  const payload = asObject(value)
  const trackId = asString(payload.track_id) || asString(payload.id)
  return {
    id: trackId,
    label: asString(payload.label) || "未命名字幕轨",
    language: asString(payload.language) || "unknown",
    kind: asString(payload.kind) || "unknown",
    availability: asString(payload.availability) || "available",
    isDefault: asBoolean(payload.is_default) || (defaultTrackId ? trackId === defaultTrackId : false),
    artifactPath: asNullableString(payload.artifact_path),
    sourceUrl: asNullableString(payload.source_url),
  }
}

function normalizeTranslationRecord(value: unknown, index: number): NormalizedTranslationRecord {
  const payload = asObject(value)
  const target = asObject(payload.target)
  return {
    id: asString(payload.id) || `translation-${index}`,
    source: asString(payload.source) || "disabled",
    status: asString(payload.status) || "disabled",
    subtitleTrackId: asNullableString(payload.subtitle_track_id),
    artifactPath: asNullableString(payload.artifact_path),
    target: Object.keys(target).length > 0
      ? {
        language: asString(target.language),
        label: asNullableString(target.label),
      }
      : null,
    createdAt: asString(payload.created_at),
    updatedAt: asString(payload.updated_at),
  }
}

function normalizeExportRecord(value: unknown, index: number): NormalizedExportRecord {
  const payload = asObject(value)
  return {
    id: asString(payload.id) || `export-${index}`,
    exportKind: asString(payload.export_kind),
    format: asString(payload.format),
    filePath: asString(payload.file_path),
    createdAt: asString(payload.created_at),
  }
}

function normalizeStudyState(value: unknown): NormalizedStudyState {
  const payload = asObject(value)
  return {
    playbackPositionSeconds: asNumber(
      payload.playback_position_seconds ?? payload.last_position_seconds,
    ),
    selectedThemeId: asNullableString(payload.selected_theme_id),
    activeHighlightId: asNullableString(payload.active_highlight_id),
    selectedSubtitleTrackId: asNullableString(
      payload.last_selected_subtitle_track_id ?? payload.selected_subtitle_track_id,
    ),
    isFavorite: asBoolean(payload.is_favorite ?? payload.favorite),
    lastOpenedAt: asNullableString(payload.last_opened_at),
  }
}

export function normalizeStudyWorkspace(value: unknown): NormalizedStudyWorkspace {
  const payload = asObject(value)
  const task = asObject(payload.task)
  const preview = normalizeStudyPreview(payload.preview)
  const studyPackPayload = asObject(payload.study_pack)
  const legacyPackPayload = asObject(payload.pack)
  const pack = Object.keys(studyPackPayload).length > 0 ? studyPackPayload : legacyPackPayload
  const packSubtitleTracks = asObject(pack.subtitle_tracks)
  const subtitleTracksSource = asArray(packSubtitleTracks.tracks).length > 0
    ? asArray(packSubtitleTracks.tracks)
    : asArray(payload.subtitle_tracks)
  const defaultTrackId = asNullableString(packSubtitleTracks.default_track_id)
  const studyState = normalizeStudyState(payload.study_state && typeof payload.study_state === "object" ? payload.study_state : payload.state)
  const derivedPreview = normalizeStudyPreview({
    ...asObject(payload.preview),
    readiness: preview.readiness !== "missing" ? preview.readiness : "ready",
    generation_tier: preview.generationTier !== "unknown" ? preview.generationTier : asString(pack.generation_tier),
    highlight_count: preview.highlightCount || asArray(pack.highlights).length,
    question_count: preview.questionCount || asArray(pack.questions).length,
    note_count: preview.noteCount,
    overview: preview.overview || asString(pack.overview),
    is_favorite: preview.isFavorite || studyState.isFavorite,
  })

  return {
    taskId: asString(payload.task_id) || asString(task.id),
    taskTitle: asString(task.title) || asString(payload.task_title) || asString(payload.task_id),
    preview: derivedPreview,
    studyPack: {
      overview: asString(pack.overview),
      generationTier: asString(pack.generation_tier) || "unknown",
      readiness: asString(pack.readiness) || "ready",
      fallbackUsed: asBoolean(pack.fallback_used),
      highlights: asArray(pack.highlights).map((item, index) => normalizeStudyHighlight(item, index)),
      themes: asArray(pack.themes).map((item, index) => normalizeStudyTheme(item, index)),
      questions: asArray(pack.questions).map((item, index) => normalizeStudyQuestion(item, index)),
      quotes: asArray(pack.quotes).map((item, index) => normalizeStudyQuote(item, index)),
    },
    subtitleTracks: subtitleTracksSource.map((item) => normalizeSubtitleTrack(item, defaultTrackId)),
    translationRecords: asArray(payload.translation_records).map((item, index) => normalizeTranslationRecord(item, index)),
    studyState,
    exportRecords: asArray(payload.export_records).map((item, index) => normalizeExportRecord(item, index)),
  }
}

export function normalizeKnowledgeLibrary(value: unknown): NormalizedKnowledgeLibrary {
  const payload = asObject(value)
  return {
    items: asArray(payload.items).map((item, index) => {
      const note = asObject(item)
      return {
        id: asString(note.id) || `note-${index}`,
        taskId: asString(note.task_id),
        title: asString(note.title) || asString(note.task_title) || "未命名知识卡片",
        excerpt: asString(note.excerpt) || asString(note.content),
        noteMarkdown: asNullableString(note.note_markdown ?? note.note),
        sourceKind: asString(note.source_kind) || "manual",
        studyThemeId: asNullableString(note.study_theme_id),
        sourceStartSeconds: Number.isFinite(Number(note.source_start_seconds)) ? Number(note.source_start_seconds) : null,
        sourceEndSeconds: Number.isFinite(Number(note.source_end_seconds)) ? Number(note.source_end_seconds) : null,
        sourceReferenceId: asNullableString(note.source_reference_id),
        sourceReferenceLabel: asNullableString(note.source_reference_label),
        tags: asArray<string>(note.tags).map((tag) => asString(tag)).filter(Boolean),
        createdAt: asString(note.created_at),
        updatedAt: asString(note.updated_at),
      }
    }),
    total: asNumber(payload.total),
  }
}

function formatExportFileTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "knowledge-library-export"
  }
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  const hours = String(date.getUTCHours()).padStart(2, "0")
  const minutes = String(date.getUTCMinutes()).padStart(2, "0")
  const seconds = String(date.getUTCSeconds()).padStart(2, "0")
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

export function formatStudyTimeRangeLabel(startSeconds: number | null, endSeconds: number | null): string | null {
  if (startSeconds === null && endSeconds === null) {
    return null
  }
  const normalizedStart = Math.max(0, startSeconds ?? endSeconds ?? 0)
  const normalizedEnd = Math.max(normalizedStart, endSeconds ?? normalizedStart)
  if (normalizedStart === normalizedEnd) {
    return formatSecondsAsClock(normalizedStart)
  }
  return `${formatSecondsAsClock(normalizedStart)} - ${formatSecondsAsClock(normalizedEnd)}`
}

export function resolveKnowledgeNoteContext(
  workspace: Pick<NormalizedStudyWorkspace, "studyPack" | "studyState"> | null | undefined,
): ResolvedKnowledgeNoteContext {
  if (!workspace) {
    return {
      sourceStartSeconds: null,
      sourceEndSeconds: null,
      sourceReferenceId: null,
      sourceReferenceLabel: null,
    }
  }

  const activeHighlight = workspace.studyPack.highlights.find(
    (highlight) => highlight.id === workspace.studyState.activeHighlightId,
  )
  if (activeHighlight) {
    return {
      sourceStartSeconds: activeHighlight.startSeconds,
      sourceEndSeconds: activeHighlight.endSeconds,
      sourceReferenceId: activeHighlight.id,
      sourceReferenceLabel: activeHighlight.title,
    }
  }

  const selectedTheme = workspace.studyPack.themes.find(
    (theme) => theme.id === workspace.studyState.selectedThemeId,
  )
  const playbackPosition = Number.isFinite(Number(workspace.studyState.playbackPositionSeconds))
    ? Math.max(0, Number(workspace.studyState.playbackPositionSeconds))
    : null
  return {
    sourceStartSeconds: playbackPosition && playbackPosition > 0 ? playbackPosition : null,
    sourceEndSeconds: playbackPosition && playbackPosition > 0 ? playbackPosition : null,
    sourceReferenceId: selectedTheme?.id ?? null,
    sourceReferenceLabel: selectedTheme?.title ?? null,
  }
}

export function buildKnowledgeLibraryExportDocument(input: {
  exportedAt: string
  scopeLabel: string
  sourceFilterLabel: string
  notes: NormalizedKnowledgeNote[]
}): KnowledgeLibraryExportDocument {
  const sections = [
    "# VidGnost Knowledge 导出",
    "",
    `- 导出时间：${input.exportedAt}`,
    `- 范围：${input.scopeLabel}`,
    `- 来源过滤：${input.sourceFilterLabel}`,
    `- 知识卡片数：${input.notes.length}`,
    "",
  ]

  if (input.notes.length === 0) {
    sections.push("当前筛选结果下没有可导出的知识卡片。")
  } else {
    input.notes.forEach((note, index) => {
      sections.push(`## ${index + 1}. ${note.title}`)
      sections.push(`- 任务：${note.taskId}`)
      sections.push(`- 来源：${note.sourceKind}`)
      sections.push(`- 主题：${note.studyThemeId || "未关联"}`)
      sections.push(`- 时间上下文：${formatStudyTimeRangeLabel(note.sourceStartSeconds, note.sourceEndSeconds) || "未记录"}`)
      sections.push(`- 引用上下文：${note.sourceReferenceLabel || note.sourceReferenceId || "未记录"}`)
      sections.push(`- 标签：${note.tags.length > 0 ? note.tags.join("、") : "无"}`)
      sections.push(`- 创建于：${note.createdAt}`)
      sections.push(`- 更新于：${note.updatedAt}`)
      sections.push("")
      sections.push("### 摘录")
      sections.push(note.excerpt)
      if (note.noteMarkdown) {
        sections.push("")
        sections.push("### 补充笔记")
        sections.push(note.noteMarkdown)
      }
      sections.push("")
    })
  }

  return {
    fileName: `knowledge-library-${formatExportFileTimestamp(input.exportedAt)}.md`,
    mimeType: "text/markdown;charset=utf-8",
    content: sections.join("\n"),
  }
}

export function buildStudyStateUpdatePayload(
  patch: StudyStateUpdateRequest,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const playbackPosition =
    patch.playback_position_seconds ?? patch.playback_position_seconds === 0
      ? patch.playback_position_seconds
      : patch.playback_position_seconds === undefined
        ? undefined
        : patch.playback_position_seconds
  const legacyPlaybackPosition =
    patch.playback_position_seconds ?? patch.playback_position_seconds === 0
      ? patch.playback_position_seconds
      : undefined
  if (playbackPosition !== undefined) {
    payload.playback_position_seconds = playbackPosition
    payload.last_position_seconds = legacyPlaybackPosition
  }
  if (patch.active_highlight_id !== undefined) {
    payload.active_highlight_id = patch.active_highlight_id
  }
  if (patch.is_favorite !== undefined) {
    payload.is_favorite = patch.is_favorite
  }
  if (patch.last_opened_at !== undefined) {
    payload.last_opened_at = patch.last_opened_at
  }
  if (patch.selected_theme_id !== undefined) {
    payload.selected_theme_id = patch.selected_theme_id
  }
  if (patch.last_selected_subtitle_track_id !== undefined) {
    payload.last_selected_subtitle_track_id = patch.last_selected_subtitle_track_id
  }
  return payload
}

export function resolveSubtitleTrackSelection(
  workspace: Pick<NormalizedStudyWorkspace, "subtitleTracks" | "studyState" | "translationRecords">,
  defaultTranslationTarget: string | null | undefined,
): string | null {
  const persistedTrackId = workspace.studyState.selectedSubtitleTrackId
  if (persistedTrackId && workspace.subtitleTracks.some((track) => track.id === persistedTrackId)) {
    return persistedTrackId
  }

  const normalizedTarget = (defaultTranslationTarget || "").trim().toLowerCase()
  if (normalizedTarget) {
    const directLanguageMatch = workspace.subtitleTracks.find((track) => track.language.trim().toLowerCase() === normalizedTarget)
    if (directLanguageMatch) {
      return directLanguageMatch.id
    }
    const translationLinkedTrack = workspace.translationRecords.find((record) =>
      record.status === "ready" &&
      record.subtitleTrackId &&
      record.target?.language.trim().toLowerCase() === normalizedTarget,
    )
    if (translationLinkedTrack?.subtitleTrackId) {
      return translationLinkedTrack.subtitleTrackId
    }
  }

  return workspace.subtitleTracks.find((track) => track.isDefault)?.id
    || workspace.subtitleTracks[0]?.id
    || null
}

export function resolveStudyPlaybackSource(
  task: Pick<TaskDetailResponse, "id" | "source_type" | "source_input" | "source_local_path">,
  localVideoUrl: string,
  startSeconds = 0,
): StudyPlaybackSource {
  if (task.source_type === "local_file" || task.source_type === "local_path") {
    return localVideoUrl
      ? { kind: "local-video", src: localVideoUrl }
      : { kind: "none", reason: "当前任务没有可预览的本地视频文件" }
  }

  if (task.source_type === "youtube") {
    const videoId = extractYoutubeVideoId(task.source_input)
    return videoId
      ? {
        kind: "remote-iframe",
        provider: "youtube",
        src: `https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0&start=${Math.max(0, Math.floor(startSeconds))}`,
      }
      : { kind: "none", reason: "当前 YouTube 链接暂时无法转换为可嵌入播放器地址" }
  }

  if (task.source_type === "bilibili") {
    const videoId = extractBilibiliVideoId(task.source_input)
    return videoId
      ? {
        kind: "remote-iframe",
        provider: "bilibili",
        src: `https://player.bilibili.com/player.html?bvid=${videoId}&page=1&autoplay=0&t=${Math.max(0, Math.floor(startSeconds))}`,
      }
      : { kind: "none", reason: "当前 Bilibili 链接暂时无法转换为可嵌入播放器地址" }
  }

  return { kind: "none", reason: "当前任务暂不支持预览" }
}

export function getTaskStudyPreviewMeta(
  task: Pick<TaskSummaryItem | TaskRecentItem | TaskDetailResponse, "study_preview">,
): NormalizedStudyPreview {
  return normalizeStudyPreview(task.study_preview)
}

export function buildKnowledgeNoteCreatePayload(input: {
  taskId: string
  title: string
  excerpt: string
  noteMarkdown?: string | null
  sourceKind: KnowledgeNoteItem["source_kind"]
  studyThemeId?: string | null
  sourceStartSeconds?: number | null
  sourceEndSeconds?: number | null
  sourceReferenceId?: string | null
  sourceReferenceLabel?: string | null
  tags?: string[]
}): KnowledgeNoteCreateRequest {
  return {
    task_id: input.taskId,
    title: input.title,
    excerpt: input.excerpt,
    note_markdown: input.noteMarkdown ?? null,
    source_kind: input.sourceKind,
    study_theme_id: input.studyThemeId ?? null,
    source_start_seconds: input.sourceStartSeconds ?? null,
    source_end_seconds: input.sourceEndSeconds ?? null,
    source_reference_id: input.sourceReferenceId ?? null,
    source_reference_label: input.sourceReferenceLabel ?? null,
    tags: input.tags ?? [],
  }
}

export function buildKnowledgeNoteUpdatePayload(input: {
  title?: string
  excerpt?: string
  noteMarkdown?: string | null
  studyThemeId?: string | null
  tags?: string[]
}): KnowledgeNoteUpdateRequest {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
    ...(input.noteMarkdown !== undefined ? { note_markdown: input.noteMarkdown } : {}),
    ...(input.studyThemeId !== undefined ? { study_theme_id: input.studyThemeId } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
  }
}
