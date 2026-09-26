import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Mermaid 的配色解析器不支持 `oklch()`，因此这里使用与设计令牌等价的十六进制值。
 * 对应关系见 `apps/desktop/src/app/globals.css` 中的表面 / 文本 / 描边 / 强调色。
 */
const MERMAID_THEME = {
  background: 'transparent',
  primaryColor: '#2b2b38',
  primaryTextColor: '#eeeef1',
  primaryBorderColor: '#43434f',
  secondaryColor: '#4a3c1e',
  secondaryTextColor: '#e8bb5c',
  secondaryBorderColor: '#6b5628',
  tertiaryColor: '#1f1f28',
  tertiaryTextColor: '#9a9aa5',
  lineColor: '#5a5a6a',
  textColor: '#dcdce3',
  fontSize: '13px',
} as const

type ZoomMode = 'fit' | 'actual'

let mermaidLoader: Promise<typeof import('mermaid').default> | null = null

async function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((module) => {
      module.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif',
        themeVariables: { ...MERMAID_THEME },
        // 导图节点较多，按自然尺寸渲染再由容器控制缩放，避免默认缩放到不可读。
        mindmap: { useMaxWidth: false, padding: 8 },
        flowchart: { useMaxWidth: false },
      })
      return module.default
    })
  }
  return mermaidLoader
}

/**
 * Mermaid 渲染块。
 * - 渲染成功后可按「适应宽度 / 原始大小」切换；
 * - 渲染失败时降级为源码，并把失败原因展示出来，内容不会消失。
 */
export function MermaidBlock({ className, source }: { className?: string; source: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [zoom, setZoom] = useState<ZoomMode>('actual')
  const [naturalWidth, setNaturalWidth] = useState(0)
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      try {
        const mermaid = await loadMermaid()
        const { svg } = await mermaid.render(idRef.current, source)
        if (cancelled || !containerRef.current) {
          return
        }
        containerRef.current.innerHTML = svg
        const element = containerRef.current.querySelector('svg')
        if (element) {
          const width = Number(element.getAttribute('width') || 0)
          setNaturalWidth(width)
          element.removeAttribute('height')
          element.style.maxWidth = 'none'
          element.style.height = 'auto'
        }
        setFailure(null)
      } catch (error) {
        if (!cancelled) {
          setFailure(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [source])

  useEffect(() => {
    const container = containerRef.current
    const element = container?.querySelector('svg')
    if (!container || !element || naturalWidth <= 0) {
      return
    }
    element.style.width = zoom === 'actual' ? `${naturalWidth}px` : '100%'
    // 导图以根节点为中心向外展开，渲染后把视口对准根节点，避免初始看到空白区域。
    requestAnimationFrame(() => {
      const anchor =
        (element.querySelector('.section-root') as SVGGraphicsElement | null) ||
        (element.querySelector('.mindmap-node') as SVGGraphicsElement | null)
      if (!anchor) {
        container.scrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth) / 2)
        return
      }
      const anchorRect = anchor.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      container.scrollLeft += anchorRect.left - containerRect.left - (container.clientWidth - anchorRect.width) / 2
      container.scrollTop += anchorRect.top - containerRect.top - (container.clientHeight - anchorRect.height) / 2
    })
  }, [naturalWidth, zoom])

  if (failure) {
    return (
      <div className={cn('space-y-2', className)}>
        <p className="text-[11px] text-warning">导图图形渲染失败，以下为源码：{failure.slice(0, 160)}</p>
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-card/60 p-3 text-[11px] text-text-muted">
          {source}
        </pre>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-end gap-1">
        {(['fit', 'actual'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setZoom(mode)}
            className={cn(
              'rounded px-2 py-0.5 text-[10px] transition-colors',
              zoom === mode ? 'bg-secondary text-foreground' : 'text-text-subtle hover:text-foreground',
            )}
          >
            {mode === 'fit' ? '适应宽度' : '100%'}
          </button>
        ))}
      </div>
      <div
        ref={containerRef}
        className="mermaid-host max-h-[520px] overflow-auto [&_svg]:mx-auto"
        aria-hidden="true"
      />
    </div>
  )
}
