"use client"

import * as React from "react"
import mermaid from "mermaid"

type MermaidColorMode = "light" | "dark"
const MERMAID_BLOCK_MARKER = "data-mermaid-block"
const MAX_MERMAID_CACHE_ITEMS = 48
const mermaidSvgCache = new Map<string, string>()
type MarkdownCodeRendererProps = { className?: string; children?: React.ReactNode }

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

function buildMermaidCacheKey(source: string, colorMode: MermaidColorMode): string {
  return `${colorMode}::${source}`
}

function setMermaidCacheEntry(key: string, value: string): void {
  if (mermaidSvgCache.has(key)) {
    mermaidSvgCache.delete(key)
  }
  mermaidSvgCache.set(key, value)
  if (mermaidSvgCache.size <= MAX_MERMAID_CACHE_ITEMS) {
    return
  }
  const oldestKey = mermaidSvgCache.keys().next().value
  if (oldestKey) {
    mermaidSvgCache.delete(oldestKey)
  }
}

function scheduleMermaidRender(work: () => void): () => void {
  const targetWindow = typeof window !== "undefined" ? window : null
  if (targetWindow && "requestIdleCallback" in targetWindow) {
    const callbackId = targetWindow.requestIdleCallback(work, { timeout: 220 })
    return () => {
      targetWindow.cancelIdleCallback(callbackId)
    }
  }

  const timeoutId = globalThis.setTimeout(work, 32)
  return () => {
    globalThis.clearTimeout(timeoutId)
  }
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
  const shellRef = React.useRef<HTMLDivElement | null>(null)
  const [svg, setSvg] = React.useState("")
  const [errorMessage, setErrorMessage] = React.useState("")
  const [isVisible, setIsVisible] = React.useState(false)

  React.useEffect(() => {
    const node = shellRef.current
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: "180px 0px",
      },
    )
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [])

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

    if (!isVisible) {
      return () => {
        cancelled = true
      }
    }

    const cacheKey = buildMermaidCacheKey(source, colorMode)
    const cachedSvg = mermaidSvgCache.get(cacheKey)
    if (cachedSvg) {
      setSvg(cachedSvg)
      setErrorMessage("")
      return () => {
        cancelled = true
      }
    }

    const cancelScheduledRender = scheduleMermaidRender(() => {
      void renderMermaidSvg(`vidgnost-mermaid-${renderId}`, source, colorMode)
        .then((nextSvg) => {
          if (cancelled) {
            return
          }
          setMermaidCacheEntry(cacheKey, nextSvg)
          React.startTransition(() => {
            setSvg(nextSvg)
            setErrorMessage("")
          })
        })
        .catch((error) => {
          if (cancelled) {
            return
          }
          setSvg("")
          setErrorMessage(error instanceof Error ? error.message : "Mermaid 渲染失败")
        })
    })

    return () => {
      cancelled = true
      cancelScheduledRender()
    }
  }, [code, colorMode, isVisible, renderId])

  if (errorMessage) {
    return (
      <div ref={shellRef} className="mermaid-preview-shell mermaid-preview-shell-error">
        <div className="mermaid-preview-label">Mermaid 预览失败</div>
        <pre className="mermaid-preview-fallback">{code}</pre>
        <p className="mermaid-preview-error-text">{errorMessage}</p>
      </div>
    )
  }

  if (!svg) {
    return (
      <div ref={shellRef} className="mermaid-preview-shell mermaid-preview-shell-loading">
        <div className="mermaid-preview-label">
          {isVisible ? "正在渲染 Mermaid..." : "滚动到可视区后渲染 Mermaid..."}
        </div>
      </div>
    )
  }

  return (
    <div ref={shellRef} className="mermaid-preview-shell">
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
  className?: MarkdownCodeRendererProps["className"]
  children?: MarkdownCodeRendererProps["children"]
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

export function createMarkdownPreviewComponents(colorMode: MermaidColorMode) {
  return {
    code: (props: MarkdownCodeRendererProps) =>
      renderMarkdownCodeBlock({
        className: props.className,
        children: props.children,
        colorMode,
      }),
    pre: renderMarkdownPreBlock,
  }
}
