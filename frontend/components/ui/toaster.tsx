"use client"

import * as React from "react"
import { ToastBar, Toaster as HotToaster, toast, useToasterStore } from "react-hot-toast"

const MAX_VISIBLE_TOASTS = 3
const TOAST_SOUND_SRC = "/toast.mp3"

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
  const toastSoundRef = React.useRef<HTMLAudioElement | null>(null)
  const playedToastIdsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    const audio = new Audio(TOAST_SOUND_SRC)
    audio.preload = "auto"
    toastSoundRef.current = audio

    return () => {
      toastSoundRef.current = null
    }
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
      const audio = toastSoundRef.current?.cloneNode() as HTMLAudioElement | undefined
      if (!audio) {
        return
      }
      audio.currentTime = 0
      void audio.play().catch(() => {})
    })
  }, [toasts])

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
