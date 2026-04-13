"use client"

import * as React from "react"

import { decorateMarkdownContent } from "@/lib/markdown-decoration"

interface UseDecoratedMarkdownOptions {
  markdown: string
  taskId?: string
  enabled?: boolean
  defer?: boolean
  delayMs?: number
}

interface MarkdownDecorateWorkerResponse {
  requestId: string
  rendered: string
}

interface PendingMarkdownRequest {
  resolve: (rendered: string) => void
  reject: (error: Error) => void
}

const MAX_MARKDOWN_CACHE_ITEMS = 80
const markdownDecorationCache = new Map<string, string>()
const pendingMarkdownRequests = new Map<string, PendingMarkdownRequest>()
let markdownWorker: Worker | null = null

function buildMarkdownCacheKey(markdown: string, taskId?: string): string {
  return `${taskId || ""}::${markdown}`
}

function ensureMarkdownWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null
  }
  if (markdownWorker) {
    return markdownWorker
  }

  markdownWorker = new Worker(
    new URL("../workers/markdown-decorate.worker.ts", import.meta.url),
    { type: "module" },
  )

  markdownWorker.onmessage = (event: MessageEvent<MarkdownDecorateWorkerResponse>) => {
    const { requestId, rendered } = event.data
    const pendingRequest = pendingMarkdownRequests.get(requestId)
    if (!pendingRequest) {
      return
    }
    pendingMarkdownRequests.delete(requestId)
    pendingRequest.resolve(rendered)
  }

  const resetWorker = (error: Error) => {
    const entries = Array.from(pendingMarkdownRequests.values())
    pendingMarkdownRequests.clear()
    for (const request of entries) {
      request.reject(error)
    }
    markdownWorker?.terminate()
    markdownWorker = null
  }

  markdownWorker.onerror = () => {
    resetWorker(new Error("Markdown Worker 渲染失败"))
  }

  markdownWorker.onmessageerror = () => {
    resetWorker(new Error("Markdown Worker 返回了无法解析的数据"))
  }

  return markdownWorker
}

function setMarkdownDecorationCacheEntry(key: string, value: string): void {
  if (markdownDecorationCache.has(key)) {
    markdownDecorationCache.delete(key)
  }
  markdownDecorationCache.set(key, value)
  if (markdownDecorationCache.size <= MAX_MARKDOWN_CACHE_ITEMS) {
    return
  }
  const oldestKey = markdownDecorationCache.keys().next().value
  if (oldestKey) {
    markdownDecorationCache.delete(oldestKey)
  }
}

function decorateMarkdownViaWorker(markdown: string, taskId?: string): Promise<string> {
  const worker = ensureMarkdownWorker()
  if (!worker) {
    return Promise.resolve(decorateMarkdownContent(markdown, taskId))
  }

  const requestId =
    globalThis.crypto?.randomUUID?.() || `md-${Date.now()}-${Math.random().toString(16).slice(2)}`

  return new Promise<string>((resolve) => {
    pendingMarkdownRequests.set(requestId, {
      resolve,
      reject: () => resolve(decorateMarkdownContent(markdown, taskId)),
    })
    worker.postMessage({
      requestId,
      markdown,
      taskId,
    })
  })
}

export function useDecoratedMarkdown({
  markdown,
  taskId,
  enabled = true,
  defer = true,
  delayMs = 120,
}: UseDecoratedMarkdownOptions): string {
  const deferredMarkdown = React.useDeferredValue(markdown)
  const effectiveMarkdown = defer ? deferredMarkdown : markdown
  const [renderedMarkdown, setRenderedMarkdown] = React.useState(() =>
    enabled ? decorateMarkdownContent(effectiveMarkdown || "", taskId) : effectiveMarkdown || "",
  )

  React.useEffect(() => {
    if (!enabled) {
      setRenderedMarkdown(effectiveMarkdown || "")
      return
    }

    const nextMarkdown = effectiveMarkdown || ""
    const cacheKey = buildMarkdownCacheKey(nextMarkdown, taskId)
    const cached = markdownDecorationCache.get(cacheKey)
    if (cached !== undefined) {
      setRenderedMarkdown(cached)
      return
    }

    let cancelled = false
    let timerId: number | null = null

    const run = async () => {
      try {
        const next = await decorateMarkdownViaWorker(nextMarkdown, taskId)
        if (cancelled) {
          return
        }
        setMarkdownDecorationCacheEntry(cacheKey, next)
        React.startTransition(() => {
          setRenderedMarkdown(next)
        })
      } catch {
        if (cancelled) {
          return
        }
        const fallback = decorateMarkdownContent(nextMarkdown, taskId)
        setMarkdownDecorationCacheEntry(cacheKey, fallback)
        setRenderedMarkdown(fallback)
      }
    }

    if (defer && delayMs > 0) {
      timerId = window.setTimeout(() => {
        timerId = null
        void run()
      }, delayMs)
    } else {
      void run()
    }

    return () => {
      cancelled = true
      if (timerId !== null) {
        window.clearTimeout(timerId)
      }
    }
  }, [delayMs, defer, effectiveMarkdown, enabled, taskId])

  return renderedMarkdown
}
