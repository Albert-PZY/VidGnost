"use client"

const PERF_LOG_KEY = "vidgnost:perf-log-enabled"
const MAX_PERF_SAMPLES = 80
const perfSamples: PerfSample[] = []
const perfSampleListeners = new Set<(samples: PerfSample[]) => void>()

export interface PerfSample {
  id: string
  label: string
  durationMs: number
  recordedAt: string
}

function canUseBrowserApis(): boolean {
  return typeof window !== "undefined" && typeof performance !== "undefined"
}

function publishPerfSamples() {
  const snapshot = [...perfSamples]
  perfSampleListeners.forEach((listener) => {
    listener(snapshot)
  })
}

function recordPerfSample(label: string, durationMs: number) {
  perfSamples.unshift({
    id: `${label}-${Date.now()}`,
    label,
    durationMs,
    recordedAt: new Date().toISOString(),
  })

  if (perfSamples.length > MAX_PERF_SAMPLES) {
    perfSamples.length = MAX_PERF_SAMPLES
  }

  publishPerfSamples()
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

export function getPerfSamples(): PerfSample[] {
  return [...perfSamples]
}

export function subscribePerfSamples(listener: (samples: PerfSample[]) => void): () => void {
  perfSampleListeners.add(listener)
  listener([...perfSamples])
  return () => {
    perfSampleListeners.delete(listener)
  }
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
    recordPerfSample(label, duration)
    console.info(`[vidgnost:perf] ${label}: ${duration.toFixed(1)}ms`)
  }
  return duration
}
