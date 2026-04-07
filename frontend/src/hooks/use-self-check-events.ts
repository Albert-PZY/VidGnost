import { useCallback, useEffect, useRef } from 'react'

import { selfCheckEventsUrl } from '../lib/api'
import type { SelfCheckEvent } from '../types'

interface UseSelfCheckEventsOptions {
  onEvent: (event: SelfCheckEvent) => void
}

export function useSelfCheckEvents({ onEvent }: UseSelfCheckEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const closeSelfCheckEvents = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      closeSelfCheckEvents()
    }
  }, [closeSelfCheckEvents])

  const connectSelfCheckEvents = useCallback(
    (sessionId: string) => {
      closeSelfCheckEvents()
      const source = new EventSource(selfCheckEventsUrl(sessionId))
      eventSourceRef.current = source
      source.onmessage = (message) => {
        if (!message.data) return
        try {
          const payload: SelfCheckEvent = JSON.parse(message.data) as SelfCheckEvent
          onEventRef.current(payload)
        } catch {
          // ignore malformed event payloads
        }
      }
      source.onerror = () => {
        // keep quiet, EventSource reconnect is handled by browser
      }
      return source
    },
    [closeSelfCheckEvents],
  )

  return {
    connectSelfCheckEvents,
    closeSelfCheckEvents,
  }
}
