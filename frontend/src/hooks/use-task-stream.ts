import { useCallback, useEffect, useRef, useState } from 'react'

import type { StageKey } from '../types'

const STAGES: StageKey[] = ['A', 'B', 'C', 'D']
const DEFAULT_STREAM_FLUSH_INTERVAL_MS = 120
type StreamMode = 'realtime' | 'compat'

export function createEmptyStageLogs(): Record<StageKey, string[]> {
  return { A: [], B: [], C: [], D: [] }
}

export function createEmptyStageTimers(): Record<StageKey, number | null> {
  return { A: null, B: null, C: null, D: null }
}

function hasPendingStageLogs(logs: Record<StageKey, string[]>): boolean {
  return STAGES.some((stage) => logs[stage].length > 0)
}

interface UseTaskStreamOptions {
  isTaskRunning: boolean
  onReset?: () => void
  flushIntervalMs?: number
}

export function useTaskStream({
  isTaskRunning,
  onReset,
  flushIntervalMs = DEFAULT_STREAM_FLUSH_INTERVAL_MS,
}: UseTaskStreamOptions) {
  const [activeStage, setActiveStage] = useState<StageKey>('A')
  const [overallProgress, setOverallProgress] = useState(0)
  const [stageLogs, setStageLogs] = useState<Record<StageKey, string[]>>(createEmptyStageLogs)
  const [stageTimers, setStageTimers] = useState<Record<StageKey, number | null>>(createEmptyStageTimers)
  const [runtimeNowMs, setRuntimeNowMs] = useState<number>(() => Date.now())
  const [transcriptStream, setTranscriptStream] = useState('')
  const [summaryStream, setSummaryStream] = useState('')
  const [notesStream, setNotesStream] = useState('')
  const [mindmapStream, setMindmapStream] = useState('')

  const flushTimerRef = useRef<number | null>(null)
  const pendingLogsRef = useRef<Record<StageKey, string[]>>(createEmptyStageLogs())
  const pendingTranscriptRef = useRef<string[]>([])
  const pendingSummaryRef = useRef<string[]>([])
  const pendingNotesRef = useRef<string[]>([])
  const pendingMindmapRef = useRef<string[]>([])

  const flushBufferedStream = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }

    const pendingLogs = pendingLogsRef.current
    if (hasPendingStageLogs(pendingLogs)) {
      setStageLogs((prev) => {
        const next = createEmptyStageLogs()
        for (const stage of STAGES) {
          next[stage] = prev[stage].concat(pendingLogs[stage])
        }
        return next
      })
      pendingLogsRef.current = createEmptyStageLogs()
    }

    if (pendingTranscriptRef.current.length > 0) {
      const chunk = pendingTranscriptRef.current.join('\n')
      pendingTranscriptRef.current = []
      setTranscriptStream((prev) => `${prev}${prev.endsWith('\n') || prev.length === 0 ? '' : '\n'}${chunk}`)
    }

    if (pendingSummaryRef.current.length > 0) {
      const chunk = pendingSummaryRef.current.join('')
      pendingSummaryRef.current = []
      setSummaryStream((prev) => `${prev}${chunk}`)
    }

    if (pendingNotesRef.current.length > 0) {
      const chunk = pendingNotesRef.current.join('')
      pendingNotesRef.current = []
      setNotesStream((prev) => `${prev}${chunk}`)
    }

    if (pendingMindmapRef.current.length > 0) {
      const chunk = pendingMindmapRef.current.join('')
      pendingMindmapRef.current = []
      setMindmapStream((prev) => `${prev}${chunk}`)
    }
  }, [])

  const scheduleBufferedFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = window.setTimeout(() => {
      flushBufferedStream()
    }, flushIntervalMs)
  }, [flushBufferedStream, flushIntervalMs])

  const appendLog = useCallback(
    (stage: StageKey, message: string) => {
      pendingLogsRef.current[stage].push(message)
      scheduleBufferedFlush()
    },
    [scheduleBufferedFlush],
  )

  const appendTranscript = useCallback(
    (text: string) => {
      if (!text.trim()) return
      pendingTranscriptRef.current.push(text)
      scheduleBufferedFlush()
    },
    [scheduleBufferedFlush],
  )

  const appendSummary = useCallback(
    (text: string, streamMode: StreamMode = 'realtime') => {
      void streamMode
      if (!text) return
      pendingSummaryRef.current.push(text)
      scheduleBufferedFlush()
    },
    [scheduleBufferedFlush],
  )

  const appendMindmap = useCallback(
    (text: string, streamMode: StreamMode = 'realtime') => {
      void streamMode
      if (!text) return
      pendingMindmapRef.current.push(text)
      scheduleBufferedFlush()
    },
    [scheduleBufferedFlush],
  )

  const appendNotes = useCallback(
    (text: string, streamMode: StreamMode = 'realtime') => {
      void streamMode
      if (!text) return
      pendingNotesRef.current.push(text)
      scheduleBufferedFlush()
    },
    [scheduleBufferedFlush],
  )

  const resetRuntimePanels = useCallback(() => {
    flushBufferedStream()
    pendingLogsRef.current = createEmptyStageLogs()
    pendingTranscriptRef.current = []
    pendingSummaryRef.current = []
    pendingNotesRef.current = []
    pendingMindmapRef.current = []
    setActiveStage('A')
    setOverallProgress(0)
    setStageLogs(createEmptyStageLogs())
    setStageTimers(createEmptyStageTimers())
    setRuntimeNowMs(Date.now())
    setTranscriptStream('')
    setSummaryStream('')
    setNotesStream('')
    setMindmapStream('')
    onReset?.()
  }, [flushBufferedStream, onReset])

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isTaskRunning) return
    const timer = window.setInterval(() => {
      setRuntimeNowMs(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isTaskRunning])

  return {
    activeStage,
    setActiveStage,
    overallProgress,
    setOverallProgress,
    stageLogs,
    setStageLogs,
    stageTimers,
    setStageTimers,
    runtimeNowMs,
    setRuntimeNowMs,
    transcriptStream,
    setTranscriptStream,
    summaryStream,
    setSummaryStream,
    notesStream,
    setNotesStream,
    mindmapStream,
    setMindmapStream,
    appendLog,
    appendTranscript,
    appendSummary,
    appendNotes,
    appendMindmap,
    flushBufferedStream,
    resetRuntimePanels,
  }
}
