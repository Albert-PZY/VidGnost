import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { TFunction } from 'i18next'
import { CheckCircle2, Expand, LoaderCircle, Maximize2, MessageCircle, Pencil, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { PreText } from './pretext'
import { Button } from './ui/button'
import { TerminalPanel } from './workbench-panels'
import { cn } from '../lib/utils'
import type {
  StageKey,
  TaskArtifactEntry,
  TaskDetail,
  TranscriptSegment,
  VmPhaseKey,
  VmPhaseMetric,
} from '../types'

const VM_PHASES: VmPhaseKey[] = [
  'A',
  'B',
  'C',
  'transcript_optimize',
  'notes_extract',
  'notes_outline',
  'notes_sections',
  'notes_coverage',
  'summary_delivery',
  'mindmap_delivery',
  'D',
]
const D_SUBPHASE_ORDER: VmPhaseKey[] = [
  'transcript_optimize',
  'notes_extract',
  'notes_outline',
  'notes_sections',
  'notes_coverage',
  'summary_delivery',
  'mindmap_delivery',
]
const PHASE_STAGE_MAP: Record<VmPhaseKey, StageKey> = {
  A: 'A',
  B: 'B',
  C: 'C',
  transcript_optimize: 'D',
  notes_extract: 'D',
  notes_outline: 'D',
  notes_sections: 'D',
  notes_coverage: 'D',
  summary_delivery: 'D',
  mindmap_delivery: 'D',
  D: 'D',
}
const PHASE_NEXT_MAP: Partial<Record<VmPhaseKey, VmPhaseKey>> = {
  A: 'B',
  B: 'C',
  C: 'transcript_optimize',
  transcript_optimize: 'notes_extract',
  notes_extract: 'notes_outline',
  notes_outline: 'notes_sections',
  notes_sections: 'notes_coverage',
  notes_coverage: 'summary_delivery',
  summary_delivery: 'mindmap_delivery',
  mindmap_delivery: 'D',
}
const D_DEBUG_ARTIFACT_MATCHERS: Partial<Record<VmPhaseKey, string[]>> = {
  transcript_optimize: ['transcript-optimize/'],
  notes_extract: ['notes-extract/'],
  notes_outline: ['notes-outline/'],
  notes_sections: ['notes-sections/'],
  notes_coverage: ['notes-coverage/'],
  summary_delivery: ['fusion/summary.md', 'fusion/index.json', 'fusion/fusion-prompt.md'],
  mindmap_delivery: ['fusion/mindmap.md', 'fusion/index.json', 'fusion/fusion-prompt.md'],
  D: ['transcript-optimize/', 'notes-extract/', 'notes-outline/', 'notes-sections/', 'notes-coverage/', 'fusion/'],
}

function resolveRunningDSubphase(metrics: Record<VmPhaseKey, VmPhaseMetric>): VmPhaseKey {
  for (const phase of D_SUBPHASE_ORDER) {
    const status = metrics[phase]?.status ?? 'pending'
    if (status === 'running' || status === 'pending') {
      return phase
    }
  }
  return 'D'
}

const LazyMindmapViewer = lazy(async () => {
  const module = await import('./mindmap-viewer')
  return { default: module.MindmapViewer }
})

const LazyPromptMarkdownEditor = lazy(async () => {
  const module = await import('@uiw/react-md-editor')
  return { default: module.default }
})

function formatClock(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const totalMilliseconds = Math.round(safeSeconds * 1000)
  const ms = totalMilliseconds % 1000
  const totalSeconds = Math.floor(totalMilliseconds / 1000)
  const sec = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minute = totalMinutes % 60
  const hour = Math.floor(totalMinutes / 60)
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}

function formatSegmentRange(start: number, end: number): string {
  return `${formatClock(start)} - ${formatClock(Math.max(start, end))}`
}

function normalizeArtifactPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function getArtifactRelativePath(entry: TaskArtifactEntry): string {
  const relativePath = typeof entry.relative_path === 'string' ? entry.relative_path.trim() : ''
  if (relativePath) {
    return normalizeArtifactPath(relativePath)
  }
  const logicalPath = typeof entry.logical_path === 'string' ? entry.logical_path.trim() : ''
  if (!logicalPath) return ''
  const stageArtifactMarker = '/stage-artifacts/'
  const markerIndex = logicalPath.indexOf(stageArtifactMarker)
  if (markerIndex >= 0) {
    const suffix = logicalPath.slice(markerIndex + stageArtifactMarker.length)
    const segments = normalizeArtifactPath(suffix).split('/')
    if (segments.length >= 3) {
      return segments.slice(2).join('/')
    }
  }
  const stagePathMatch = logicalPath.match(/\/D\/(.+)$/i)
  if (stagePathMatch?.[1]) {
    return normalizeArtifactPath(stagePathMatch[1])
  }
  return normalizeArtifactPath(logicalPath)
}

function getArtifactLogicalPath(entry: TaskArtifactEntry): string {
  return typeof entry.logical_path === 'string' ? entry.logical_path.trim() : ''
}

function formatArtifactSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B'
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
}

function countMarkdownBlocks(value: string): number {
  if (!value.trim()) return 0
  return value
    .split(/\r?\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean).length
}

function countNonWhitespaceCharacters(value: string): number {
  return value.replace(/\s+/g, '').length
}

function resolveArtifactPreviewMode(path: string): 'markdown' | 'json' | 'text' {
  const normalizedPath = path.toLowerCase()
  if (normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown')) return 'markdown'
  if (normalizedPath.endsWith('.json')) return 'json'
  return 'text'
}

function filterArtifactsForPhase(entries: TaskArtifactEntry[], phase: VmPhaseKey): TaskArtifactEntry[] {
  const matchers = D_DEBUG_ARTIFACT_MATCHERS[phase]
  if (!matchers?.length) return []
  return entries.filter((entry) => {
    const relativePath = getArtifactRelativePath(entry)
    return matchers.some((matcher) => relativePath.includes(matcher))
  })
}

interface WorkbenchRuntimeMainProps {
  t: TFunction
  isDark: boolean
  activeTask: TaskDetail | null
  overallProgress: number
  statusText: (status: string) => string
  isTaskCompleted: boolean
  error: string | null
  isTaskRunning: boolean
  canCancelTask: boolean
  cancellingTask: boolean
  onCancelTask: () => Promise<void>
  canRerunStageD: boolean
  rerunningStageD: boolean
  onRerunStageD: () => Promise<void>
  vmPhaseMetrics: Record<VmPhaseKey, VmPhaseMetric>
  activeVmPhase: VmPhaseKey
  activeStage: StageKey
  setActiveStage: (stage: StageKey) => void
  stageLogs: Record<StageKey, string[]>
  vmPhaseLogs: Record<VmPhaseKey, string[]>
  transcriptPanelRef: RefObject<HTMLDivElement | null>
  transcriptStream: string
  transcriptSegments: TranscriptSegment[]
  transcriptCorrectionMode: 'off' | 'strict' | 'rewrite'
  optimizedTranscriptStream: string
  optimizedTranscriptSegments: TranscriptSegment[]
  fusionPromptPreview: string
  canEditStageDMarkdown: boolean
  hasUnsavedArtifactEdits: boolean
  savingArtifacts: boolean
  onPersistEditedArtifacts: () => Promise<boolean | void>
  onLoadArtifactContent: (path: string) => Promise<string>
  notesPanelRef: RefObject<HTMLDivElement | null>
  notesStream: string
  onNotesMarkdownChange: (value: string) => void
  mindmapMarkdownPanelRef: RefObject<HTMLTextAreaElement | null>
  mindmapStream: string
  onMindmapMarkdownChange: (value: string) => void
}

export function WorkbenchRuntimeMain({
  t,
  isDark,
  activeTask,
  overallProgress,
  statusText,
  isTaskCompleted,
  error,
  isTaskRunning,
  canCancelTask,
  cancellingTask,
  onCancelTask,
  canRerunStageD,
  rerunningStageD,
  onRerunStageD,
  vmPhaseMetrics,
  activeVmPhase,
  activeStage,
  setActiveStage,
  stageLogs,
  vmPhaseLogs,
  transcriptPanelRef,
  transcriptStream,
  transcriptSegments,
  transcriptCorrectionMode,
  optimizedTranscriptStream,
  optimizedTranscriptSegments,
  fusionPromptPreview,
  canEditStageDMarkdown,
  hasUnsavedArtifactEdits,
  savingArtifacts,
  onPersistEditedArtifacts,
  onLoadArtifactContent,
  notesPanelRef,
  notesStream,
  onNotesMarkdownChange,
  mindmapMarkdownPanelRef,
  mindmapStream,
  onMindmapMarkdownChange,
}: WorkbenchRuntimeMainProps) {
  const [manualVmPhaseSelection, setManualVmPhaseSelection] = useState<{ taskId: string; phase: VmPhaseKey } | null>(null)
  const [promptPreviewFullscreen, setPromptPreviewFullscreen] = useState(false)
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null)
  const [artifactPreviewContent, setArtifactPreviewContent] = useState('')
  const [artifactPreviewError, setArtifactPreviewError] = useState<string | null>(null)
  const [artifactPreviewLoading, setArtifactPreviewLoading] = useState(false)
  const transcriptSourcePanelRef = useRef<HTMLDivElement | null>(null)
  const optimizedPanelRef = useRef<HTMLDivElement | null>(null)
  const strictScrollSyncLockedRef = useRef(false)

  const syncTranscriptPanelScroll = useCallback((source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (!source || !target) return
    if (strictScrollSyncLockedRef.current) return
    strictScrollSyncLockedRef.current = true
    target.scrollTop = source.scrollTop
    target.scrollLeft = source.scrollLeft
    window.requestAnimationFrame(() => {
      strictScrollSyncLockedRef.current = false
    })
  }, [])

  const handleSourceTranscriptScroll = useCallback(() => {
    if (transcriptCorrectionMode !== 'strict') return
    syncTranscriptPanelScroll(transcriptSourcePanelRef.current, optimizedPanelRef.current)
  }, [syncTranscriptPanelScroll, transcriptCorrectionMode])

  const handleOptimizedTranscriptScroll = useCallback(() => {
    if (transcriptCorrectionMode !== 'strict') return
    syncTranscriptPanelScroll(optimizedPanelRef.current, transcriptSourcePanelRef.current)
  }, [syncTranscriptPanelScroll, transcriptCorrectionMode])

  const autoVmPhase = useMemo(() => {
    let nextPhase = activeVmPhase
    if (isTaskRunning && activeTask?.status === 'transcribing') {
      if (nextPhase !== 'A' && nextPhase !== 'B' && nextPhase !== 'C') {
        nextPhase = 'C'
      }
    }
    if (isTaskRunning && activeTask?.status === 'summarizing' && nextPhase === 'D') {
      nextPhase = resolveRunningDSubphase(vmPhaseMetrics)
    }
    return nextPhase
  }, [activeTask?.status, activeVmPhase, isTaskRunning, vmPhaseMetrics])

  const selectedVmPhase = useMemo(() => {
    if (!isTaskRunning || !activeTask?.id) return autoVmPhase
    if (manualVmPhaseSelection?.taskId === activeTask.id) {
      return manualVmPhaseSelection.phase
    }
    return autoVmPhase
  }, [activeTask, autoVmPhase, isTaskRunning, manualVmPhaseSelection])

  const debugArtifacts = useMemo(
    () => filterArtifactsForPhase(activeTask?.artifact_index ?? [], selectedVmPhase),
    [activeTask?.artifact_index, selectedVmPhase],
  )

  const selectedArtifactEntry = useMemo(() => {
    if (!selectedArtifactPath) return null
    return debugArtifacts.find((entry) => getArtifactLogicalPath(entry) === selectedArtifactPath) ?? null
  }, [debugArtifacts, selectedArtifactPath])

  useEffect(() => {
    const stage = PHASE_STAGE_MAP[selectedVmPhase]
    if (activeStage !== stage) {
      setActiveStage(stage)
    }
  }, [activeStage, selectedVmPhase, setActiveStage])

  useEffect(() => {
    if (!debugArtifacts.length) {
      setSelectedArtifactPath(null)
      setArtifactPreviewContent('')
      setArtifactPreviewError(null)
      return
    }
    if (selectedArtifactPath && debugArtifacts.some((entry) => getArtifactLogicalPath(entry) === selectedArtifactPath)) {
      return
    }
    setSelectedArtifactPath(getArtifactLogicalPath(debugArtifacts[0]))
  }, [debugArtifacts, selectedArtifactPath])

  useEffect(() => {
    if (!selectedArtifactPath) {
      setArtifactPreviewContent('')
      setArtifactPreviewError(null)
      setArtifactPreviewLoading(false)
      return
    }
    let cancelled = false
    setArtifactPreviewLoading(true)
    setArtifactPreviewError(null)
    void onLoadArtifactContent(selectedArtifactPath)
      .then((content) => {
        if (cancelled) return
        setArtifactPreviewContent(content)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setArtifactPreviewError(error instanceof Error ? error.message : t('errors.taskFailed'))
        setArtifactPreviewContent('')
      })
      .finally(() => {
        if (cancelled) return
        setArtifactPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [onLoadArtifactContent, selectedArtifactPath, t])

  useEffect(() => {
    if (transcriptCorrectionMode === 'strict') {
      return
    }
    if (optimizedPanelRef.current) {
      optimizedPanelRef.current.scrollTop = optimizedPanelRef.current.scrollHeight
    }
  }, [optimizedTranscriptStream, transcriptCorrectionMode])

  useEffect(() => {
    if (!promptPreviewFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (promptPreviewFullscreen) {
        setPromptPreviewFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [promptPreviewFullscreen])
  const runtimeStatusLabel = useMemo(() => {
    if (!activeTask) {
      return t('runtime.waitingTaskStart')
    }
    const formatPhaseStatusText = (phase: VmPhaseKey, status: string) => {
      const phaseLabel = t(`stages.${phase}.label`)
      if (status === 'running') return `${phaseLabel} · ${t('runtime.working.label')}`
      if (status === 'skipped') return `${phaseLabel} · ${t('runtime.phase.skipped', { defaultValue: '已跳过' })}`
      if (status === 'completed') return `${phaseLabel} · ${t('runtime.phase.completed', { defaultValue: '已完成' })}`
      if (status === 'failed') return `${phaseLabel} · ${t('runtime.phase.failed', { defaultValue: '失败' })}`
      if (status === 'pending') return `${phaseLabel} · ${t('runtime.phase.pending')}`
      return `${phaseLabel} · ${status}`
    }
    if (activeTask.status === 'transcribing') {
      const phase: VmPhaseKey = 'C'
      const phaseStatus = vmPhaseMetrics[phase]?.status ?? (isTaskRunning ? 'running' : 'pending')
      return formatPhaseStatusText(phase, phaseStatus)
    }
    if (activeTask.status === 'summarizing') {
      const runningPhase = activeVmPhase === 'D' ? resolveRunningDSubphase(vmPhaseMetrics) : activeVmPhase
      const phaseStatus = vmPhaseMetrics[runningPhase]?.status ?? (isTaskRunning ? 'running' : 'pending')
      return formatPhaseStatusText(runningPhase, phaseStatus)
    }
    return statusText(activeTask.status)
  }, [activeTask, activeVmPhase, isTaskRunning, statusText, t, vmPhaseMetrics])
  const runtimeStatusMessage = error ?? (activeTask ? runtimeStatusLabel : t('task.noTask'))

  const handleSelectPhase = (phase: VmPhaseKey) => {
    setManualVmPhaseSelection({
      taskId: activeTask?.id ?? '__no_task__',
      phase,
    })
    setActiveStage(PHASE_STAGE_MAP[phase])
  }

  const sourceTypeLabel = activeTask
    ? activeTask.source_type === 'local_file'
      ? t('source.mode.path')
      : t('source.mode.url')
    : '—'
  const notesCharacters = countNonWhitespaceCharacters(notesStream)
  const summaryCharacters = countNonWhitespaceCharacters(activeTask?.summary_markdown ?? '')
  const mindmapBlocks = countMarkdownBlocks(mindmapStream)
  const transcriptSegmentCount = optimizedTranscriptSegments.length || transcriptSegments.length
  const taskUpdatedAtLabel = activeTask?.updated_at ? new Date(activeTask.updated_at).toLocaleString() : '—'

  const renderTranscriptSegments = (segments: TranscriptSegment[], emptyText: string) => {
    if (!segments.length) {
      return <pre className="whitespace-pre-wrap font-mono leading-6">{transcriptStream || emptyText}</pre>
    }
    return (
      <div className="space-y-2">
        {segments.map((segment, index) => (
          <div key={`${segment.start}-${segment.end}-${index}`} className="rounded-lg border border-border/60 bg-surface-muted/35 px-3 py-2">
            <div className="mb-1 text-xs font-mono text-accent">{formatSegmentRange(segment.start, segment.end)}</div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-text-main">{segment.text}</div>
          </div>
        ))}
      </div>
    )
  }

  const renderLogPanel = (title: string, lines: string[]) => (
    <div className="runtime-panel rounded-xl border p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PreText variant="timestamp" className="runtime-panel-caption">
          {title}
        </PreText>
        <span className="text-xs text-text-subtle">
          {t('runtime.metrics.logs', { count: lines.length })}
        </span>
      </div>
      <TerminalPanel lines={lines} emptyText={t('runtime.waitingLogs')} />
    </div>
  )

  const renderStageLogPanel = (stage: StageKey) => renderLogPanel(
    t('runtime.stageD.phaseLogsTitle', {
      defaultValue: '阶段日志',
      phase: t(`stages.${stage}.label`),
    }),
    stageLogs[stage] ?? [],
  )

  const renderPhaseLogPanel = (phase: VmPhaseKey) => renderLogPanel(
    t('runtime.stageD.phaseLogsTitle', {
      defaultValue: '阶段日志',
      phase: t(`stages.${phase}.label`),
    }),
    vmPhaseLogs[phase] ?? [],
  )

  const renderMarkdownPanel = ({
    title,
    content,
    emptyText,
    action,
    viewportClassName = 'max-h-[320px]',
  }: {
    title: string
    content: string
    emptyText: string
    action?: ReactNode
    viewportClassName?: string
  }) => (
    <div className="runtime-panel rounded-xl border p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PreText variant="timestamp" className="runtime-panel-caption">
          {title}
        </PreText>
        {action}
      </div>
      <div className={cn('overflow-auto rounded-lg border border-border/70 bg-bg-base px-3 py-2', viewportClassName)}>
        {content ? (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex h-full min-h-[160px] items-center justify-center py-6 text-center text-sm text-text-subtle">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  )

  const renderTaskContextPanel = (title = t('runtime.phaseView.shared.taskContext')) => (
    <div className="runtime-panel rounded-xl border p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PreText variant="timestamp" className="runtime-panel-caption">
          {title}
        </PreText>
        <span className="text-xs text-text-subtle">{activeTask?.id?.slice(0, 8) ?? '—'}</span>
      </div>
      {!activeTask ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-surface-muted/35 px-3 py-6 text-center text-sm text-text-subtle">
          {t('runtime.phaseView.shared.noActiveTask')}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            [t('runtime.phaseView.shared.sourceType'), sourceTypeLabel],
            [t('runtime.phaseView.shared.sourceInput'), activeTask.source_input],
            [t('runtime.phaseView.shared.language'), activeTask.language || 'auto'],
            [t('runtime.phaseView.shared.model'), activeTask.model_size || 'small'],
            [t('runtime.phaseView.shared.updatedAt'), taskUpdatedAtLabel],
            [t('runtime.phaseView.shared.totalArtifacts'), `${activeTask.artifact_index.length} · ${formatArtifactSize(activeTask.artifact_total_bytes)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border/65 bg-bg-base/75 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.12em] text-text-subtle">{label}</div>
              <div className="mt-1 break-all text-sm leading-6 text-text-main">{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderPhaseCheckpointPanel = (phase: VmPhaseKey, detailText: string, emptyText: string) => {
    const nextPhase = PHASE_NEXT_MAP[phase]
    return (
      <div className="runtime-panel rounded-xl border p-3 text-sm">
        <PreText variant="timestamp" className="runtime-panel-caption mb-2">
          {t('runtime.phaseView.shared.phaseGoal')}
        </PreText>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/65 bg-bg-base/75 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-text-subtle">
              {t('runtime.phaseView.shared.phaseGoal')}
            </div>
            <div className="mt-1 text-sm leading-6 text-text-main">{t(`stages.${phase}.description`)}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border/65 bg-bg-base/75 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.12em] text-text-subtle">
                {t('runtime.phaseView.shared.phaseOutput')}
              </div>
              <div className="mt-1 text-sm leading-6 text-text-main">{t(`runtime.phaseView.outputs.${phase}`)}</div>
            </div>
            <div className="rounded-xl border border-border/65 bg-bg-base/75 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.12em] text-text-subtle">
                {t('runtime.phaseView.shared.nextHop')}
              </div>
              <div className="mt-1 text-sm leading-6 text-text-main">
                {nextPhase ? t(`stages.${nextPhase}.label`) : t('runtime.phaseView.shared.finalOutput')}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-border/70 bg-surface-muted/35 px-3 py-3">
            <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-text-subtle">
              {t('runtime.phaseView.shared.currentExcerpt')}
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[0.82rem] leading-6 text-text-main">
              {detailText || emptyText}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  const renderNotesEditorPanel = (title = t('runtime.stageD.summaryTitle')) => (
    <div className="runtime-panel rounded-xl border p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PreText variant="timestamp" className="runtime-panel-caption">
          {title}
        </PreText>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-subtle">
            {canEditStageDMarkdown
              ? hasUnsavedArtifactEdits
                ? t('runtime.stageD.unsaved')
                : t('runtime.stageD.editable')
              : t('runtime.stageD.readonly')}
          </span>
          {canEditStageDMarkdown && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!hasUnsavedArtifactEdits || savingArtifacts}
              onClick={() => void onPersistEditedArtifacts()}
            >
              {savingArtifacts ? (
                <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pencil className="mr-2 h-3.5 w-3.5" />
              )}
              {savingArtifacts ? t('runtime.stageD.saving') : t('runtime.stageD.saveAction')}
            </Button>
          )}
        </div>
      </div>
      <div
        ref={notesPanelRef}
        className="prompt-markdown-editor mt-2"
        data-color-mode={isDark ? 'dark' : 'light'}
      >
        <Suspense
          fallback={(
            <div className="flex h-[500px] items-center justify-center rounded-xl border border-border/70 bg-surface-muted/70 text-text-subtle">
              <LoaderCircle className="h-5 w-5 animate-spin" />
            </div>
          )}
        >
          <LazyPromptMarkdownEditor
            value={notesStream}
            onChange={(value) => {
              if (!canEditStageDMarkdown || savingArtifacts) return
              onNotesMarkdownChange(value ?? '')
            }}
            preview="edit"
            height={500}
            visibleDragbar={false}
            textareaProps={{
              placeholder: t('runtime.stageD.waitingSummary'),
              readOnly: !canEditStageDMarkdown || savingArtifacts,
            }}
          />
        </Suspense>
      </div>
    </div>
  )

  const renderMindmapWorkbench = () => (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="runtime-panel h-[420px] rounded-xl border p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <PreText variant="timestamp" className="runtime-panel-caption">
            {t('runtime.stageD.mindmapTitle')}
          </PreText>
          <span className="text-xs text-text-subtle">
            {canEditStageDMarkdown
              ? hasUnsavedArtifactEdits
                ? t('runtime.stageD.unsaved')
                : t('runtime.stageD.editable')
              : t('runtime.stageD.readonly')}
          </span>
        </div>
        <textarea
          ref={mindmapMarkdownPanelRef}
          className="h-[368px] w-full resize-none rounded-lg border border-border/80 bg-bg-base px-3 py-2 font-mono text-sm leading-6 text-text-main outline-none transition-colors focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-80"
          value={mindmapStream}
          readOnly={!canEditStageDMarkdown || savingArtifacts}
          onChange={(event) => onMindmapMarkdownChange(event.target.value)}
          placeholder={t('runtime.stageD.waitingMindmap')}
        />
      </div>
      <Suspense
        fallback={
          <div className="flex h-[420px] items-center justify-center rounded-xl border border-border bg-surface-muted text-sm text-text-subtle">
            {t('runtime.stageD.mindmapEmpty')}
          </div>
        }
      >
        <div>
          <PreText variant="timestamp" className="runtime-panel-caption mb-2">
            {t('runtime.stageD.mindmapPreviewTitle')}
          </PreText>
          <LazyMindmapViewer markdown={mindmapStream} emptyText={t('runtime.stageD.mindmapEmpty')} />
        </div>
      </Suspense>
    </div>
  )

  const renderDebugArtifactsPanel = () => {
    if (selectedVmPhase === 'A' || selectedVmPhase === 'B' || selectedVmPhase === 'C') {
      return null
    }

    return (
      <div className="runtime-panel rounded-xl border p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <PreText variant="timestamp" className="runtime-panel-caption">
            {t('runtime.stageD.debugArtifactsTitle', { defaultValue: '调试产物预览' })}
          </PreText>
          <span className="text-xs text-text-subtle">
            {t('runtime.stageD.debugArtifactsCount', {
              defaultValue: '{{count}} 个文件',
              count: debugArtifacts.length,
            })}
          </span>
        </div>

        {!debugArtifacts.length ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-surface-muted/35 px-3 py-6 text-center text-sm text-text-subtle">
            {t('runtime.stageD.debugArtifactsEmpty', { defaultValue: '当前子阶段暂未持久化可预览产物。' })}
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
              {debugArtifacts.map((entry) => {
                const logicalPath = getArtifactLogicalPath(entry)
                const relativePath = getArtifactRelativePath(entry)
                const isSelected = logicalPath === selectedArtifactPath
                return (
                  <button
                    key={logicalPath}
                    type="button"
                    className={cn(
                      'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                      isSelected
                        ? 'border-border bg-bg-base shadow-sm'
                        : 'border-accent/45 bg-accent/10 hover:border-accent/30',
                    )}
                    onClick={() => setSelectedArtifactPath(logicalPath)}
                  >
                    <div className="line-clamp-2 break-all text-sm font-medium text-text-main">{relativePath || logicalPath}</div>
                    <div className="mt-1 text-[11px] text-text-subtle">
                      {formatArtifactSize(entry.size_bytes)} · {entry.source ?? entry.stage ?? 'artifact'}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="overflow-hidden rounded-xl border border-border/70 bg-bg-base">
              <div className="border-b border-border/70 px-3 py-2">
                <PreText variant="timestamp" className="break-all">
                  {selectedArtifactEntry ? getArtifactRelativePath(selectedArtifactEntry) : t('runtime.stageD.debugArtifactsTitle')}
                </PreText>
              </div>
              <div className="h-[420px] overflow-auto px-3 py-2">
                {artifactPreviewLoading ? (
                  <div className="flex h-full items-center justify-center text-text-subtle">
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  </div>
                ) : artifactPreviewError ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-red-500">
                    {artifactPreviewError}
                  </div>
                ) : !selectedArtifactEntry ? (
                  <div className="flex h-full items-center justify-center text-sm text-text-subtle">
                    {t('runtime.stageD.debugArtifactsEmpty', { defaultValue: '当前子阶段暂未持久化可预览产物。' })}
                  </div>
                ) : resolveArtifactPreviewMode(getArtifactRelativePath(selectedArtifactEntry)) === 'markdown' ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifactPreviewContent}</ReactMarkdown>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[0.82rem] leading-6 text-text-main">
                    {artifactPreviewContent}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderFusionPromptPanel = (viewportClassName = 'max-h-[320px]') => renderMarkdownPanel({
    title: t('runtime.stageH.fusionPromptTitle', { defaultValue: '最终送入 LLM 的融合提示词（Markdown 预览）' }),
    content: fusionPromptPreview,
    emptyText: t('runtime.stageH.waitingFusionPrompt', { defaultValue: '等待融合提示词...' }),
    viewportClassName,
    action: (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setPromptPreviewFullscreen(true)}
      >
        <Maximize2 className="mr-2 h-3.5 w-3.5" />
        {t('runtime.stageH.fullscreen', { defaultValue: '全屏查看' })}
      </Button>
    ),
  })

  const renderSummaryPreviewPanel = (viewportClassName = 'max-h-[320px]') => renderMarkdownPanel({
    title: t('runtime.phaseView.shared.summaryPreview'),
    content: activeTask?.summary_markdown ?? '',
    emptyText: t('runtime.phaseView.shared.emptySummary'),
    viewportClassName,
  })

  const renderFinalDeliveryCards = () => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {[
        [t('runtime.phaseView.shared.segmentCount'), `${transcriptSegmentCount}`],
        [t('runtime.phaseView.shared.notesLength'), `${notesCharacters}`],
        [t('runtime.phaseView.shared.summaryLength'), `${summaryCharacters}`],
        [t('runtime.phaseView.shared.mindmapLength'), `${mindmapBlocks}`],
        [t('runtime.phaseView.shared.totalArtifacts'), `${activeTask?.artifact_index.length ?? 0} · ${formatArtifactSize(activeTask?.artifact_total_bytes ?? 0)}`],
      ].map(([label, value]) => (
        <div key={label} className="runtime-panel rounded-xl border px-3 py-3 text-sm">
          <div className="text-[11px] uppercase tracking-[0.12em] text-text-subtle">{label}</div>
          <div className="mt-2 text-xl font-semibold tracking-tight text-text-main">{value}</div>
        </div>
      ))}
    </div>
  )

  const renderPhasePanel = () => {
    if (selectedVmPhase === 'A') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
            {renderTaskContextPanel()}
            {renderStageLogPanel('A')}
          </div>
        </div>
      )
    }
    if (selectedVmPhase === 'B') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.96fr_1.04fr]">
            {renderPhaseCheckpointPanel(
              'B',
              activeTask?.source_input ?? '',
              t('runtime.phaseView.shared.emptyExcerpt'),
            )}
            {renderStageLogPanel('B')}
          </div>
        </div>
      )
    }
    if (selectedVmPhase === 'C') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
            {renderStageLogPanel('C')}
            <div ref={transcriptPanelRef} className="runtime-panel h-[420px] overflow-auto rounded-xl border p-3 text-[0.9rem]">
              <PreText variant="timestamp" className="mb-2 runtime-panel-caption">
                {t('runtime.phaseView.shared.transcriptPreview')}
              </PreText>
              {renderTranscriptSegments(transcriptSegments, t('runtime.stageC.waitingTranscript'))}
            </div>
          </div>
        </div>
      )
    }
    if (selectedVmPhase === 'transcript_optimize') {
      return (
        <div className="grid gap-3">
          {renderPhaseLogPanel('transcript_optimize')}
          <div className="grid gap-3 lg:grid-cols-2">
            <div
              ref={transcriptSourcePanelRef}
              onScroll={handleSourceTranscriptScroll}
              className="runtime-panel h-[420px] overflow-auto rounded-xl border p-3 text-[0.9rem]"
            >
              <PreText variant="timestamp" className="mb-2 runtime-panel-caption">
                {t('runtime.stageD.optimizeSourceTitle', { defaultValue: '语音转写原文本' })}
              </PreText>
              {renderTranscriptSegments(transcriptSegments, t('runtime.stageC.waitingTranscript'))}
            </div>
            <div
              ref={optimizedPanelRef}
              onScroll={handleOptimizedTranscriptScroll}
              className="runtime-panel h-[420px] overflow-auto rounded-xl border p-3 text-[0.9rem]"
            >
              <PreText variant="timestamp" className="mb-2 runtime-panel-caption">
                {t('runtime.stageD.optimizeResultTitle', { defaultValue: '转录文本优化结果（实时更新）' })}
              </PreText>
              {transcriptCorrectionMode === 'strict'
                ? renderTranscriptSegments(
                    optimizedTranscriptSegments,
                    t('runtime.stageD.waitingOptimizedTranscript', { defaultValue: '等待优化文本输出...' }),
                  )
                : (
                    <pre className="whitespace-pre-wrap font-mono leading-6">
                      {optimizedTranscriptStream || t('runtime.stageD.waitingOptimizedTranscript', { defaultValue: '等待优化文本输出...' })}
                    </pre>
                  )}
            </div>
          </div>
          {renderDebugArtifactsPanel()}
        </div>
      )
    }
    if (selectedVmPhase === 'notes_extract') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
            {renderPhaseLogPanel('notes_extract')}
            {renderPhaseCheckpointPanel(
              'notes_extract',
              optimizedTranscriptStream,
              t('runtime.stageD.waitingOptimizedTranscript', { defaultValue: '等待优化文本输出...' }),
            )}
          </div>
          {renderDebugArtifactsPanel()}
        </div>
      )
    }
    if (selectedVmPhase === 'notes_outline') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
            {renderPhaseLogPanel('notes_outline')}
            {renderPhaseCheckpointPanel(
              'notes_outline',
              optimizedTranscriptStream,
              t('runtime.phaseView.shared.emptyExcerpt'),
            )}
          </div>
          {renderDebugArtifactsPanel()}
        </div>
      )
    }
    if (selectedVmPhase === 'notes_sections') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
            {renderPhaseLogPanel('notes_sections')}
            {renderTaskContextPanel(t('runtime.phaseView.shared.deliveryContext'))}
          </div>
          {renderDebugArtifactsPanel()}
          {renderNotesEditorPanel()}
        </div>
      )
    }
    if (selectedVmPhase === 'notes_coverage') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
            {renderPhaseLogPanel('notes_coverage')}
            {renderPhaseCheckpointPanel(
              'notes_coverage',
              notesStream,
              t('runtime.stageD.waitingSummary'),
            )}
          </div>
          {renderDebugArtifactsPanel()}
          {renderNotesEditorPanel(t('runtime.phaseView.shared.coverageNotesPreview'))}
        </div>
      )
    }
    if (selectedVmPhase === 'summary_delivery') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
            {renderPhaseLogPanel('summary_delivery')}
            {renderSummaryPreviewPanel('max-h-[360px]')}
          </div>
          {renderDebugArtifactsPanel()}
          {renderFusionPromptPanel()}
        </div>
      )
    }
    if (selectedVmPhase === 'mindmap_delivery') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-3 xl:grid-cols-[0.92fr_1.08fr]">
            {renderPhaseLogPanel('mindmap_delivery')}
            {renderPhaseCheckpointPanel(
              'mindmap_delivery',
              mindmapStream,
              t('runtime.stageD.waitingMindmap'),
            )}
          </div>
          {renderDebugArtifactsPanel()}
          {renderMindmapWorkbench()}
        </div>
      )
    }
    return (
      <div className="grid gap-3">
        {renderFinalDeliveryCards()}
        <div className="grid gap-3 xl:grid-cols-[0.88fr_1.12fr]">
          {renderStageLogPanel('D')}
          {renderTaskContextPanel(t('runtime.phaseView.shared.deliveryContext'))}
        </div>
        {renderFusionPromptPanel()}
        <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
          {renderNotesEditorPanel()}
          {renderSummaryPreviewPanel('h-[500px]')}
        </div>
        {renderMindmapWorkbench()}
      </div>
    )
  }

  return (
    <main className="min-w-0 space-y-4">
      <section className="workbench-runtime-card p-4 md:p-5">
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <PreText as="h2" variant="h2" className="tracking-[0.01em]">
            {t('runtime.title')}
          </PreText>
          <PreText variant="timestamp" className="workbench-subtitle-pill max-w-full line-clamp-1 text-right">
            {t('runtime.taskStatus', { status: runtimeStatusLabel })}
          </PreText>
        </div>
        <div className="mb-4 h-3 rounded-full border border-border/70 bg-surface-muted/80 p-[2px]">
          <div
            className="runtime-progress-fill h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-accent-strong))] transition-all duration-300"
            style={{ width: `${Math.max(0, Math.min(100, overallProgress))}%` }}
          />
        </div>
        <div className="mb-3.5 flex items-center gap-2 text-[0.92rem]">
          {isTaskCompleted && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {!isTaskCompleted && isTaskRunning && <LoaderCircle className="h-4 w-4 animate-spin text-accent" />}
          <span
            className={cn('min-w-0 flex-1 truncate', error ? 'text-red-500' : 'text-text-subtle')}
            title={runtimeStatusMessage}
          >
            {runtimeStatusMessage}
          </span>
          {canCancelTask && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn('border-red-400/55 text-red-500 hover:bg-red-500/10', !isTaskRunning && 'ml-auto')}
              disabled={cancellingTask}
              onClick={() => void onCancelTask()}
            >
              {cancellingTask ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
              {cancellingTask ? t('runtime.cancel.requesting') : t('runtime.cancel.action')}
            </Button>
          )}
          {!canCancelTask && canRerunStageD && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto border-accent/45 text-accent hover:bg-accent/10"
              disabled={rerunningStageD}
              onClick={() => void onRerunStageD()}
            >
              <LoaderCircle className={cn('mr-2 h-4 w-4', rerunningStageD && 'animate-spin')} />
              {rerunningStageD
                ? t('runtime.stageD.rerunRequesting', { defaultValue: '重跑中...' })
                : t('runtime.stageD.rerunAction')}
            </Button>
          )}
        </div>
        <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {VM_PHASES.map((phase) => {
            const metric = vmPhaseMetrics[phase]
            const status = metric?.status ?? 'pending'
            const isSelected = phase === selectedVmPhase
            const phaseDescription = t(`stages.${phase}.description`)
            return (
              <button
                key={phase}
                type="button"
                onClick={() => handleSelectPhase(phase)}
                data-state={isSelected ? 'selected' : 'idle'}
                data-status={status}
                aria-pressed={isSelected}
                aria-current={isSelected ? 'step' : undefined}
                aria-label={`${t(`stages.${phase}.label`)}：${phaseDescription}`}
                className={cn(
                  'workbench-stage-pill group relative min-h-[4.75rem] px-3 py-3 pr-11 text-left text-[0.82rem] transition-all duration-200',
                  phase === activeVmPhase && !isSelected && 'ring-1 ring-accent/30',
                )}
              >
                <span
                  className="pointer-events-none absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-[0.9rem] border border-border/70 bg-bg-base/92 text-text-subtle shadow-[0_10px_18px_-16px_rgba(15,30,49,0.55)] transition-all duration-200 group-hover:border-accent/45 group-hover:bg-accent/10 group-hover:text-accent group-focus-visible:border-accent/45 group-focus-visible:bg-accent/10 group-focus-visible:text-accent"
                  aria-hidden="true"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </span>
                <span className="runtime-phase-tooltip pointer-events-none absolute bottom-[calc(100%+0.75rem)] right-0 z-20 w-[17rem] max-w-[calc(100vw-4rem)] translate-y-1 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                  <span className="runtime-phase-tooltip__tail" aria-hidden="true" />
                  <span className="runtime-phase-tooltip__body block">
                    <span className="mb-1.5 flex items-center gap-2 text-[0.72rem] font-semibold text-accent">
                      <MessageCircle className="h-3.5 w-3.5" />
                      {t(`stages.${phase}.label`)}
                    </span>
                    <span className="block text-[0.74rem] leading-6 text-text-main">{phaseDescription}</span>
                  </span>
                </span>
                <div className="pr-1 font-semibold tracking-[0.006em] leading-6">{t(`stages.${phase}.label`)}</div>
                <div
                  className={cn(
                    'absolute inset-x-3 bottom-2 h-[3px] rounded-full opacity-0 transition-opacity duration-200',
                    status === 'running' && 'bg-[var(--color-info)] opacity-100',
                    status === 'completed' && 'bg-[var(--color-success)] opacity-100',
                    status === 'failed' && 'bg-[var(--color-danger)] opacity-100',
                    isSelected && status !== 'running' && status !== 'completed' && status !== 'failed' && 'bg-[var(--color-accent)] opacity-100',
                  )}
                  aria-hidden="true"
                />
                <div className="sr-only">
                  {phaseDescription}
                </div>
              </button>
            )
          })}
        </div>
        <div key={selectedVmPhase} className="runtime-phase-panel">
          {renderPhasePanel()}
        </div>
      </section>

      {promptPreviewFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setPromptPreviewFullscreen(false)}>
          <div
            className="workbench-surface-card h-[92vh] w-full max-w-6xl p-3.5"
            role="dialog"
            aria-modal="true"
            aria-label={t('runtime.stageH.fusionPromptTitle', { defaultValue: '最终输入给 LLM 的融合提示词（Markdown 预览）' })}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <PreText variant="h3">
                {t('runtime.stageH.fusionPromptTitle', { defaultValue: '最终输入给 LLM 的融合提示词（Markdown 预览）' })}
              </PreText>
              <Button type="button" size="sm" variant="outline" onClick={() => setPromptPreviewFullscreen(false)}>
                <Expand className="mr-2 h-4 w-4" />
                {t('runtime.modal.exitFullscreen', { defaultValue: '退出全屏' })}
              </Button>
            </div>
            <div className="h-[calc(100%-44px)] overflow-auto rounded-lg border border-border/70 bg-bg-base px-4 py-3">
              {fusionPromptPreview ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{fusionPromptPreview}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-text-subtle">
                  {t('runtime.stageH.waitingFusionPrompt', { defaultValue: '等待融合提示词...' })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
