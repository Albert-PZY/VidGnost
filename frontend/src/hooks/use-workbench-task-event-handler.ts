import { useCallback, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import toast from 'react-hot-toast'

import { formatLogLine, formatRuntimeWarningLine, normalizeFusionPromptPreview, parseTaskStatus } from '../app/workbench-config'
import type {
  StageKey,
  TaskDetail,
  TaskEvent,
  TaskSummaryItem,
  TranscriptSegment,
  VmPhaseKey,
  VmPhaseMetric,
} from '../types'

interface UseWorkbenchTaskEventHandlerOptions {
  t: TFunction
  activeTaskId: string | null
  activeStage: StageKey
  flushBufferedStream: () => void
  refreshTaskDetail: (taskId: string) => Promise<void>
  loadHistory: () => Promise<void>
  setActiveStage: Dispatch<SetStateAction<StageKey>>
  setStageTimers: Dispatch<SetStateAction<Record<StageKey, number | null>>>
  setActiveVmPhase: Dispatch<SetStateAction<VmPhaseKey>>
  setVmPhaseMetrics: Dispatch<SetStateAction<Record<VmPhaseKey, VmPhaseMetric>>>
  setRuntimeNowMs: Dispatch<SetStateAction<number>>
  setOverallProgress: Dispatch<SetStateAction<number>>
  setCancellingTask: Dispatch<SetStateAction<boolean>>
  setRerunningStageD: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  updateActiveTaskRealtime: (patch: Partial<Pick<TaskDetail, 'status' | 'progress' | 'error_message'>>) => void
  updateHistoryRealtime: (taskId: string, patch: Partial<Pick<TaskSummaryItem, 'status' | 'progress'>>) => void
  appendLog: (stage: StageKey, message: string) => void
  appendTranscript: (text: string) => void
  appendTranscriptSegment: (segment: TranscriptSegment) => void
  appendTranscriptOptimized: (
    text: string,
    reset?: boolean,
    streamMode?: 'realtime' | 'compat',
    start?: number,
    end?: number,
  ) => void
  appendSummary: (text: string, streamMode?: 'realtime' | 'compat') => void
  appendMindmap: (text: string, streamMode?: 'realtime' | 'compat') => void
  appendNotes: (text: string, streamMode?: 'realtime' | 'compat') => void
  setFusionPromptPreview: Dispatch<SetStateAction<string>>
  resetStageDRealtime: () => void
  flushOptimizedTranscript: () => void
}

export function useWorkbenchTaskEventHandler({
  t,
  activeTaskId,
  activeStage,
  flushBufferedStream,
  refreshTaskDetail,
  loadHistory,
  setActiveStage,
  setStageTimers,
  setActiveVmPhase,
  setVmPhaseMetrics,
  setRuntimeNowMs,
  setOverallProgress,
  setCancellingTask,
  setRerunningStageD,
  setError,
  updateActiveTaskRealtime,
  updateHistoryRealtime,
  appendLog,
  appendTranscript,
  appendTranscriptSegment,
  appendTranscriptOptimized,
  appendSummary,
  appendMindmap,
  appendNotes,
  setFusionPromptPreview,
  resetStageDRealtime,
  flushOptimizedTranscript,
}: UseWorkbenchTaskEventHandlerOptions) {
  const notesDeltaReceivedRef = useRef(false)
  const resolveVmPhaseBySubstage = useCallback((substage: string | undefined): VmPhaseKey | null => {
    if (!substage) return null
    if (substage === 'fusion_delivery') return 'D'
    if (substage === 'transcript_optimize') {
      return substage
    }
    return null
  }, [])

  return useCallback((event: TaskEvent) => {
    const markVmPhaseRunning = (phase: VmPhaseKey) => {
      const nowIso = new Date().toISOString()
      setActiveVmPhase(phase)
      setVmPhaseMetrics((prev) => ({
        ...prev,
        [phase]: {
          ...prev[phase],
          status: 'running',
          started_at: prev[phase]?.started_at ?? nowIso,
          completed_at: null,
          elapsed_seconds: null,
          reason: null,
        },
      }))
    }

    const markVmPhaseTerminal = (phase: VmPhaseKey, status: VmPhaseMetric['status'], reason: string | null = null) => {
      const nowIso = new Date().toISOString()
      setVmPhaseMetrics((prev) => {
        const current = prev[phase]
        const startedAt = current?.started_at
        let elapsed = current?.elapsed_seconds ?? null
        if (startedAt) {
          const startedMs = Date.parse(startedAt)
          if (!Number.isNaN(startedMs)) {
            elapsed = Math.max(0, Math.round(((Date.now() - startedMs) / 1000) * 100) / 100)
          }
        }
        return {
          ...prev,
          [phase]: {
            ...current,
            status,
            completed_at: nowIso,
            elapsed_seconds: elapsed,
            reason,
          },
        }
      })
    }

    if (event.type === 'stage_start' && event.stage) {
      if (event.stage === 'D') {
        setRerunningStageD(false)
      }
      setActiveStage(event.stage)
      if (event.stage === 'D') {
        notesDeltaReceivedRef.current = false
        resetStageDRealtime()
      }
      setStageTimers((prev) => ({
        ...prev,
        [event.stage as StageKey]: Date.now(),
      }))
      if (event.stage === 'D') {
        // Keep H pending before fusion starts; D is represented by sub-phases E/F/G/H.
        setVmPhaseMetrics((prev) => ({
          ...prev,
          D: {
            ...prev.D,
            status: 'pending',
            started_at: null,
            completed_at: null,
            elapsed_seconds: null,
            reason: null,
          },
        }))
        setActiveVmPhase('transcript_optimize')
      } else {
        markVmPhaseRunning(event.stage)
      }
      setRuntimeNowMs(Date.now())
      if (typeof event.overall_progress === 'number') {
        const nextProgress = Math.max(0, Math.min(100, event.overall_progress))
        setOverallProgress(nextProgress)
        if (activeTaskId) {
          updateActiveTaskRealtime({ progress: nextProgress })
          updateHistoryRealtime(activeTaskId, { progress: nextProgress })
        }
      }
      const stageStatus = parseTaskStatus(event.status)
      if (stageStatus) {
        updateActiveTaskRealtime({ status: stageStatus })
        if (activeTaskId) {
          updateHistoryRealtime(activeTaskId, { status: stageStatus })
        }
      } else if (event.stage === 'C') {
        updateActiveTaskRealtime({ status: 'transcribing' })
        if (activeTaskId) {
          updateHistoryRealtime(activeTaskId, { status: 'transcribing' })
        }
      } else if (event.stage === 'D') {
        updateActiveTaskRealtime({ status: 'summarizing' })
        if (activeTaskId) {
          updateHistoryRealtime(activeTaskId, { status: 'summarizing' })
        }
      }
    }
    if (event.type === 'substage_start') {
      setRerunningStageD(false)
      const vmPhase = resolveVmPhaseBySubstage(event.substage)
      if (vmPhase) {
        markVmPhaseRunning(vmPhase)
      }
    }
    if (event.type === 'substage_complete') {
      const vmPhase = resolveVmPhaseBySubstage(event.substage)
      if (vmPhase) {
        const status =
          event.status === 'completed' || event.status === 'skipped' || event.status === 'failed'
            ? event.status
            : 'completed'
        markVmPhaseTerminal(vmPhase, status, event.message ?? null)
      }
      if (typeof event.overall_progress === 'number') {
        const nextProgress = Math.max(0, Math.min(100, event.overall_progress))
        setOverallProgress(nextProgress)
        if (activeTaskId) {
          updateActiveTaskRealtime({ progress: nextProgress })
          updateHistoryRealtime(activeTaskId, { progress: nextProgress })
        }
      }
    }
    if (event.type === 'log' && event.stage && event.message) {
      appendLog(event.stage, formatLogLine(event))
    }
    if (event.type === 'runtime_warning' && event.message) {
      const stage = event.stage ?? activeStage
      appendLog(stage, formatRuntimeWarningLine(event))
      toast.error(event.code ? `${event.code}: ${event.message}` : event.message)
    }
    if (event.type === 'progress' && typeof event.overall_progress === 'number') {
      const nextProgress = Math.max(0, Math.min(100, event.overall_progress))
      setOverallProgress(nextProgress)
      if (activeTaskId) {
        updateActiveTaskRealtime({ progress: nextProgress })
        updateHistoryRealtime(activeTaskId, { progress: nextProgress })
      }
    }
    if (event.type === 'transcript_delta') {
      const text = event.text ?? ''
      appendTranscript(text)
      if (typeof event.start === 'number' && typeof event.end === 'number' && text.trim()) {
        appendTranscriptSegment({
          start: Math.max(0, event.start),
          end: Math.max(Math.max(0, event.start), event.end),
          text: text.trim(),
        })
      }
    }
    if (event.type === 'transcript_optimized_preview') {
      appendTranscriptOptimized(
        event.text ?? '',
        Boolean(event.reset),
        event.stream_mode ?? 'realtime',
        typeof event.start === 'number' ? event.start : undefined,
        typeof event.end === 'number' ? event.end : undefined,
      )
      if (event.done) {
        // Finalize transcript-optimization stream state.
        flushOptimizedTranscript()
      }
    }
    if (event.type === 'fusion_prompt_preview') {
      setFusionPromptPreview(normalizeFusionPromptPreview((event.text ?? event.markdown ?? '').trim()))
    }
    if (event.type === 'summary_delta') {
      appendSummary(event.text ?? '', event.stream_mode ?? 'realtime')
      if (!notesDeltaReceivedRef.current) {
        appendNotes(event.text ?? '', event.stream_mode ?? 'realtime')
      }
    }
    if (event.type === 'notes_delta') {
      notesDeltaReceivedRef.current = true
      appendNotes(event.text ?? '', event.stream_mode ?? 'realtime')
    }
    if (event.type === 'mindmap_delta') {
      appendMindmap(event.text ?? '', event.stream_mode ?? 'realtime')
    }
    if (event.type === 'stage_complete' && event.stage) {
      markVmPhaseTerminal(event.stage, 'completed')
      if (typeof event.overall_progress === 'number') {
        const nextProgress = Math.max(0, Math.min(100, event.overall_progress))
        setOverallProgress(nextProgress)
        if (activeTaskId) {
          updateActiveTaskRealtime({ progress: nextProgress })
          updateHistoryRealtime(activeTaskId, { progress: nextProgress })
        }
      }
    }
    if (event.type === 'task_complete') {
      setRerunningStageD(false)
      markVmPhaseTerminal('D', 'completed')
      setActiveVmPhase('D')
      notesDeltaReceivedRef.current = false
      flushOptimizedTranscript()
      flushBufferedStream()
      setOverallProgress(100)
      setRuntimeNowMs(Date.now())
      setCancellingTask(false)
      updateActiveTaskRealtime({ status: 'completed', progress: 100, error_message: null })
      if (activeTaskId) {
        updateHistoryRealtime(activeTaskId, { status: 'completed', progress: 100 })
      }
      if (activeTaskId) {
        void refreshTaskDetail(activeTaskId)
        void loadHistory()
      }
    }
    if (event.type === 'task_cancelled') {
      setRerunningStageD(false)
      markVmPhaseTerminal(activeStage, 'failed', event.error ?? 'cancelled')
      notesDeltaReceivedRef.current = false
      flushOptimizedTranscript()
      flushBufferedStream()
      setCancellingTask(false)
      setRuntimeNowMs(Date.now())
      setError(null)
      updateActiveTaskRealtime({ status: 'cancelled', error_message: event.error ?? null })
      if (activeTaskId) {
        updateHistoryRealtime(activeTaskId, { status: 'cancelled' })
        void refreshTaskDetail(activeTaskId)
        void loadHistory()
      }
    }
    if (event.type === 'task_failed') {
      setRerunningStageD(false)
      const fallbackPhase = resolveVmPhaseBySubstage(event.substage) ?? activeStage
      markVmPhaseTerminal(fallbackPhase, 'failed', event.error ?? t('errors.taskFailed'))
      flushOptimizedTranscript()
      flushBufferedStream()
      setCancellingTask(false)
      setRuntimeNowMs(Date.now())
      setError(event.error ?? t('errors.taskFailed'))
      updateActiveTaskRealtime({ status: 'failed', error_message: event.error ?? t('errors.taskFailed') })
      if (activeTaskId) {
        updateHistoryRealtime(activeTaskId, { status: 'failed' })
      }
      if (activeTaskId) {
        void refreshTaskDetail(activeTaskId)
        void loadHistory()
      }
      notesDeltaReceivedRef.current = false
    }
  }, [
    activeStage,
    activeTaskId,
    appendLog,
    appendMindmap,
    appendSummary,
    appendNotes,
    appendTranscript,
    appendTranscriptOptimized,
    appendTranscriptSegment,
    flushOptimizedTranscript,
    flushBufferedStream,
    loadHistory,
    resetStageDRealtime,
    refreshTaskDetail,
    setActiveStage,
    setActiveVmPhase,
    setCancellingTask,
    setRerunningStageD,
    setError,
    setOverallProgress,
    setRuntimeNowMs,
    setStageTimers,
    setFusionPromptPreview,
    setVmPhaseMetrics,
    t,
    updateActiveTaskRealtime,
    updateHistoryRealtime,
    resolveVmPhaseBySubstage,
  ])
}
