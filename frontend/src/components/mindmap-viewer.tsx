import { useEffect, useMemo, useRef, useState } from 'react'

import 'jsmind/style/jsmind.css'

import { buildJsMindMindmap } from '../lib/mindmap'

interface MindmapViewerProps {
  markdown: string
  emptyText?: string
}

type ViewerTheme = 'light' | 'dark'

interface JsMindInstance {
  expand_all: () => void
  resize: () => void
  show: (mind: object | null, skipCentering?: boolean) => void
}

export function MindmapViewer({ markdown, emptyText }: MindmapViewerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<JsMindInstance | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [theme, setTheme] = useState<ViewerTheme>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light',
  )
  const mindmapData = useMemo(() => buildJsMindMindmap(markdown, '思维导图'), [markdown])

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
    const container = panelRef.current
    if (!container) return
    if (!mindmapData) {
      container.innerHTML = ''
      instanceRef.current = null
      setRenderError(null)
      return
    }

    let cancelled = false

    const render = async () => {
      try {
        const { default: JsMind } = await import('jsmind')
        if (cancelled || !panelRef.current) return

        panelRef.current.innerHTML = ''
        const instance = new JsMind({
          container: panelRef.current,
          editable: false,
          theme: theme === 'dark' ? 'asphalt' : 'clouds',
          support_html: false,
          log_level: 'error',
          default_event_handle: {
            enable_click_handle: false,
            enable_dblclick_handle: false,
          },
          shortcut: {
            enable: false,
          },
          view: {
            engine: 'svg',
            hmargin: 72,
            vmargin: 38,
            line_width: 2,
            line_color: theme === 'dark' ? '#90abc8' : '#6f8399',
            line_style: 'curved',
            draggable: true,
            hide_scrollbars_when_draggable: true,
            node_overflow: 'wrap',
            zoom: {
              min: 0.4,
              max: 2.2,
              step: 0.12,
              mask_key: 0,
            },
            expander_style: 'char',
          },
          layout: {
            hspace: 54,
            vspace: 20,
            pspace: 20,
            cousin_space: 10,
          },
        })
        instance.show(mindmapData)
        instance.expand_all()
        instance.resize()
        if (cancelled) return
        instanceRef.current = instance as JsMindInstance
        setRenderError(null)
      } catch (error) {
        if (cancelled) return
        setRenderError(error instanceof Error ? error.message : String(error))
        if (panelRef.current) {
          panelRef.current.innerHTML = ''
        }
        instanceRef.current = null
      }
    }

    void render()

    return () => {
      cancelled = true
      if (panelRef.current) {
        panelRef.current.innerHTML = ''
      }
      instanceRef.current = null
    }
  }, [mindmapData, theme])

  useEffect(() => {
    const container = panelRef.current
    if (!container || !mindmapData || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      instanceRef.current?.resize()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [mindmapData])

  if (!markdown.trim()) {
    return (
      <div className="runtime-mindmap-panel flex h-[420px] items-center justify-center rounded-xl border border-border bg-surface-muted text-sm text-text-subtle">
        {emptyText ?? '暂无思维导图内容'}
      </div>
    )
  }

  if (!mindmapData || renderError) {
    return (
      <div className="runtime-mindmap-panel h-[420px] overflow-auto rounded-xl border border-border bg-surface-muted p-3">
        <div className="mb-2 text-xs text-text-subtle">
          {renderError
            ? `jsMind 渲染失败，已降级显示原始内容：${renderError}`
            : '当前导图内容暂时无法转换为 jsMind 结构，已显示原始文本。'}
        </div>
        <pre className="whitespace-pre-wrap text-xs leading-6 text-text-main">{markdown}</pre>
      </div>
    )
  }

  return (
    <div className="runtime-mindmap-panel h-[420px] overflow-hidden rounded-xl border border-border bg-surface-muted p-2">
      <div
        ref={panelRef}
        className="jsmind-host h-full min-h-[380px] w-full overflow-hidden rounded-[0.9rem] border border-border/60 bg-bg-base/80"
      />
    </div>
  )
}
