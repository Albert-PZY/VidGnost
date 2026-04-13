"use client"

import * as React from "react"
import MDEditor from "@uiw/react-md-editor"
import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

import { buildTaskArtifactFileUrl } from "@/lib/api"
import { renderMarkdownCodeBlock, renderMarkdownPreBlock } from "@/components/ui/mermaid-code-block"

interface PromptMarkdownEditorProps {
  value: string
  colorMode: "light" | "dark"
  taskId?: string
  height?: number
  placeholder?: string
  onChange: (value: string) => void
}

function resolvePreviewImageSource(src: string, taskId?: string): string {
  const normalized = src.trim()
  if (!normalized || !taskId) {
    return normalized
  }
  if (/^(?:https?:|data:|file:|blob:)/i.test(normalized)) {
    return normalized
  }
  return buildTaskArtifactFileUrl(taskId, normalized.replace(/^(?:\.\/)+/, ""))
}

export function PromptMarkdownEditor({
  value,
  colorMode,
  taskId,
  height = 520,
  placeholder,
  onChange,
}: PromptMarkdownEditorProps) {
  const previewComponents = React.useMemo(
    () => ({
      code: (props: { className?: string; children?: React.ReactNode }) =>
        renderMarkdownCodeBlock({
          className: props.className,
          children: props.children,
          colorMode,
        }),
      pre: renderMarkdownPreBlock,
      img: ({
        node: _node,
        src,
        alt,
        ...props
      }: React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) => (
        // Route task-relative Markdown images through the backend artifact endpoint
        <img
          {...props}
          src={resolvePreviewImageSource(src || "", taskId)}
          alt={alt || ""}
        />
      ),
    }),
    [colorMode, taskId],
  )

  return (
    <div data-color-mode={colorMode} className="prompt-markdown-editor-shell wmde-markdown-var">
      <MDEditor
        value={value}
        onChange={(nextValue) => {
          onChange(nextValue ?? "")
        }}
        preview="live"
        visibleDragbar={false}
        enableScroll
        height={height}
        data-color-mode={colorMode}
        extraCommands={[]}
        previewOptions={{ components: previewComponents }}
        textareaProps={{
          placeholder,
          "aria-label": "提示词内容 Markdown 编辑器",
          spellCheck: false,
        }}
      />
    </div>
  )
}
