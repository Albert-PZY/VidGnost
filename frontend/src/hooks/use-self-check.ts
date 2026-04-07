import { useCallback, useEffect, useState } from 'react'

import { getSelfCheckReport, startSelfCheck, startSelfCheckAutoFix } from '../lib/api'
import type { SelfCheckEvent, SelfCheckReport, SelfCheckStep } from '../types'
import { useSelfCheckEvents } from './use-self-check-events'

function createEmptySelfCheckReport(sessionId = ''): SelfCheckReport {
  return {
    session_id: sessionId,
    status: 'idle',
    progress: 0,
    steps: [],
    issues: [],
    auto_fix_available: false,
    updated_at: '',
    last_error: '',
  }
}

interface UseSelfCheckOptions {
  panelOpen: boolean
  autoFixStartedText: string
  autoFixCompletedText: string
}

export function useSelfCheck({
  panelOpen,
  autoFixStartedText,
  autoFixCompletedText,
}: UseSelfCheckOptions) {
  const [selfCheckSessionId, setSelfCheckSessionId] = useState<string | null>(null)
  const [selfCheckReport, setSelfCheckReport] = useState<SelfCheckReport>(
    createEmptySelfCheckReport(),
  )
  const [selfCheckLogs, setSelfCheckLogs] = useState<string[]>([])
  const [selfCheckBusy, setSelfCheckBusy] = useState(false)
  const [selfFixBusy, setSelfFixBusy] = useState(false)
  const [selfCheckError, setSelfCheckError] = useState<string | null>(null)

  const upsertSelfCheckStep = useCallback((incoming: SelfCheckStep) => {
    setSelfCheckReport((prev) => {
      const nextSteps = [...prev.steps]
      const index = nextSteps.findIndex((step) => step.id === incoming.id)
      if (index >= 0) {
        nextSteps[index] = incoming
      } else {
        nextSteps.push(incoming)
      }
      return {
        ...prev,
        steps: nextSteps,
      }
    })
  }, [])

  const appendSelfCheckLog = useCallback((line: string) => {
    if (!line.trim()) return
    setSelfCheckLogs((prev) => [...prev, line])
  }, [])

  const refreshSelfCheckReport = useCallback(async (sessionId: string) => {
    try {
      const report = await getSelfCheckReport(sessionId)
      setSelfCheckReport(report)
      if (report.status !== 'running') {
        setSelfCheckBusy(false)
      }
      if (report.status !== 'fixing') {
        setSelfFixBusy(false)
      }
    } catch (err) {
      setSelfCheckError(err instanceof Error ? err.message : 'Failed to load self-check report')
    }
  }, [])

  const handleSelfCheckEvent = useCallback(
    (event: SelfCheckEvent) => {
      const eventSessionId = event.session_id ?? selfCheckSessionId ?? ''
      if (event.type === 'self_check_started') {
        setSelfCheckBusy(true)
        setSelfFixBusy(false)
        setSelfCheckError(null)
        setSelfCheckReport((prev) => ({
          ...prev,
          session_id: eventSessionId,
          status: 'running',
          progress: event.progress ?? 0,
          issues: [],
          auto_fix_available: false,
          last_error: '',
        }))
        return
      }
      if (event.type === 'self_check_step_start' && event.step) {
        upsertSelfCheckStep(event.step)
        if (typeof event.progress === 'number') {
          setSelfCheckReport((prev) => ({ ...prev, progress: event.progress ?? prev.progress }))
        }
        return
      }
      if (event.type === 'self_check_step_result' && event.step) {
        upsertSelfCheckStep(event.step)
        if (typeof event.progress === 'number') {
          setSelfCheckReport((prev) => ({ ...prev, progress: event.progress ?? prev.progress }))
        }
        return
      }
      if (event.type === 'self_check_complete') {
        setSelfCheckBusy(false)
        setSelfCheckReport((prev) => ({
          ...prev,
          session_id: eventSessionId || prev.session_id,
          status: 'completed',
          progress: event.progress ?? 100,
          issues: event.issues ?? prev.issues,
          auto_fix_available: event.auto_fix_available ?? prev.auto_fix_available,
        }))
        if (eventSessionId) {
          void refreshSelfCheckReport(eventSessionId)
        }
        return
      }
      if (event.type === 'self_check_failed') {
        setSelfCheckBusy(false)
        setSelfFixBusy(false)
        const errorMessage = event.error ?? 'Self-check failed.'
        setSelfCheckError(errorMessage)
        setSelfCheckReport((prev) => ({
          ...prev,
          status: 'failed',
          last_error: errorMessage,
        }))
        return
      }
      if (event.type === 'self_fix_started') {
        setSelfFixBusy(true)
        setSelfCheckError(null)
        appendSelfCheckLog(autoFixStartedText)
        setSelfCheckReport((prev) => ({
          ...prev,
          status: 'fixing',
        }))
        return
      }
      if (event.type === 'self_fix_log') {
        appendSelfCheckLog(event.message ?? '')
        return
      }
      if (event.type === 'self_fix_complete') {
        setSelfFixBusy(false)
        appendSelfCheckLog(autoFixCompletedText)
        setSelfCheckReport((prev) => ({
          ...prev,
          status: 'completed',
          issues: event.issues ?? prev.issues,
          auto_fix_available: event.auto_fix_available ?? prev.auto_fix_available,
        }))
        if (eventSessionId) {
          void refreshSelfCheckReport(eventSessionId)
        }
        return
      }
      if (event.type === 'self_fix_failed') {
        setSelfFixBusy(false)
        const errorMessage = event.error ?? 'Auto-fix failed.'
        appendSelfCheckLog(errorMessage)
        setSelfCheckError(errorMessage)
        setSelfCheckReport((prev) => ({
          ...prev,
          status: 'failed',
          last_error: errorMessage,
        }))
      }
    },
    [
      appendSelfCheckLog,
      autoFixCompletedText,
      autoFixStartedText,
      refreshSelfCheckReport,
      selfCheckSessionId,
      upsertSelfCheckStep,
    ],
  )

  const { connectSelfCheckEvents, closeSelfCheckEvents } = useSelfCheckEvents({
    onEvent: handleSelfCheckEvent,
  })

  useEffect(() => {
    if (panelOpen) return
    closeSelfCheckEvents()
  }, [closeSelfCheckEvents, panelOpen])

  const attachSelfCheckSession = useCallback(
    async (sessionId: string): Promise<void> => {
      connectSelfCheckEvents(sessionId)
      await refreshSelfCheckReport(sessionId)
    },
    [connectSelfCheckEvents, refreshSelfCheckReport],
  )

  const runSelfCheck = useCallback(async () => {
    setSelfCheckError(null)
    setSelfCheckLogs([])
    setSelfCheckBusy(true)
    setSelfFixBusy(false)
    try {
      const created = await startSelfCheck()
      setSelfCheckSessionId(created.session_id)
      setSelfCheckReport(createEmptySelfCheckReport(created.session_id))
      await attachSelfCheckSession(created.session_id)
    } catch (err) {
      setSelfCheckBusy(false)
      setSelfCheckError(err instanceof Error ? err.message : 'Failed to start self-check')
    }
  }, [attachSelfCheckSession])

  const runSelfCheckAutoFix = useCallback(async () => {
    if (!selfCheckSessionId) return
    setSelfFixBusy(true)
    setSelfCheckError(null)
    connectSelfCheckEvents(selfCheckSessionId)
    try {
      await startSelfCheckAutoFix(selfCheckSessionId)
    } catch (err) {
      setSelfFixBusy(false)
      setSelfCheckError(err instanceof Error ? err.message : 'Failed to start auto-fix')
    }
  }, [connectSelfCheckEvents, selfCheckSessionId])

  return {
    selfCheckSessionId,
    selfCheckReport,
    selfCheckLogs,
    selfCheckBusy,
    selfFixBusy,
    selfCheckError,
    setSelfCheckError,
    runSelfCheck,
    runSelfCheckAutoFix,
    attachSelfCheckSession,
  }
}
