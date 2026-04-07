import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { TFunction } from 'i18next'
import { CheckCircle2, Expand, LoaderCircle, Maximize2, Pencil, X } from 'lucide-react'
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

function parseNumeric(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

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

function phaseElapsedSeconds(metric: VmPhaseMetric | undefined, runtimeNowMs: number): number {
  if (!metric) return 0
  if (metric.status === 'running' && metric.started_at) {
    const startedMs = Date.parse(metric.started_at)
    if (!Number.isNaN(startedMs)) {
      return Math.max(0, Math.floor((runtimeNowMs - startedMs) / 1000))
    }
  }
  return Math.max(0, Math.floor(parseNumeric(metric.elapsed_seconds, 0)))
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
  runtimeNowMs: number
  canCancelTask: boolean
  cancellingTask: boolean
  onCancelTask: () => Promise<void>
  canRerunStageD: boolean
  rerunningStageD: boolean
  onRerunStageD: () => Promise<void>
  vmPhaseMetrics: Record<VmPhaseKey, VmPhaseMetric>
  activeVmPhase: VmPhaseKey
  totalVmElapsedSeconds: number
  displayedStageElapsedSeconds: number
  activeStageLogCount: number
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
  runtimeNowMs,
  canCancelTask,
  cancellingTask,
  onCancelTask,
  canRerunStageD,
  rerunningStageD,
  onRerunStageD,
  vmPhaseMetrics,
  activeVmPhase,
  totalVmElapsedSeconds,
  displayedStageElapsedSeconds,
  activeStageLogCount,
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

  const selectedPhaseLogs = useMemo(() => {
    if (selectedVmPhase === 'A' || selectedVmPhase === 'B' || selectedVmPhase === 'C' || selectedVmPhase === 'D') {
      return vmPhaseLogs[selectedVmPhase] ?? stageLogs[PHASE_STAGE_MAP[selectedVmPhase]]
    }
    return vmPhaseLogs[selectedVmPhase] ?? []
  }, [selectedVmPhase, stageLogs, vmPhaseLogs])

  const selectedPhaseLogCount = selectedPhaseLogs.length

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

  const renderPhaseLogPanel = (phase: VmPhaseKey) => (
    <div className="runtime-panel rounded-xl border p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PreText variant="timestamp" className="runtime-panel-caption">
          {t('runtime.stageD.phaseLogsTitle', {
            defaultValue: '阶段日志',
            phase: t(`stages.${phase}.label`),
          })}
        </PreText>
        <span className="text-xs text-text-subtle">
          {t('runtime.metrics.logs', { count: vmPhaseLogs[phase]?.length ?? 0 })}
        </span>
      </div>
      <TerminalPanel lines={vmPhaseLogs[phase] ?? []} emptyText={t('runtime.waitingLogs')} />
    </div>
  )

  const renderDebugArtifactsPanel = () => {
    if (
      selectedVmPhase === 'A'
      || selectedVmPhase === 'B'
      || selectedVmPhase === 'C'
    ) {
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

  const renderPhasePanel = () => {
    if (selectedVmPhase === 'A') {
      return <TerminalPanel lines={stageLogs.A} emptyText={t('runtime.waitingLogs')} />
    }
    if (selectedVmPhase === 'B') {
      return <TerminalPanel lines={stageLogs.B} emptyText={t('runtime.waitingLogs')} />
    }
    if (selectedVmPhase === 'C') {
      return (
        <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
          <TerminalPanel lines={stageLogs.C} emptyText={t('runtime.waitingLogs')} />
          <div ref={transcriptPanelRef} className="runtime-panel h-[420px] overflow-auto rounded-xl border p-3 text-[0.9rem]">
            {renderTranscriptSegments(transcriptSegments, t('runtime.stageC.waitingTranscript'))}
          </div>
        </div>
      )
    }
    if (selectedVmPhase === 'transcript_optimize') {
      return (
        <div className="grid gap-3">
          {renderPhaseLogPanel('transcript_optimize')}
          {renderDebugArtifactsPanel()}
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
                {t('runtime.stageD.optimizeResultTitle', { defaultValue: '转录文本优化结果（SSE 实时）' })}
              </PreText>
              {transcriptCorrectionMode === 'strict'
                ? renderTranscriptSegments(
                    optimizedTranscriptSegments,
                    t('runtime.stageD.waitingOptimizedTranscript', { defaultValue: '等待优化文本流输出...' }),
                  )
                : (
                    <pre className="whitespace-pre-wrap font-mono leading-6">
                      {optimizedTranscriptStream || t('runtime.stageD.waitingOptimizedTranscript', { defaultValue: '等待优化文本流输出...' })}
                    </pre>
                  )}
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="grid gap-3">
        {renderPhaseLogPanel(selectedVmPhase)}
        {renderDebugArtifactsPanel()}
        <div className="runtime-panel rounded-xl border p-3 text-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <PreText variant="timestamp" className="runtime-panel-caption">
              {t('runtime.stageH.fusionPromptTitle', { defaultValue: '最终输入给 LLM 的融合提示词（Markdown 预览）' })}
            </PreText>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPromptPreviewFullscreen(true)}
            >
              <Maximize2 className="mr-2 h-3.5 w-3.5" />
              {t('runtime.stageH.fullscreen', { defaultValue: '全屏查看' })}
            </Button>
          </div>
          <div className="max-h-[320px] overflow-auto rounded-lg border border-border/70 bg-bg-base px-3 py-2">
            {fusionPromptPreview ? (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{fusionPromptPreview}</ReactMarkdown>
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-text-subtle">
                {t('runtime.stageH.waitingFusionPrompt', { defaultValue: '等待融合提示词...' })}
              </div>
            )}
          </div>
        </div>
        <div className="runtime-panel rounded-xl border p-3 text-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <PreText variant="timestamp" className="runtime-panel-caption">
              {t('runtime.stageD.summaryTitle')}
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
        <div className="mb-3.5 flex flex-wrap items-center gap-2 text-[0.76rem] text-text-subtle">
          <span className="workbench-metric-chip px-2 py-1 font-mono tabular-nums">
            {t('runtime.metrics.elapsed', { seconds: displayedStageElapsedSeconds })}
          </span>
          {!isTaskRunning && totalVmElapsedSeconds > 0 && (
            <span className="workbench-metric-chip px-2 py-1 font-mono tabular-nums">
              {t('runtime.metrics.totalElapsed', { seconds: totalVmElapsedSeconds })}
            </span>
          )}
          <span className="workbench-metric-chip px-2 py-1">
            {t('runtime.metrics.logs', { count: selectedPhaseLogCount || activeStageLogCount })}
          </span>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-8">
          {VM_PHASES.map((phase) => {
            const metric = vmPhaseMetrics[phase]
            const status = metric?.status ?? 'pending'
            const isRunning = status === 'running'
            const isCompleted = status === 'completed'
            const isSkipped = status === 'skipped'
            const isFailed = status === 'failed'
            const isSelected = phase === selectedVmPhase
            const elapsedSeconds = phaseElapsedSeconds(metric, runtimeNowMs)
            return (
              <button
                key={phase}
                type="button"
                onClick={() => handleSelectPhase(phase)}
                data-state={isSelected ? 'selected' : 'idle'}
                data-status={status}
                aria-pressed={isSelected}
                aria-current={isSelected ? 'step' : undefined}
                className={cn(
                  'workbench-stage-pill px-2.5 py-2 text-left text-[0.73rem] transition-all duration-200 hover:-translate-y-[1px]',
                  phase === activeVmPhase && !isSelected && 'ring-1 ring-accent/30',
                )}
              >
                <div className="font-semibold tracking-[0.006em]">{t(`stages.${phase}.label`)}</div>
                <div className="mt-1 text-[0.68rem] leading-[1.35] opacity-90">
                  {isRunning
                    ? `${t('runtime.working.label')} · ${elapsedSeconds}s`
                    : isSkipped
                      ? `${t('runtime.phase.skipped', { defaultValue: '已跳过' })} · ${elapsedSeconds}s`
                      : isCompleted
                        ? `${t('runtime.phase.completed', { defaultValue: '已完成' })} · ${elapsedSeconds}s`
                        : isFailed
                          ? `${t('runtime.phase.failed', { defaultValue: '失败' })} · ${elapsedSeconds}s`
                          : t('runtime.phase.pending')}
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
