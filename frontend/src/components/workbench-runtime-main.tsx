import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import type { TFunction } from 'i18next'
import {
  CheckCircle2,
  Expand,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Pencil,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { PreText } from './pretext'
import { Button } from './ui/button'
import { TerminalPanel } from './workbench-panels'
import { cn } from '../lib/utils'
import { analyzeVqa, chatVqa, getVqaTrace, searchVqa, streamChatVqa } from '../lib/api'
import type {
  StageKey,
  TaskDetail,
  TranscriptSegment,
  VQACitation,
  VQARetrievalHit,
  VQASearchResponse,
  VQATraceRecord,
  VmPhaseKey,
  VmPhaseMetric,
} from '../types'

const VM_PHASES: VmPhaseKey[] = ['A', 'B', 'C', 'transcript_optimize', 'D']
const D_SUBPHASE_ORDER: VmPhaseKey[] = ['transcript_optimize']
const LARGE_SUMMARY_EDITOR_THRESHOLD = 120_000
type WorkbenchMode = 'flow' | 'qa' | 'debug'
const PHASE_STAGE_MAP: Record<VmPhaseKey, StageKey> = {
  A: 'A',
  B: 'B',
  C: 'C',
  transcript_optimize: 'D',
  D: 'D',
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

function formatTracePayloadSummary(payload: Record<string, unknown>): string {
  const preferredKeys = ['message', 'status', 'query_text', 'answer_preview'] as const
  for (const key of preferredKeys) {
    const candidate = payload[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().slice(0, 200)
    }
  }
  if (payload.error && typeof payload.error === 'object') {
    const maybeError = payload.error as Record<string, unknown>
    const message = maybeError.message
    if (typeof message === 'string' && message.trim()) {
      return message.trim().slice(0, 200)
    }
  }
  try {
    return JSON.stringify(payload).slice(0, 200)
  } catch {
    return ''
  }
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
  notesPanelRef: RefObject<HTMLDivElement | null>
  summaryStream: string
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
  notesPanelRef,
  summaryStream,
  onNotesMarkdownChange,
  mindmapMarkdownPanelRef,
  mindmapStream,
  onMindmapMarkdownChange,
}: WorkbenchRuntimeMainProps) {
  const [manualVmPhaseSelection, setManualVmPhaseSelection] = useState<{ taskId: string; phase: VmPhaseKey } | null>(null)
  const [promptPreviewFullscreen, setPromptPreviewFullscreen] = useState(false)
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>('flow')
  const [qaQuery, setQaQuery] = useState('')
  const [qaBusy, setQaBusy] = useState(false)
  const [qaStatus, setQaStatus] = useState('idle')
  const [qaError, setQaError] = useState('')
  const [qaTraceId, setQaTraceId] = useState('')
  const [qaAnswer, setQaAnswer] = useState('')
  const [qaCitations, setQaCitations] = useState<VQACitation[]>([])
  const [qaSearchDebug, setQaSearchDebug] = useState<VQASearchResponse | null>(null)
  const [qaTraceRecords, setQaTraceRecords] = useState<VQATraceRecord[]>([])
  const transcriptSourcePanelRef = useRef<HTMLDivElement | null>(null)
  const optimizedPanelRef = useRef<HTMLDivElement | null>(null)
  const strictScrollSyncLockedRef = useRef(false)
  const deferredQaAnswer = useDeferredValue(qaAnswer)

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

  useEffect(() => {
    const stage = PHASE_STAGE_MAP[selectedVmPhase]
    if (activeStage !== stage) {
      setActiveStage(stage)
    }
  }, [activeStage, selectedVmPhase, setActiveStage])

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

  useEffect(() => {
    setQaStatus('idle')
    setQaError('')
    setQaTraceId('')
    setQaAnswer('')
    setQaCitations([])
    setQaSearchDebug(null)
    setQaTraceRecords([])
    setQaQuery('')
    setWorkbenchMode('flow')
  }, [activeTask?.id])

  const loadTraceRecords = useCallback(async (traceId: string) => {
    const normalized = traceId.trim()
    if (!normalized) return
    try {
      const payload = await getVqaTrace(normalized)
      startTransition(() => {
        setQaTraceRecords(payload.records ?? [])
      })
    } catch {
      // ignore trace polling failures in UI
    }
  }, [])

  const mapHitsToCitations = useCallback((hits: VQARetrievalHit[]): VQACitation[] => {
    return (hits ?? []).map((item) => ({
      doc_id: item.doc_id,
      task_id: item.task_id,
      task_title: item.task_title,
      source: item.source,
      start: item.start,
      end: item.end,
      text: item.text,
      image_path: item.image_path,
    }))
  }, [])

  const toSearchDebugFromHits = useCallback((traceId: string, queryText: string, hits: VQARetrievalHit[]): VQASearchResponse => {
    return {
      trace_id: traceId,
      query_text: queryText,
      dense_hits: [],
      sparse_hits: [],
      rrf_hits: [],
      rerank_hits: hits ?? [],
      hits: hits ?? [],
    }
  }, [])

  const handleRunQaSearch = useCallback(async () => {
    const queryText = qaQuery.trim()
    if (!queryText) {
      setQaError(t('runtime.qa.queryRequired', { defaultValue: '请输入自然语言问题后再检索。' }))
      return
    }
    setQaBusy(true)
    setQaStatus('searching')
    setQaError('')
    try {
      const payload = await searchVqa({
        query_text: queryText,
        task_id: activeTask?.id,
      })
      startTransition(() => {
        setQaSearchDebug(payload)
        setQaTraceId(payload.trace_id)
        setQaCitations(mapHitsToCitations(payload.hits ?? []))
      })
      void loadTraceRecords(payload.trace_id)
      setQaStatus('searched')
      setWorkbenchMode('debug')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'search failed'
      setQaError(message)
      setQaStatus('error')
    } finally {
      setQaBusy(false)
    }
  }, [activeTask?.id, loadTraceRecords, mapHitsToCitations, qaQuery, t])

  const handleRunQaAnalyze = useCallback(async () => {
    const queryText = qaQuery.trim()
    if (!queryText) {
      setQaError(t('runtime.qa.queryRequired', { defaultValue: '请输入自然语言问题后再执行综合分析。' }))
      return
    }
    setQaBusy(true)
    setQaStatus('analyzing')
    setQaError('')
    setQaAnswer('')
    setQaCitations([])
    setWorkbenchMode('qa')
    try {
      const payload = await analyzeVqa({
        query_text: queryText,
        task_id: activeTask?.id,
      })
      startTransition(() => {
        setQaTraceId(payload.trace_id)
        setQaSearchDebug({
          trace_id: payload.trace_id,
          query_text: payload.query_text,
          dense_hits: payload.retrieval.dense_hits,
          sparse_hits: payload.retrieval.sparse_hits,
          rrf_hits: payload.retrieval.rrf_hits,
          rerank_hits: payload.retrieval.rerank_hits,
          hits: payload.hits,
        })
        setQaAnswer(payload.chat.answer)
        setQaCitations(payload.chat.citations)
      })
      void loadTraceRecords(payload.trace_id)
      setQaStatus('done')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'analyze failed'
      setQaError(message)
      setQaStatus('error')
    } finally {
      setQaBusy(false)
    }
  }, [activeTask?.id, loadTraceRecords, qaQuery, t])

  const handleRunQaChatOnce = useCallback(async () => {
    const queryText = qaQuery.trim()
    if (!queryText) {
      setQaError(t('runtime.qa.queryRequired', { defaultValue: '请输入自然语言问题后再执行问答。' }))
      return
    }
    setQaBusy(true)
    setQaStatus('chat_once')
    setQaError('')
    setQaAnswer('')
    setQaCitations([])
    setWorkbenchMode('qa')
    try {
      const payload = await chatVqa({
        query_text: queryText,
        task_id: activeTask?.id,
      })
      startTransition(() => {
        setQaTraceId(payload.trace_id)
        setQaAnswer(payload.answer)
        setQaCitations(payload.citations?.length ? payload.citations : mapHitsToCitations(payload.hits ?? []))
        setQaSearchDebug(toSearchDebugFromHits(payload.trace_id, queryText, payload.hits ?? []))
      })
      void loadTraceRecords(payload.trace_id)
      setQaStatus(payload.error ? 'error' : 'done')
      if (payload.error?.message) {
        setQaError(payload.error.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'chat failed'
      setQaError(message)
      setQaStatus('error')
    } finally {
      setQaBusy(false)
    }
  }, [activeTask?.id, loadTraceRecords, mapHitsToCitations, qaQuery, t, toSearchDebugFromHits])

  const handleRunQaChat = useCallback(async () => {
    const queryText = qaQuery.trim()
    if (!queryText) {
      setQaError(t('runtime.qa.queryRequired', { defaultValue: '请输入自然语言问题后再问答。' }))
      return
    }
    setQaBusy(true)
    setQaStatus('streaming')
    setQaError('')
    setQaAnswer('')
    setQaCitations([])
    setWorkbenchMode('qa')
    try {
      await streamChatVqa(
        {
          query_text: queryText,
          task_id: activeTask?.id,
        },
        {
          onCitations: (items, traceId) => {
            startTransition(() => {
              setQaCitations(items)
              if (traceId) setQaTraceId(traceId)
            })
          },
          onChunk: (chunk, traceId) => {
            startTransition(() => {
              setQaAnswer((prev) => `${prev}${chunk}`)
              if (traceId) setQaTraceId(traceId)
            })
          },
          onError: (message, traceId) => {
            setQaError(message)
            if (traceId) setQaTraceId(traceId)
            setQaStatus('error')
          },
          onStatus: (status, traceId) => {
            if (traceId) setQaTraceId(traceId)
            if (status) setQaStatus(status)
          },
          onDone: (traceId) => {
            if (traceId) {
              setQaTraceId(traceId)
              void loadTraceRecords(traceId)
            }
            setQaStatus('done')
          },
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'chat failed'
      setQaError(message)
      setQaStatus('error')
    } finally {
      setQaBusy(false)
    }
  }, [activeTask?.id, loadTraceRecords, qaQuery, t])

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
  const summaryCharCount = summaryStream.length
  const shouldFallbackToPlainSummaryEditor = summaryCharCount > LARGE_SUMMARY_EDITOR_THRESHOLD
  const modeTabs = useMemo(
    () => [
      {
        value: 'flow' as const,
        label: t('runtime.mode.flow', { defaultValue: '流程分析' }),
        shortcut: 'Ctrl/Cmd + Shift + 1',
      },
      {
        value: 'qa' as const,
        label: t('runtime.mode.qa', { defaultValue: '证据问答' }),
        shortcut: 'Ctrl/Cmd + Shift + 2',
      },
      {
        value: 'debug' as const,
        label: t('runtime.mode.debug', { defaultValue: '检索调试' }),
        shortcut: 'Ctrl/Cmd + Shift + 3',
      },
    ],
    [t],
  )
  const qaStatusMeta = useMemo(() => {
    const status = qaStatus.toLowerCase()
    if (status === 'searching' || status === 'streaming' || status === 'analyzing' || status === 'chat_once') {
      return {
        text: t('runtime.qa.status.running', { defaultValue: '处理中' }),
        className: 'border-info/40 bg-info/10 text-info',
      }
    }
    if (status === 'done' || status === 'searched') {
      return {
        text: t('runtime.qa.status.done', { defaultValue: '已完成' }),
        className: 'border-success/40 bg-success/10 text-success',
      }
    }
    if (status === 'error') {
      return {
        text: t('runtime.qa.status.error', { defaultValue: '失败' }),
        className: 'border-danger/40 bg-danger/10 text-danger',
      }
    }
    return {
      text: t('runtime.qa.status.idle', { defaultValue: '待执行' }),
      className: 'border-border/70 bg-surface-muted/70 text-text-subtle',
    }
  }, [qaStatus, t])

  const handleSelectPhase = useCallback((phase: VmPhaseKey) => {
    setManualVmPhaseSelection({
      taskId: activeTask?.id ?? '__no_task__',
      phase,
    })
    setActiveStage(PHASE_STAGE_MAP[phase])
  }, [activeTask?.id, setActiveStage])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.shiftKey) {
        if (event.key === '1') {
          event.preventDefault()
          setWorkbenchMode('flow')
          return
        }
        if (event.key === '2') {
          event.preventDefault()
          setWorkbenchMode('qa')
          return
        }
        if (event.key === '3') {
          event.preventDefault()
          setWorkbenchMode('debug')
          return
        }
        return
      }
      if (event.key === '1') {
        event.preventDefault()
        handleSelectPhase('A')
      } else if (event.key === '2') {
        event.preventDefault()
        handleSelectPhase('B')
      } else if (event.key === '3') {
        event.preventDefault()
        handleSelectPhase('C')
      } else if (event.key === '4') {
        event.preventDefault()
        handleSelectPhase('transcript_optimize')
      } else if (event.key === '5') {
        event.preventDefault()
        handleSelectPhase('D')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSelectPhase])

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

  const renderCitationCards = () => {
    if (!qaCitations.length) {
      return (
        <div className="rounded-lg border border-border/70 bg-surface-muted/45 px-3 py-4 text-sm text-text-subtle">
          {t('runtime.qa.emptyCitations', { defaultValue: '暂无可展示的证据引用。' })}
        </div>
      )
    }
    return (
      <div className="space-y-2.5">
        {qaCitations.map((citation, index) => {
          const sourceClass =
            citation.source === 'audio+visual'
              ? 'border-accent/40 bg-accent/8 text-accent'
              : citation.source.includes('visual')
                ? 'border-indigo-400/45 bg-indigo-500/10 text-indigo-500'
                : 'border-cyan-400/45 bg-cyan-500/10 text-cyan-500'
          return (
            <article key={`${citation.doc_id}-${citation.start}-${index}`} className="rounded-xl border border-border/75 bg-bg-base/80 px-3 py-2.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.04em]', sourceClass)}>
                  {citation.source || 'unknown'}
                </span>
                <span className="text-xs font-mono text-text-subtle">{formatSegmentRange(citation.start, citation.end)}</span>
                <span className="text-xs text-text-subtle">{citation.task_title || citation.task_id}</span>
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-text-main">{citation.text}</p>
              {citation.image_path && (
                <a
                  className="mt-2 inline-flex text-xs text-accent underline-offset-4 hover:underline"
                  href={citation.image_path}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('runtime.qa.openImage', { defaultValue: '打开证据图片' })}
                </a>
              )}
            </article>
          )
        })}
      </div>
    )
  }

  const renderTraceRecords = () => {
    if (!qaTraceId) {
      return (
        <div className="rounded-lg border border-border/70 bg-surface-muted/45 px-3 py-4 text-sm text-text-subtle">
          {t('runtime.qa.tracePlaceholder', { defaultValue: '执行检索或问答后可查看 trace 回放。' })}
        </div>
      )
    }
    if (!qaTraceRecords.length) {
      return (
        <div className="rounded-lg border border-border/70 bg-surface-muted/45 px-3 py-4 text-sm text-text-subtle">
          {t('runtime.qa.traceLoading', { defaultValue: '正在加载 trace 记录，或当前 trace 暂无事件。' })}
        </div>
      )
    }
    return (
      <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
        {qaTraceRecords.map((record, index) => {
          const summary = formatTracePayloadSummary(record.payload)
          return (
            <article key={`${record.ts}-${record.stage}-${index}`} className="rounded-lg border border-border/70 bg-bg-base/85 px-3 py-2.5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-md border border-border/70 bg-surface-muted/65 px-1.5 py-0.5 text-[0.68rem] font-mono uppercase tracking-[0.04em] text-text-subtle">
                  {record.stage}
                </span>
                <span className="text-[0.68rem] font-mono text-text-subtle">{record.ts}</span>
              </div>
              {summary ? (
                <p className="text-xs leading-5 text-text-main">{summary}</p>
              ) : (
                <p className="text-xs text-text-subtle">{t('runtime.qa.traceNoPayload', { defaultValue: '无可展示摘要。' })}</p>
              )}
            </article>
          )
        })}
      </div>
    )
  }

  const renderRetrievalColumn = (
    title: string,
    hits: VQARetrievalHit[],
    scoreField: keyof Pick<VQARetrievalHit, 'dense_score' | 'sparse_score' | 'rrf_score' | 'rerank_score' | 'final_score'>,
  ) => {
    return (
      <section className="runtime-panel h-[360px] rounded-xl border p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <PreText variant="timestamp" className="runtime-panel-caption">
            {title}
          </PreText>
          <span className="text-xs font-mono text-text-subtle">
            {t('runtime.qa.hitsCount', { defaultValue: '{{count}} 条', count: hits.length })}
          </span>
        </div>
        {!hits.length ? (
          <div className="rounded-lg border border-border/70 bg-surface-muted/50 px-3 py-4 text-xs text-text-subtle">
            {t('runtime.qa.noHits', { defaultValue: '暂无命中结果。' })}
          </div>
        ) : (
          <div className="h-[300px] space-y-2 overflow-auto pr-1">
            {hits.map((item, index) => {
              const score = parseNumeric(item[scoreField], 0)
              return (
                <article key={`${item.doc_id}-${index}`} className="rounded-lg border border-border/70 bg-bg-base/85 px-2.5 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-text-subtle">{formatSegmentRange(item.start, item.end)}</span>
                    <span className="rounded-md border border-accent/35 bg-accent/10 px-1.5 py-0.5 font-mono text-accent">
                      {score.toFixed(4)}
                    </span>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-text-main">{item.text}</p>
                </article>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  const renderQaWorkspace = () => (
    <div className="grid gap-3 xl:grid-cols-[1.28fr_0.92fr]">
      <section className="runtime-panel min-h-[420px] rounded-xl border p-3 text-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <PreText variant="timestamp" className="runtime-panel-caption">
            {t('runtime.qa.answerPanel', { defaultValue: '回答流' })}
          </PreText>
          {qaBusy && <LoaderCircle className="h-4 w-4 animate-spin text-accent" />}
        </div>
        <div className="max-h-[510px] overflow-auto rounded-lg border border-border/70 bg-bg-base px-3 py-2">
          {deferredQaAnswer ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{deferredQaAnswer}</ReactMarkdown>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-text-subtle">
              {t('runtime.qa.answerPlaceholder', { defaultValue: '输入问题后点击“开始问答”，这里会实时显示回答。' })}
            </p>
          )}
        </div>
      </section>
      <div className="space-y-3">
        <section className="runtime-panel rounded-xl border p-3 text-sm">
          <PreText variant="timestamp" className="runtime-panel-caption mb-2">
            {t('runtime.qa.citationsPanel', { defaultValue: '证据引用' })}
          </PreText>
          {renderCitationCards()}
        </section>
        <section className="runtime-panel rounded-xl border p-3 text-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <PreText variant="timestamp" className="runtime-panel-caption">
              {t('runtime.qa.tracePanel', { defaultValue: 'Trace 回放' })}
            </PreText>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!qaTraceId || qaBusy}
              onClick={() => void loadTraceRecords(qaTraceId)}
            >
              {t('runtime.qa.refreshTrace', { defaultValue: '刷新' })}
            </Button>
          </div>
          {renderTraceRecords()}
        </section>
      </div>
    </div>
  )

  const renderDebugWorkspace = () => (
    <div className="space-y-3">
      <div className="grid gap-3 2xl:grid-cols-4 xl:grid-cols-2">
        {renderRetrievalColumn('Dense', qaSearchDebug?.dense_hits ?? [], 'dense_score')}
        {renderRetrievalColumn('Sparse', qaSearchDebug?.sparse_hits ?? [], 'sparse_score')}
        {renderRetrievalColumn('RRF', qaSearchDebug?.rrf_hits ?? [], 'rrf_score')}
        {renderRetrievalColumn('Rerank', qaSearchDebug?.rerank_hits ?? [], 'rerank_score')}
      </div>
      <section className="runtime-panel rounded-xl border p-3 text-sm">
        <PreText variant="timestamp" className="runtime-panel-caption mb-2">
          {t('runtime.qa.tracePanel', { defaultValue: 'Trace 回放' })}
        </PreText>
        {renderTraceRecords()}
      </section>
    </div>
  )

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
      )
    }
    return (
      <div className="grid gap-3">
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
          {shouldFallbackToPlainSummaryEditor ? (
            <div ref={notesPanelRef} className="mt-2 space-y-2">
              <div className="rounded-lg border border-warning/45 bg-warning/10 px-3 py-2 text-xs leading-5 text-text-main">
                {t('runtime.stageD.largeSummaryFallback', {
                  defaultValue:
                    '当前摘要内容较大（{{count}} 字符），已切换到轻量编辑模式以避免页面卡顿。',
                  count: summaryCharCount,
                })}
              </div>
              <textarea
                className="h-[500px] w-full resize-none rounded-xl border border-border/80 bg-bg-base px-3 py-2 font-mono text-sm leading-6 text-text-main outline-none transition-colors focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-80"
                value={summaryStream}
                readOnly={!canEditStageDMarkdown || savingArtifacts}
                onChange={(event) => {
                  if (!canEditStageDMarkdown || savingArtifacts) return
                  onNotesMarkdownChange(event.target.value)
                }}
                placeholder={t('runtime.stageD.waitingSummary')}
              />
            </div>
          ) : (
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
                  value={summaryStream}
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
          )}
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
            {t('runtime.metrics.logs', { count: activeStageLogCount })}
          </span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-surface-muted/40 p-1.5">
          {modeTabs.map((item) => {
            const selected = item.value === workbenchMode
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setWorkbenchMode(item.value)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  selected
                    ? 'border-accent/55 bg-accent/12 text-accent'
                    : 'border-transparent text-text-subtle hover:border-border/70 hover:bg-bg-base/75',
                )}
                title={item.shortcut}
              >
                {item.label}
              </button>
            )
          })}
        </div>

        {workbenchMode !== 'flow' && (
          <section className="mb-4 runtime-panel rounded-xl border p-3 text-sm">
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto_auto] lg:items-start">
              <textarea
                value={qaQuery}
                onChange={(event) => setQaQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  if (!event.ctrlKey && !event.metaKey) return
                  event.preventDefault()
                  if (event.shiftKey) {
                    void handleRunQaSearch()
                  } else {
                    void handleRunQaChat()
                  }
                }}
                placeholder={t('runtime.qa.queryPlaceholder', {
                  defaultValue: '输入自然语言问题。Ctrl/Cmd + Enter 运行问答，Ctrl/Cmd + Shift + Enter 运行检索。',
                })}
                className="h-[84px] w-full resize-none rounded-xl border border-border/80 bg-bg-base px-3 py-2 text-sm leading-6 text-text-main outline-none transition-colors focus:border-accent/70"
              />
              <Button type="button" variant="secondary" disabled={qaBusy} onClick={() => void handleRunQaSearch()}>
                {qaBusy && qaStatus === 'searching' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('runtime.qa.searchAction', { defaultValue: '仅检索' })}
              </Button>
              <Button type="button" variant="outline" disabled={qaBusy} onClick={() => void handleRunQaAnalyze()}>
                {qaBusy && qaStatus === 'analyzing' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('runtime.qa.analyzeAction', { defaultValue: '综合分析' })}
              </Button>
              <Button type="button" disabled={qaBusy} onClick={() => void handleRunQaChat()}>
                {qaBusy && qaStatus === 'streaming' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('runtime.qa.chatStreamAction', { defaultValue: '流式问答' })}
              </Button>
              <Button type="button" variant="outline" disabled={qaBusy} onClick={() => void handleRunQaChatOnce()}>
                {qaBusy && qaStatus === 'chat_once' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('runtime.qa.chatAction', { defaultValue: '快速问答' })}
              </Button>
              <Button type="button" variant="outline" disabled={!qaTraceId || qaBusy} onClick={() => void loadTraceRecords(qaTraceId)}>
                {t('runtime.qa.refreshTrace', { defaultValue: '刷新 Trace' })}
              </Button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
              <span className={cn('rounded-full border px-2 py-0.5', qaStatusMeta.className)}>{qaStatusMeta.text}</span>
              {qaTraceId && (
                <span className="rounded-full border border-border/70 bg-surface-muted/65 px-2 py-0.5 font-mono text-text-subtle">
                  trace: {qaTraceId}
                </span>
              )}
              {qaError && (
                <span className="rounded-full border border-danger/45 bg-danger/10 px-2 py-0.5 text-danger">
                  {qaError}
                </span>
              )}
            </div>
          </section>
        )}

        {workbenchMode === 'flow' ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-8">
              {VM_PHASES.map((phase) => {
                const metric = vmPhaseMetrics[phase]
                const status = metric?.status ?? 'pending'
                const isSelected = phase === selectedVmPhase
                const phaseDescription = t(`stages.${phase}.description`)
                const elapsedSeconds = phaseElapsedSeconds(metric, runtimeNowMs)
                const phaseStatusSummary =
                  status === 'running'
                    ? t('runtime.working.label')
                    : status === 'skipped'
                      ? t('runtime.phase.skipped', { defaultValue: '已跳过' })
                      : status === 'completed'
                        ? t('runtime.phase.completed', { defaultValue: '已完成' })
                        : status === 'failed'
                          ? t('runtime.phase.failed', { defaultValue: '失败' })
                          : t('runtime.phase.pending')
                return (
                  <button
                    key={phase}
                    type="button"
                    onClick={() => handleSelectPhase(phase)}
                    data-state={isSelected ? 'selected' : 'idle'}
                    data-status={status}
                    aria-pressed={isSelected}
                    aria-current={isSelected ? 'step' : undefined}
                    aria-label={`${t(`stages.${phase}.label`)}：${phaseDescription}，${phaseStatusSummary}，${elapsedSeconds}s`}
                    className={cn(
                      'workbench-stage-pill group relative min-h-[3.6rem] px-[0.72rem] py-[0.7rem] pr-9 text-left text-[0.74rem] transition-all duration-200',
                      phase === activeVmPhase && !isSelected && 'ring-1 ring-accent/30',
                    )}
                  >
                    <span
                      className="runtime-phase-bubble-trigger pointer-events-none absolute right-[0.42rem] top-[0.42rem] inline-flex h-5.5 w-5.5 items-center justify-center rounded-[0.72rem] transition-all duration-200 group-hover:border-accent/35 group-hover:bg-accent/8 group-hover:text-accent group-focus-visible:border-accent/35 group-focus-visible:bg-accent/8 group-focus-visible:text-accent"
                      aria-hidden="true"
                    >
                      <MessageCircle className="h-3 w-3" />
                    </span>
                    <span className="runtime-phase-tooltip pointer-events-none absolute bottom-[calc(100%+0.55rem)] right-0 z-20 w-[14.75rem] max-w-[calc(100vw-4rem)] translate-y-[4px] scale-[0.985] opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:scale-100 group-focus-visible:opacity-100">
                      <span className="runtime-phase-tooltip__tail" aria-hidden="true" />
                      <span className="runtime-phase-tooltip__body block">
                        <span className="mb-1 flex items-center gap-1.5 text-[0.69rem] font-semibold text-accent">
                          <MessageCircle className="h-3.25 w-3.25" />
                          {t(`stages.${phase}.label`)}
                        </span>
                        <span className="block text-[0.72rem] leading-5 text-text-main">
                          {phaseDescription}
                        </span>
                        <span className="mt-2 block text-[0.68rem] leading-4 text-text-subtle">
                          {phaseStatusSummary} · {elapsedSeconds}s
                        </span>
                      </span>
                    </span>
                    <div className="max-w-[12.5ch] pr-1 font-semibold leading-[1.24] tracking-[0.002em]">
                      {t(`stages.${phase}.label`)}
                    </div>
                    <div
                      className={cn(
                        'absolute inset-x-[0.72rem] bottom-[0.42rem] h-[2px] rounded-full opacity-0 transition-opacity duration-200',
                        status === 'running' && 'bg-[var(--color-info)] opacity-100',
                        status === 'completed' && 'bg-[var(--color-success)] opacity-100',
                        status === 'failed' && 'bg-[var(--color-danger)] opacity-100',
                        isSelected &&
                          status !== 'running' &&
                          status !== 'completed' &&
                          status !== 'failed' &&
                          'bg-[var(--color-accent)] opacity-100',
                      )}
                      aria-hidden="true"
                    />
                    <div className="sr-only">{phaseDescription}</div>
                  </button>
                )
              })}
            </div>
            <div key={selectedVmPhase} className="runtime-phase-panel">
              {renderPhasePanel()}
            </div>
          </>
        ) : null}

        {workbenchMode === 'qa' ? renderQaWorkspace() : null}
        {workbenchMode === 'debug' ? renderDebugWorkspace() : null}
        {workbenchMode !== 'flow' && !activeTask ? (
          <p className="mt-2 text-xs text-warning">
            {t('runtime.qa.noTaskHint', { defaultValue: '当前未选择任务，将对历史任务集合执行检索。' })}
          </p>
        ) : null}
        {workbenchMode === 'debug' && !qaSearchDebug ? (
          <p className="mt-2 text-xs text-text-subtle">
            {t('runtime.qa.debugHint', { defaultValue: '请先执行“仅检索”或“开始问答”，以生成 Dense/Sparse/RRF/Rerank 对照结果。' })}
          </p>
        ) : null}
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
