"use client"

import * as React from "react"
import MDEditor from "@uiw/react-md-editor"
import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

import { renderMarkdownCodeBlock, renderMarkdownPreBlock } from "@/components/ui/mermaid-code-block"

interface PromptMarkdownEditorProps {
  value: string
  colorMode: "light" | "dark"
  height?: number
  placeholder?: string
  onChange: (value: string) => void
}

export function PromptMarkdownEditor({
  value,
  colorMode,
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
    }),
    [colorMode],
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
