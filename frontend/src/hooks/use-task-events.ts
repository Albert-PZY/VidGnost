import { useCallback, useEffect, useRef } from 'react'

import { taskEventsUrl } from '../lib/api'
import type { TaskEvent } from '../types'

interface UseTaskEventsOptions {
  activeTaskId: string | null
  onEvent: (event: TaskEvent) => void
}

export function useTaskEvents({ activeTaskId, onEvent }: UseTaskEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const closeTaskEvents = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      closeTaskEvents()
    }
  }, [closeTaskEvents])

  useEffect(() => {
    if (!activeTaskId) {
      closeTaskEvents()
      return
    }
    closeTaskEvents()
    const source = new EventSource(taskEventsUrl(activeTaskId))
    eventSourceRef.current = source

    source.onmessage = (message) => {
      if (!message.data) return
      try {
        const event: TaskEvent = JSON.parse(message.data) as TaskEvent
        onEventRef.current(event)
      } catch {
        // ignore malformed event payloads
      }
    }
    source.onerror = () => {
      // SSE may reconnect automatically; keep quiet to avoid noisy UI.
    }

    return () => {
      source.close()
      if (eventSourceRef.current === source) {
        eventSourceRef.current = null
      }
    }
  }, [activeTaskId, closeTaskEvents])

  return {
    closeTaskEvents,
  }
}
