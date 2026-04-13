"use client"

import * as React from "react"
import MDEditor from "@uiw/react-md-editor"
import MarkdownPreview from "@uiw/react-markdown-preview"
import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

import { createMarkdownPreviewComponents } from "@/components/ui/mermaid-code-block"
import { useDecoratedMarkdown } from "@/hooks/use-decorated-markdown"

interface PromptMarkdownEditorProps {
  value: string
  colorMode: "light" | "dark"
  taskId?: string
  height?: number
  placeholder?: string
  onChange: (value: string) => void
}

export function PromptMarkdownEditor({
  value,
  colorMode,
  taskId,
  height = 520,
  placeholder,
  onChange,
}: PromptMarkdownEditorProps) {
  const previewMarkdown = useDecoratedMarkdown({
    markdown: value,
    taskId,
    defer: true,
    delayMs: 120,
  })
  const previewComponents = React.useMemo(
    () => createMarkdownPreviewComponents(colorMode),
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
        components={{
          preview: () => (
            <MarkdownPreview
              source={previewMarkdown}
              className="wmde-markdown wmde-markdown-color"
              components={previewComponents}
            />
          ),
        }}
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
