"use client"

import * as React from "react"
import { BookOpenText, Clock3, Download, Languages, ListChecks, Loader2, MapPin, Sparkles, Star, TextQuote } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDateTime, formatSecondsAsClock } from "@/lib/format"
import type { TaskDetailResponse, TaskExportKind } from "@/lib/types"
import {
  normalizeStudyPreview,
  type NormalizedStudyWorkspace,
  normalizeStudyWorkspace,
  resolveSubtitleTrackSelection,
} from "@/lib/study-workbench"
import { cn } from "@/lib/utils"

interface StudyViewProps {
  task: TaskDetailResponse
  isLoading: boolean
  errorMessage: string
  workspace: NormalizedStudyWorkspace | null
  defaultTranslationTarget: string | null
  isPersistingStudyState: boolean
  onSeek: (seconds: number) => void
  onSelectSubtitleTrack: (trackId: string) => void | Promise<void>
  onSelectHighlight: (highlightId: string, startSeconds: number) => void | Promise<void>
  onSelectTheme: (themeId: string | null) => void | Promise<void>
  onToggleFavorite: (nextValue: boolean) => void | Promise<void>
  onExportArtifact: (kind: Extract<TaskExportKind, "study_pack" | "subtitle_tracks" | "translation_records">) => void | Promise<void>
}

function StudyEmptyState({
  title,
  description,
  loading = false,
}: {
  title: string
  description: string
  loading?: boolean
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-4">
      <div className="workbench-pane-state flex max-w-xl flex-col items-center rounded-2xl border border-dashed px-8 py-10 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/8 text-primary">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <BookOpenText className="h-5 w-5" />}
        </div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function StudySection({
  title,
  icon,
  countLabel,
  children,
}: {
  title: string
  icon: React.ReactNode
  countLabel?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card/65 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 text-primary">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
          </div>
        </div>
        {countLabel ? <Badge variant="secondary">{countLabel}</Badge> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function StudyMetricCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/55 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  )
}

type StudyReadingFocus =
  | {
    kind: "highlight"
    id: string
    title: string
    summary: string
    text: string | null
    startSeconds: number
    endSeconds: number
  }
  | {
    kind: "quote"
    id: string
    title: string
    summary: string
    text: string
    startSeconds: number
    endSeconds: number
  }

function resolveInitialReadingFocus(workspace: NormalizedStudyWorkspace): StudyReadingFocus | null {
  const activeHighlight = workspace.studyPack.highlights.find(
    (highlight) => highlight.id === workspace.studyState.activeHighlightId,
  )
  if (activeHighlight) {
    return {
      kind: "highlight",
      id: activeHighlight.id,
      title: activeHighlight.title,
      summary: activeHighlight.summary,
      text: activeHighlight.transcriptText,
      startSeconds: activeHighlight.startSeconds,
      endSeconds: activeHighlight.endSeconds,
    }
  }
  return null
}

function resolveStudyWorkspace(task: TaskDetailResponse): NormalizedStudyWorkspace | null {
  const preview = task.study_preview
  if (!preview) {
    return null
  }
  const previewMeta = normalizeStudyPreview(preview)
  return normalizeStudyWorkspace({
    task: {
      id: task.id,
      title: task.title,
      workflow: task.workflow,
      source_type: task.source_type,
      source_input: task.source_input,
      source_local_path: task.source_local_path,
      language: task.language,
      duration_seconds: task.duration_seconds,
      status: task.status,
      progress: task.progress,
      updated_at: task.updated_at,
    },
    preview,
    study_pack: {
      task_id: task.id,
      overview: previewMeta.overview || "",
      generation_tier: preview.generation_tier || "heuristic",
      readiness: preview.readiness || "pending",
      fallback_used: false,
      highlights: [],
      themes: [],
      questions: [],
      quotes: [],
      generated_at: task.updated_at,
    },
    subtitle_tracks: [],
    translation_records: [],
    study_state: {
      playback_position_seconds: 0,
      selected_theme_id: null,
      active_highlight_id: null,
      is_favorite: Boolean(preview.is_favorite),
      last_opened_at: preview.last_opened_at || null,
    },
    export_records: [],
  })
}

export function StudyView({
  task,
  isLoading,
  errorMessage,
  workspace,
  defaultTranslationTarget,
  isPersistingStudyState,
  onSeek,
  onSelectSubtitleTrack,
  onSelectHighlight,
  onSelectTheme,
  onToggleFavorite,
  onExportArtifact,
}: StudyViewProps) {
  const effectiveWorkspace = React.useMemo(
    () => workspace ?? resolveStudyWorkspace(task),
    [task, workspace],
  )
  const selectedSubtitleTrackId = React.useMemo(
    () => effectiveWorkspace ? resolveSubtitleTrackSelection(effectiveWorkspace, defaultTranslationTarget) : null,
    [defaultTranslationTarget, effectiveWorkspace],
  )
  const selectedSubtitleTrack = React.useMemo(
    () => effectiveWorkspace?.subtitleTracks.find((track) => track.id === selectedSubtitleTrackId) || null,
    [effectiveWorkspace, selectedSubtitleTrackId],
  )
  const selectedTheme = React.useMemo(
    () => effectiveWorkspace?.studyPack.themes.find((theme) => theme.id === effectiveWorkspace.studyState.selectedThemeId) || null,
    [effectiveWorkspace],
  )
  const [readingFocus, setReadingFocus] = React.useState<StudyReadingFocus | null>(() =>
    effectiveWorkspace ? resolveInitialReadingFocus(effectiveWorkspace) : null,
  )

  React.useEffect(() => {
    setReadingFocus(effectiveWorkspace ? resolveInitialReadingFocus(effectiveWorkspace) : null)
  }, [effectiveWorkspace])

  if (errorMessage && !effectiveWorkspace) {
    return <StudyEmptyState title="Study 资料暂不可用" description={errorMessage} />
  }

  if (!effectiveWorkspace || effectiveWorkspace.preview.readiness === "processing") {
    return (
      <StudyEmptyState
        title="Study 正在生成中"
        description={isLoading || task.status === "running" || task.status === "queued"
          ? "学习资料还在整理，当前任务完成后会在这里展示概览、重点片段、主题问题与关键引用。"
          : "当前还没有拿到可展示的学习资料，请稍后刷新查看。"}
        loading={isLoading || task.status === "running" || task.status === "queued"}
      />
    )
  }

  if (effectiveWorkspace.preview.readiness === "missing") {
    return (
      <StudyEmptyState
        title="Study 资料缺失"
        description="该任务暂未生成学习资料。可以先在 Flow 查看转写与阶段产物，或等待后端完成学习资料整理。"
      />
    )
  }

  return (
    <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
      <div className="space-y-4 p-4">
        <section className="rounded-2xl border border-border/70 bg-card/65 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Study</Badge>
                <Badge variant="secondary">{effectiveWorkspace.preview.generationTier || "unknown"}</Badge>
                {effectiveWorkspace.preview.isFavorite ? <Badge variant="secondary">已收藏</Badge> : null}
                {defaultTranslationTarget ? <Badge variant="secondary">默认翻译目标 {defaultTranslationTarget}</Badge> : null}
              </div>
              <h3 className="text-base font-semibold">学习概览</h3>
              <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {effectiveWorkspace.studyPack.overview || effectiveWorkspace.preview.overview || "当前没有可展示的学习概览。"}
              </p>
            </div>
            <div className="space-y-3">
              <div className="grid min-w-[16rem] gap-2 sm:grid-cols-2">
                <StudyMetricCard label="重点片段" value={`${effectiveWorkspace.preview.highlightCount}`} />
                <StudyMetricCard label="学习问题" value={`${effectiveWorkspace.preview.questionCount}`} />
                <StudyMetricCard label="知识卡片" value={`${effectiveWorkspace.preview.noteCount}`} />
                <StudyMetricCard
                  label="最近打开"
                  value={effectiveWorkspace.preview.lastOpenedAt ? formatDateTime(effectiveWorkspace.preview.lastOpenedAt) : "未打开"}
                />
                <StudyMetricCard
                  label="当前主题"
                  value={selectedTheme?.title || effectiveWorkspace.studyState.selectedThemeId || "未选择"}
                />
                <StudyMetricCard
                  label="当前位置"
                  value={formatSecondsAsClock(effectiveWorkspace.studyState.playbackPositionSeconds)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant={effectiveWorkspace.studyState.isFavorite ? "default" : "outline"}
                  size="sm"
                  disabled={isPersistingStudyState}
                  onClick={() => void onToggleFavorite(!effectiveWorkspace.studyState.isFavorite)}
                >
                  <Star className="mr-1.5 h-4 w-4" />
                  {effectiveWorkspace.studyState.isFavorite ? "取消收藏" : "加入收藏"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void onExportArtifact("study_pack")}>
                  <Download className="mr-1.5 h-4 w-4" />
                  导出 Study 包
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={effectiveWorkspace.subtitleTracks.length === 0}
                  onClick={() => void onExportArtifact("subtitle_tracks")}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  导出字幕
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={effectiveWorkspace.translationRecords.length === 0}
                  onClick={() => void onExportArtifact("translation_records")}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  导出翻译记录
                </Button>
              </div>
            </div>
          </div>
        </section>

        <StudySection
          title="字幕与翻译"
          icon={<Languages className="h-4 w-4" />}
          countLabel={`${effectiveWorkspace.subtitleTracks.length} 条轨道`}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-background/55 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">当前 Study 阅读轨道</Badge>
                <Badge variant="secondary">
                  {selectedSubtitleTrack?.label || "未选择轨道"}
                </Badge>
                {selectedSubtitleTrack ? <Badge variant="secondary">{selectedSubtitleTrack.language}</Badge> : null}
                {selectedSubtitleTrack ? <Badge variant="outline">{selectedSubtitleTrack.availability}</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                当前轨道选择会用于 Study 阅读上下文与导出，不会直接切换左侧旧转写面板。
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedSubtitleTrack?.artifactPath || selectedSubtitleTrack?.sourceUrl
                  ? "当前阅读面会继续展示 Study 资料中的引用与摘录；如需完整字幕正文，请返回转写面板或直接导出轨道文件。"
                  : "当前契约未返回该轨道正文，阅读面仍展示 Study 资料中的引用与摘录。"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {effectiveWorkspace.subtitleTracks.length > 0 ? effectiveWorkspace.subtitleTracks.map((track) => {
                const isSelected = selectedSubtitleTrackId === track.id
                return (
                  <Button
                    key={track.id}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    disabled={isPersistingStudyState}
                    onClick={() => void onSelectSubtitleTrack(track.id)}
                  >
                    {track.label}
                    <span className="ml-2 text-xs uppercase opacity-80">{track.language}</span>
                  </Button>
                )
              }) : (
                <p className="text-sm text-muted-foreground">当前没有可用的字幕轨道。</p>
              )}
            </div>
            {selectedSubtitleTrackId ? (
              <p className="text-xs text-muted-foreground">
                当前已选轨道：
                {effectiveWorkspace.subtitleTracks.find((track) => track.id === selectedSubtitleTrackId)?.label || selectedSubtitleTrackId}
                {isPersistingStudyState ? "，正在同步到后端..." : ""}
              </p>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2">
              {effectiveWorkspace.translationRecords.length > 0 ? effectiveWorkspace.translationRecords.map((record) => (
                <div key={record.id} className="rounded-xl border border-border/60 bg-background/55 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{record.source}</Badge>
                    <Badge variant={record.status === "ready" ? "secondary" : "outline"}>{record.status}</Badge>
                    {record.target ? <Badge variant="secondary">{record.target.label || record.target.language}</Badge> : null}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {record.subtitleTrackId ? `关联轨道 ${record.subtitleTrackId}` : "当前没有关联字幕轨。"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    更新时间 {record.updatedAt ? formatDateTime(record.updatedAt) : "未记录"}
                  </p>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">当前还没有可展示的翻译记录。</p>
              )}
            </div>
          </div>
        </StudySection>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <StudySection
            title="重点片段"
            icon={<Sparkles className="h-4 w-4" />}
            countLabel={`${effectiveWorkspace.studyPack.highlights.length} 条`}
          >
            <div className="space-y-3">
              {effectiveWorkspace.studyPack.highlights.length > 0 ? effectiveWorkspace.studyPack.highlights.map((highlight) => {
                const isFocused = readingFocus?.kind === "highlight" && readingFocus.id === highlight.id
                return (
                <div
                  key={highlight.id}
                  className={cn(
                    "rounded-xl border border-border/60 bg-background/55 p-3",
                    isFocused && "border-primary/50 bg-primary/5",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{highlight.title}</div>
                        {isFocused ? <Badge variant="secondary">当前阅读焦点</Badge> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatSecondsAsClock(highlight.startSeconds)} - {formatSecondsAsClock(highlight.endSeconds)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReadingFocus({
                          kind: "highlight",
                          id: highlight.id,
                          title: highlight.title,
                          summary: highlight.summary,
                          text: highlight.transcriptText,
                          startSeconds: highlight.startSeconds,
                          endSeconds: highlight.endSeconds,
                        })
                        void onSelectHighlight(highlight.id, highlight.startSeconds)
                        onSeek(highlight.startSeconds)
                      }}
                    >
                      <MapPin className="mr-1.5 h-4 w-4" />
                      跳转
                    </Button>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{highlight.summary}</p>
                  {highlight.transcriptText ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{highlight.transcriptText}</p>
                  ) : null}
                </div>
                )
              }) : (
                <p className="text-sm text-muted-foreground">当前没有可展示的重点片段。</p>
              )}
            </div>
          </StudySection>

          <div className="space-y-4">
            <StudySection
              title="当前阅读定位"
              icon={<MapPin className="h-4 w-4" />}
            >
              {readingFocus ? (
                <div className="space-y-3 rounded-xl border border-border/60 bg-background/55 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{readingFocus.kind === "highlight" ? "重点片段" : "关键引用"}</Badge>
                    <Badge variant="secondary">
                      {formatSecondsAsClock(readingFocus.startSeconds)} - {formatSecondsAsClock(readingFocus.endSeconds)}
                    </Badge>
                    {selectedSubtitleTrack ? <Badge variant="secondary">{selectedSubtitleTrack.label}</Badge> : null}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{readingFocus.title}</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{readingFocus.summary}</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-card/70 p-3 text-sm leading-6">
                    {readingFocus.text || "当前焦点没有返回独立摘录文本，阅读面继续使用 Study 摘要与时间定位。"}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  点击重点片段或关键引用的“跳转”后，这里会显示当前阅读焦点与关联文本状态。
                </p>
              )}
            </StudySection>

            <StudySection
              title="主题脉络"
              icon={<ListChecks className="h-4 w-4" />}
              countLabel={`${effectiveWorkspace.studyPack.themes.length} 个`}
            >
              <div className="space-y-3">
                {effectiveWorkspace.studyPack.themes.length > 0 ? effectiveWorkspace.studyPack.themes.map((theme) => {
                  const isSelected = theme.id === effectiveWorkspace.studyState.selectedThemeId
                  return (
                  <div
                    key={theme.id}
                    className={cn(
                      "rounded-xl border border-border/60 bg-background/55 p-3",
                      isSelected && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{theme.title}</div>
                        {isSelected ? <Badge variant="secondary">当前主题</Badge> : null}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => void onSelectTheme(theme.id)}>
                        设为当前主题
                      </Button>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{theme.summary}</p>
                  </div>
                  )
                }) : (
                  <p className="text-sm text-muted-foreground">当前没有提炼出的主题结构。</p>
                )}
              </div>
            </StudySection>

            <StudySection
              title="学习问题"
              icon={<Clock3 className="h-4 w-4" />}
              countLabel={`${effectiveWorkspace.studyPack.questions.length} 个`}
            >
              <div className="space-y-2">
                {effectiveWorkspace.studyPack.questions.length > 0 ? effectiveWorkspace.studyPack.questions.map((question, index) => (
                  <div key={question.id} className="rounded-xl border border-border/60 bg-background/55 px-3 py-2.5 text-sm">
                    <span className="mr-2 text-xs text-muted-foreground">Q{index + 1}</span>
                    {question.question}
                  </div>
                )) : (
                  <p className="text-sm text-muted-foreground">当前没有可追问的学习问题。</p>
                )}
              </div>
            </StudySection>
          </div>
        </div>

        <StudySection
          title="导出记录"
          icon={<Download className="h-4 w-4" />}
          countLabel={`${effectiveWorkspace.exportRecords.length} 条`}
        >
          <div className="space-y-3">
            {effectiveWorkspace.exportRecords.length > 0 ? effectiveWorkspace.exportRecords.map((record) => (
              <div key={record.id} className="rounded-xl border border-border/60 bg-background/55 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{record.exportKind}</Badge>
                  <Badge variant="secondary">{record.format}</Badge>
                </div>
                <p className="mt-2 break-all text-sm text-muted-foreground">{record.filePath}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  导出时间 {record.createdAt ? formatDateTime(record.createdAt) : "未记录"}
                </p>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground">当前还没有 Study 导出记录。</p>
            )}
          </div>
        </StudySection>

        <StudySection
          title="关键引用"
          icon={<TextQuote className="h-4 w-4" />}
          countLabel={`${effectiveWorkspace.studyPack.quotes.length} 条`}
        >
          <div className="space-y-3">
            {effectiveWorkspace.studyPack.quotes.length > 0 ? effectiveWorkspace.studyPack.quotes.map((quote) => {
              const isFocused = readingFocus?.kind === "quote" && readingFocus.id === quote.id
              return (
              <div
                key={quote.id}
                className={cn(
                  "rounded-xl border border-border/60 bg-background/55 p-3",
                  isFocused && "border-primary/50 bg-primary/5",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground">
                    {quote.speaker ? `${quote.speaker} · ` : ""}
                    {formatSecondsAsClock(quote.startSeconds)} - {formatSecondsAsClock(quote.endSeconds)}
                    {isFocused ? " · 当前阅读焦点" : ""}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReadingFocus({
                        kind: "quote",
                        id: quote.id,
                        title: quote.speaker ? `${quote.speaker} 的引用` : "关键引用",
                        summary: "已按当前 Study 阅读状态定位到引用片段。",
                        text: quote.text,
                        startSeconds: quote.startSeconds,
                        endSeconds: quote.endSeconds,
                      })
                      onSeek(quote.startSeconds)
                    }}
                  >
                    <MapPin className="mr-1.5 h-4 w-4" />
                    跳转
                  </Button>
                </div>
                <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-primary/35 pl-3 text-sm leading-6">
                  {quote.text}
                </blockquote>
              </div>
              )
            }) : (
              <p className="text-sm text-muted-foreground">当前没有可展示的关键引用。</p>
            )}
          </div>
        </StudySection>
      </div>
    </ScrollArea>
  )
}
