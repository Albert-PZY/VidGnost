import { useEffect, useRef, useState } from 'react'

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
    ) => { setData?: (root: unknown, options?: MarkmapRenderOptions) => void; fit?: () => void; destroy: () => void }
  }
}

let markmapModulesPromise: Promise<LoadedMarkmapModules> | null = null

async function loadMarkmapModules(): Promise<LoadedMarkmapModules> {
  if (!markmapModulesPromise) {
    markmapModulesPromise = Promise.all([import('markmap-lib/no-plugins'), import('markmap-view')]).then(([lib, view]) => ({
      Transformer: lib.Transformer as LoadedMarkmapModules['Transformer'],
      Markmap: view.Markmap as LoadedMarkmapModules['Markmap'],
    }))
  }
  return markmapModulesPromise
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
  const transformerRef = useRef<null | { transform: (content: string) => { root: unknown } }>(null)
  const markmapRef = useRef<null | { setData?: (root: unknown, options?: MarkmapRenderOptions) => void; fit?: () => void; destroy: () => void }>(null)
  const renderMarkdown = useDebouncedValue(markdown, 180)
  const [theme, setTheme] = useState<ViewerTheme>(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  )

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
  }, [renderMarkdown, theme])

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

  return (
    <div className="runtime-mindmap-panel h-[420px] rounded-xl border border-border bg-surface-muted p-2">
      <svg ref={ref} className="h-full w-full" />
    </div>
  )
}
