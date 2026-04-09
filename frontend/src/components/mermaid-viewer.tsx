import { useEffect, useMemo, useState } from 'react'

interface MermaidViewerProps {
  code: string
}

type ViewerTheme = 'light' | 'dark'
type MermaidInstance = Awaited<typeof import('mermaid')>['default']

let mermaidInstancePromise: Promise<MermaidInstance> | null = null
let mermaidRenderCounter = 0
const mermaidSvgCache = new Map<string, string>()
const MERMAID_SVG_CACHE_LIMIT = 48

function getCachedSvg(cacheKey: string): string | undefined {
  const value = mermaidSvgCache.get(cacheKey)
  if (!value) return undefined
  // Refresh insertion order to keep this entry as recently used.
  mermaidSvgCache.delete(cacheKey)
  mermaidSvgCache.set(cacheKey, value)
  return value
}

function setCachedSvg(cacheKey: string, svg: string): void {
  if (mermaidSvgCache.has(cacheKey)) {
    mermaidSvgCache.delete(cacheKey)
  }
  mermaidSvgCache.set(cacheKey, svg)
  while (mermaidSvgCache.size > MERMAID_SVG_CACHE_LIMIT) {
    const oldestKey = mermaidSvgCache.keys().next().value
    if (!oldestKey) break
    mermaidSvgCache.delete(oldestKey)
  }
}

async function loadMermaidInstance(): Promise<MermaidInstance> {
  if (!mermaidInstancePromise) {
    mermaidInstancePromise = import('mermaid').then((module) => module.default)
  }
  return mermaidInstancePromise
}

function formatMermaidError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return 'Mermaid render failed.'
}

export function MermaidViewer({ code }: MermaidViewerProps) {
  const source = useMemo(() => code.trim(), [code])
  const [theme, setTheme] = useState<ViewerTheme>(() =>
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  )
  const cacheKey = useMemo(() => `${theme}:${source}`, [source, theme])
  const [svg, setSvg] = useState(() => (source ? getCachedSvg(cacheKey) ?? '' : ''))
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const updateTheme = () => setTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    updateTheme()
    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!source) {
      const rafId = window.requestAnimationFrame(() => {
        setSvg('')
        setErrorMessage('')
      })
      return () => window.cancelAnimationFrame(rafId)
    }

    const cachedSvg = getCachedSvg(cacheKey)
    if (cachedSvg) {
      const rafId = window.requestAnimationFrame(() => {
        setSvg(cachedSvg)
        setErrorMessage('')
      })
      return () => window.cancelAnimationFrame(rafId)
    }

    const clearRafId = window.requestAnimationFrame(() => {
      setSvg('')
      setErrorMessage('')
    })
    let cancelled = false

    const render = async () => {
      try {
        const mermaid = await loadMermaidInstance()
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          fontFamily: 'Manrope, Noto Sans SC, sans-serif',
        })
        mermaidRenderCounter += 1
        const renderId = `notes-mermaid-${Date.now()}-${mermaidRenderCounter}`
        const result = await mermaid.render(renderId, source)
        if (cancelled) return
        setCachedSvg(cacheKey, result.svg)
        setSvg(result.svg)
        setErrorMessage('')
      } catch (error) {
        if (cancelled) return
        setSvg('')
        setErrorMessage(formatMermaidError(error))
      }
    }

    void render()

    return () => {
      cancelled = true
      window.cancelAnimationFrame(clearRafId)
    }
  }, [cacheKey, source, theme])

  if (errorMessage) {
    return (
      <div className="docs-mermaid-wrap">
        <p className="docs-mermaid-error">{errorMessage}</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="docs-mermaid-wrap">
        <p className="docs-mermaid-loading">Rendering Mermaid diagram...</p>
      </div>
    )
  }

  return (
    <div className="docs-mermaid-wrap">
      <div className="docs-mermaid-shell" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}
