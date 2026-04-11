"use client"

const PERF_LOG_KEY = "vidgnost:perf-log-enabled"

function canUseBrowserApis(): boolean {
  return typeof window !== "undefined" && typeof performance !== "undefined"
}

export function isPerfLoggingEnabled(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return window.localStorage.getItem(PERF_LOG_KEY) === "true"
}

export function setPerfLoggingEnabled(enabled: boolean): void {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(PERF_LOG_KEY, enabled ? "true" : "false")
}

export function markPerfStart(label: string): number {
  if (!canUseBrowserApis()) {
    return Date.now()
  }
  performance.mark(`${label}:start`)
  return performance.now()
}

export function logPerfSample(label: string, startMark: number): number {
  const duration = (canUseBrowserApis() ? performance.now() : Date.now()) - startMark
  if (isPerfLoggingEnabled()) {
    console.info(`[vidgnost:perf] ${label}: ${duration.toFixed(1)}ms`)
  }
  return duration
}
