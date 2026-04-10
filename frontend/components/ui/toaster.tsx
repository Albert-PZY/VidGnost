"use client"

import { useTheme } from "next-themes"
import { Toaster as HotToaster } from "react-hot-toast"

export function Toaster() {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  return (
    <HotToaster
      position="top-center"
      gutter={10}
      containerStyle={{
        top: 18,
        left: 0,
        right: 0,
      }}
      toastOptions={{
        duration: 1800,
        style: {
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          padding: "12px 14px",
          boxShadow: isDark
            ? "0 18px 48px rgba(0, 0, 0, 0.38)"
            : "0 18px 48px rgba(15, 23, 42, 0.14)",
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
    />
  )
}
