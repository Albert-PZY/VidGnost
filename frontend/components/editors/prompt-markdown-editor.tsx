"use client"

import * as React from "react"
import MDEditor from "@uiw/react-md-editor"
import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

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
        textareaProps={{
          placeholder,
          "aria-label": "提示词内容 Markdown 编辑器",
          spellCheck: false,
        }}
      />
    </div>
  )
}
