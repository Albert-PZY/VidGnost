"use client"

import * as React from "react"
import MarkdownPreview from "@uiw/react-markdown-preview"
import "@uiw/react-markdown-preview/markdown.css"

import { createMarkdownPreviewComponents } from "@/components/ui/mermaid-code-block"
import { useDecoratedMarkdown } from "@/hooks/use-decorated-markdown"

interface MarkdownArtifactViewerProps {
  taskId: string
  markdown: string
  emptyMessage?: string
  className?: string
  onSeek?: (seconds: number) => void
  deferRendering?: boolean
}

export function MarkdownArtifactViewer({
  taskId,
  markdown,
  emptyMessage = "当前没有可展示的 Markdown 内容",
  className,
  onSeek,
  deferRendering = true,
}: MarkdownArtifactViewerProps) {
  const colorMode =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
      ? "dark"
      : "light"
  const renderedMarkdown = useDecoratedMarkdown({
    markdown,
    taskId,
    defer: deferRendering,
    delayMs: deferRendering ? 120 : 0,
  })
  const previewComponents = React.useMemo(
    () => createMarkdownPreviewComponents(colorMode),
    [colorMode],
  )

  if (!markdown?.trim()) {
    return <div className={className}>{emptyMessage}</div>
  }

  return (
    <div
      className={className}
      onClick={(event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest("a") : null
        const href = target?.getAttribute("href") || ""
        if (!href.startsWith("vidgnost://seek/")) {
          return
        }
        event.preventDefault()
        onSeek?.(Number(href.split("/").pop() || 0))
      }}
    >
      <MarkdownPreview
        source={renderedMarkdown}
        className="artifact-markdown-viewer wmde-markdown-var"
        components={previewComponents}
      />
    </div>
  )
}
