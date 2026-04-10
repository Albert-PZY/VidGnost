"use client"

import * as React from "react"
import { ToastBar, Toaster as HotToaster, toast, useToasterStore } from "react-hot-toast"

const MAX_VISIBLE_TOASTS = 3

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

  React.useEffect(() => {
    const visibleToasts = toasts
      .filter((item) => item.visible)
      .sort((first, second) => second.createdAt - first.createdAt)

    visibleToasts.slice(MAX_VISIBLE_TOASTS).forEach((overflowToast) => {
      toast.remove(overflowToast.id)
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
