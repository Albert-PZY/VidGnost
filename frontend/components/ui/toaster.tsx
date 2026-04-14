"use client"

import * as React from "react"
import { ToastBar, Toaster as HotToaster, toast, useToasterStore } from "react-hot-toast"

const MAX_VISIBLE_TOASTS = 3
const TOAST_SOUND_SRC = "/toast.mp3"
const TOAST_AUDIO_POOL_SIZE = 3

function getToastTone(type: string) {
  switch (type) {
    case "success":
      return "success"
    case "error":
      return "error"
    case "loading":
      return "loading"
    default:
      return "default"
  }
}

export function Toaster() {
  const { toasts } = useToasterStore()
  const toastAudioPoolRef = React.useRef<HTMLAudioElement[]>([])
  const nextAudioIndexRef = React.useRef(0)
  const playedToastIdsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    let disposed = false
    let objectUrl = ""

    const resetAudioPool = () => {
      toastAudioPoolRef.current.forEach((audio) => {
        audio.pause()
        audio.removeAttribute("src")
        audio.load()
      })
      toastAudioPoolRef.current = []
    }

    const buildAudioPool = (source: string) => {
      toastAudioPoolRef.current = Array.from({ length: TOAST_AUDIO_POOL_SIZE }, () => {
        const audio = new Audio(source)
        audio.preload = "auto"
        return audio
      })
    }

    const prepareAudioPool = async () => {
      try {
        const response = await fetch(TOAST_SOUND_SRC, { cache: "no-store" })
        if (!response.ok) {
          throw new Error(`Failed to load toast sound: ${response.status}`)
        }
        const blob = await response.blob()
        if (disposed) {
          return
        }
        objectUrl = URL.createObjectURL(blob)
        buildAudioPool(objectUrl)
      } catch {
        if (disposed) {
          return
        }
        buildAudioPool(TOAST_SOUND_SRC)
      }
    }

    void prepareAudioPool()

    return () => {
      disposed = true
      resetAudioPool()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [])

  const playToastSound = React.useCallback(() => {
    const pool = toastAudioPoolRef.current
    if (pool.length === 0) {
      return
    }

    const audio =
      pool.find((item) => item.paused || item.ended) ??
      pool[nextAudioIndexRef.current % pool.length]

    nextAudioIndexRef.current = (nextAudioIndexRef.current + 1) % pool.length
    audio.pause()
    audio.currentTime = 0
    void audio.play().catch(() => {})
  }, [])

  React.useEffect(() => {
    const visibleToasts = toasts
      .filter((item) => item.visible)
      .sort((first, second) => second.createdAt - first.createdAt)

    visibleToasts.slice(MAX_VISIBLE_TOASTS).forEach((overflowToast) => {
      toast.remove(overflowToast.id)
    })

    const activeVisibleToasts = visibleToasts.slice(0, MAX_VISIBLE_TOASTS)
    const activeToastIds = new Set(activeVisibleToasts.map((item) => item.id))

    playedToastIdsRef.current.forEach((toastId) => {
      if (!activeToastIds.has(toastId)) {
        playedToastIdsRef.current.delete(toastId)
      }
    })

    activeVisibleToasts.forEach((toastItem) => {
      if (playedToastIdsRef.current.has(toastItem.id)) {
        return
      }

      playedToastIdsRef.current.add(toastItem.id)
      playToastSound()
    })
  }, [playToastSound, toasts])

  return (
    <HotToaster
      position="top-center"
      reverseOrder
      gutter={8}
      containerStyle={{
        top: 16,
        left: 0,
        right: 0,
      }}
      toastOptions={{
        duration: 1700,
        removeDelay: 180,
        style: {
          background: "transparent",
          boxShadow: "none",
          padding: 0,
          maxWidth: "unset",
        },
        success: {
          iconTheme: {
            primary: "#0f9d58",
            secondary: "#ffffff",
          },
        },
        error: {
          iconTheme: {
            primary: "#dc2626",
            secondary: "#ffffff",
          },
        },
      }}
    >
      {(toastInstance) => {
        const tone = getToastTone(toastInstance.type)

        return (
          <ToastBar
            toast={toastInstance}
            style={{
              ...toastInstance.style,
              background: "transparent",
              boxShadow: "none",
              padding: 0,
              minWidth: "auto",
              maxWidth: "none",
            }}
          >
            {({ icon, message }) => (
              <div className="app-toast-shell" data-tone={tone}>
                <div className="app-toast-icon-shell" data-tone={tone}>
                  {icon ?? <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/55" />}
                </div>
                <div className="app-toast-copy">
                  <div className="app-toast-message">{message}</div>
                </div>
              </div>
            )}
          </ToastBar>
        )
      }}
    </HotToaster>
  )
}
