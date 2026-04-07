import { useEffect, useMemo, useRef, useState } from 'react'

interface MindmapViewerProps {
  markdown: string
  emptyText?: string
}

type ViewerTheme = 'light' | 'dark'

interface MarkmapRenderOptions {
  autoFit?: boolean
  duration?: number
  style?: (id: string) => string
}

interface LoadedMarkmapModules {
  Transformer: { new (): { transform: (content: string) => { root: unknown } } }
  Markmap: {
    create: (
      svg: SVGSVGElement,
      options: MarkmapRenderOptions,
      root: unknown,
    ) => {
      setData?: (root: unknown, options?: MarkmapRenderOptions) => void
      fit?: () => void
      destroy: () => void
    }
  }
}

interface LoadedMermaidModule {
  initialize: (config: Record<string, unknown>) => void
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string; bindFunctions?: (element: Element) => void }>
}

let markmapModulesPromise: Promise<LoadedMarkmapModules> | null = null
let mermaidModulePromise: Promise<LoadedMermaidModule> | null = null

async function loadMarkmapModules(): Promise<LoadedMarkmapModules> {
  if (!markmapModulesPromise) {
    markmapModulesPromise = Promise.all([
      import('markmap-lib/no-plugins'),
      import('markmap-view'),
    ]).then(([lib, view]) => ({
      Transformer: lib.Transformer as LoadedMarkmapModules['Transformer'],
      Markmap: view.Markmap as LoadedMarkmapModules['Markmap'],
    }))
  }
  return markmapModulesPromise
}

async function loadMermaidModule(): Promise<LoadedMermaidModule> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then(
      (mod) => mod.default as unknown as LoadedMermaidModule,
    )
  }
  return mermaidModulePromise
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

export function MindmapViewer({ markdown, emptyText }: MindmapViewerProps) {
  const ref = useRef<SVGSVGElement | null>(null)
  const mermaidRef = useRef<HTMLDivElement | null>(null)
  const mermaidRenderCountRef = useRef(0)
  const transformerRef = useRef<null | { transform: (content: string) => { root: unknown } }>(null)
  const markmapRef = useRef<null | {
    setData?: (root: unknown, options?: MarkmapRenderOptions) => void
    fit?: () => void
    destroy: () => void
  }>(null)
  const renderMarkdown = useDebouncedValue(markdown, 180)
  const [mermaidError, setMermaidError] = useState<string | null>(null)
  const [theme, setTheme] = useState<ViewerTheme>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  )
  const mermaidCode = useMemo(() => extractMermaidCode(renderMarkdown), [renderMarkdown])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const updateTheme = () => {
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    }
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (mermaidCode) {
      markmapRef.current?.destroy()
      markmapRef.current = null
      return
    }
    if (!ref.current) return
    const content = renderMarkdown.trim()
    if (!content) {
      markmapRef.current?.destroy()
      markmapRef.current = null
      return
    }

    let cancelled = false

    const render = async () => {
      const { Transformer, Markmap } = await loadMarkmapModules()
      if (cancelled || !ref.current) return
      if (!transformerRef.current) {
        transformerRef.current = new Transformer()
      }
      const { root } = transformerRef.current.transform(content)
      const renderOptions: MarkmapRenderOptions = {
        autoFit: true,
        duration: 120,
        style: (id) =>
          theme === 'dark'
            ? `
#${id}.markmap {
  --markmap-text-color: #e6efff;
  --markmap-circle-open-bg: #1a2535;
}
#${id} .markmap-link {
  stroke: #6e8eb4;
  opacity: 0.86;
}
#${id} .markmap-foreign code {
  color: #d7e6ff;
  background: #233247;
}
`
            : `
#${id}.markmap {
  --markmap-text-color: #213248;
  --markmap-circle-open-bg: #ffffff;
}
#${id} .markmap-link {
  stroke: #6c87a8;
  opacity: 0.82;
}
`,
      }
      if (markmapRef.current?.setData) {
        markmapRef.current.setData(root, renderOptions)
        markmapRef.current.fit?.()
        return
      }
      markmapRef.current = Markmap.create(ref.current, renderOptions, root)
    }

    void render()

    return () => {
      cancelled = true
    }
  }, [mermaidCode, renderMarkdown, theme])

  useEffect(() => {
    if (!mermaidCode) {
      setMermaidError(null)
      if (mermaidRef.current) {
        mermaidRef.current.innerHTML = ''
      }
      return
    }
    if (!mermaidRef.current) return
    let cancelled = false
    const currentContainer = mermaidRef.current
    currentContainer.innerHTML = ''
    setMermaidError(null)

    const render = async () => {
      const mermaid = await loadMermaidModule()
      if (cancelled) return
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: theme === 'dark' ? 'dark' : 'default',
      })
      const candidates: string[] = [mermaidCode]
      const sanitized = sanitizeMermaidCode(mermaidCode)
      if (sanitized !== mermaidCode) {
        candidates.push(sanitized)
      }
      let lastError = ''
      for (const candidate of candidates) {
        try {
          const renderId = `vidgnost-mermaid-${Date.now()}-${mermaidRenderCountRef.current++}`
          const result = await mermaid.render(renderId, candidate)
          if (cancelled) return
          currentContainer.innerHTML = result.svg
          result.bindFunctions?.(currentContainer)
          setMermaidError(null)
          return
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err)
        }
      }
      if (!cancelled) {
        setMermaidError(lastError || 'Mermaid render failed.')
      }
    }

    void render()
    return () => {
      cancelled = true
    }
  }, [mermaidCode, theme])

  useEffect(() => {
    return () => {
      markmapRef.current?.destroy()
      markmapRef.current = null
      transformerRef.current = null
    }
  }, [])

  if (!markdown.trim()) {
    return (
      <div className="runtime-mindmap-panel flex h-[420px] items-center justify-center rounded-xl border border-border bg-surface-muted text-sm text-text-subtle">
        {emptyText ?? '暂无思维导图内容'}
      </div>
    )
  }

  if (mermaidCode) {
    if (mermaidError) {
      return (
        <div className="runtime-mindmap-panel h-[420px] overflow-auto rounded-xl border border-border bg-surface-muted p-3">
          <div className="mb-2 text-xs text-red-500">
            Mermaid 渲染失败，已降级显示原始内容：{mermaidError}
          </div>
          <pre className="whitespace-pre-wrap text-xs leading-6 text-text-main">{markdown}</pre>
        </div>
      )
    }
    return (
      <div className="runtime-mindmap-panel h-[420px] overflow-auto rounded-xl border border-border bg-surface-muted p-2">
        <div ref={mermaidRef} className="h-full min-h-[380px] w-full" />
      </div>
    )
  }

  return (
    <div className="runtime-mindmap-panel h-[420px] rounded-xl border border-border bg-surface-muted p-2">
      <svg ref={ref} className="h-full w-full" />
    </div>
  )
}

function extractMermaidCode(markdown: string): string | null {
  const text = markdown.trim()
  if (!text) return null
  const fenced = text.match(/```(mermaid|mindmap)\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const lang = fenced[1]?.toLowerCase() ?? ''
    let code = (fenced[2] ?? '').trim()
    if (lang === 'mindmap' && !code.toLowerCase().startsWith('mindmap')) {
      code = `mindmap\n${code}`
    }
    return code
  }
  if (/^(mindmap|flowchart|graph)\b/i.test(text)) {
    return text
  }
  return null
}

function sanitizeMermaidCode(code: string): string {
  const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (!lines.length) return code
  const first = lines[0].trim()
  if (!first.toLowerCase().startsWith('mindmap')) {
    return code
  }
  const nextLines: string[] = ['mindmap']
  for (const rawLine of lines.slice(1)) {
    const indent = rawLine.match(/^\s*/)?.[0] ?? ''
    let content = rawLine.trim()
    if (!content) continue
    content = content.replace(/^[-*+]\s+/, '')
    content = content.replace(/^#+\s+/, '')
    content = content.replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    content = content.replace(/[`*_~]/g, '')
    content = content.replace(/\s+/g, ' ').trim()
    if (!content) continue
    nextLines.push(`${indent}${content}`)
  }
  return nextLines.join('\n')
}
