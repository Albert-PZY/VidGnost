"use client"

import * as React from "react"
import mermaid from "mermaid"

type MermaidColorMode = "light" | "dark"
const MERMAID_BLOCK_MARKER = "data-mermaid-block"

function extractTextContent(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") {
    return ""
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractTextContent(item)).join("")
  }
  if (React.isValidElement(node)) {
    return extractTextContent((node as React.ReactElement<{ children?: React.ReactNode }>).props.children)
  }
  return ""
}

function normalizeMermaidSource(children: React.ReactNode): string {
  return extractTextContent(children).replace(/\n$/, "").trim()
}

function isMermaidLanguage(className?: string): boolean {
  return /language-mermaid/i.test(className || "")
}

async function renderMermaidSvg(
  id: string,
  source: string,
  colorMode: MermaidColorMode,
): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: colorMode === "dark" ? "dark" : "neutral",
    fontFamily: "Geist, sans-serif",
  })
  const { svg } = await mermaid.render(id, source)
  return svg
}

export function MermaidCodeBlock({
  code,
  colorMode,
  ...markerProps
}: {
  code: string
  colorMode: MermaidColorMode
  [MERMAID_BLOCK_MARKER]?: boolean
}) {
  const renderId = React.useId().replace(/:/g, "")
  const [svg, setSvg] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState("")

  React.useEffect(() => {
    let cancelled = false
    const source = code.trim()
    if (!source) {
      setSvg("")
      setErrorMessage("")
      return () => {
        cancelled = true
      }
    }

    void renderMermaidSvg(`vidgnost-mermaid-${renderId}`, source, colorMode)
      .then((nextSvg) => {
        if (cancelled) {
          return
        }
        setSvg(nextSvg)
        setErrorMessage("")
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setSvg("")
        setErrorMessage(error instanceof Error ? error.message : "Mermaid 渲染失败")
      })

    return () => {
      cancelled = true
    }
  }, [code, colorMode, renderId])

  if (errorMessage) {
    return (
      <div className="mermaid-preview-shell mermaid-preview-shell-error">
        <div className="mermaid-preview-label">Mermaid 预览失败</div>
        <pre className="mermaid-preview-fallback">{code}</pre>
        <p className="mermaid-preview-error-text">{errorMessage}</p>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="mermaid-preview-shell mermaid-preview-shell-loading">
        <div className="mermaid-preview-label">正在渲染 Mermaid...</div>
      </div>
    )
  }

  return (
    <div className="mermaid-preview-shell">
      <div
        {...markerProps}
        className="mermaid-preview-surface"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

export function renderMarkdownCodeBlock({
  className,
  children,
  colorMode,
}: {
  className?: string
  children?: React.ReactNode
  colorMode: MermaidColorMode
}) {
  if (!isMermaidLanguage(className)) {
    return <code className={className}>{children}</code>
  }
  return (
    <MermaidCodeBlock
      code={normalizeMermaidSource(children)}
      colorMode={colorMode}
      data-mermaid-block
    />
  )
}

export function renderMarkdownPreBlock(props: React.HTMLAttributes<HTMLPreElement>) {
  const child = React.Children.toArray(props.children)[0]
  if (
    React.isValidElement(child)
    && typeof child.props === "object"
    && child.props !== null
    && (
      Boolean((child.props as Record<string, unknown>)[MERMAID_BLOCK_MARKER])
      || isMermaidLanguage((child.props as { className?: string }).className)
    )
  ) {
    return <>{props.children}</>
  }
  return <pre {...props} />
}
