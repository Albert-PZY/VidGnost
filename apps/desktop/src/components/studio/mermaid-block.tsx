import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Mermaid 的配色解析器不支持 `oklch()`，因此这里使用与设计令牌逐项对齐的十六进制值。
 * 两套取值分别对应 `globals.css` 中 `:root`（浅色）与 `.dark`（深色）的表面 / 文本 / 描边 / 时间锚点色。
 *
 * `mindmap` 类型的每个分支由 `cScale*` 系列决定填充与文字色，如果不覆盖会退回主题默认的
 * 高饱和靛蓝色板，在浅色背景下会变成大块厚重色条，因此这里显式给出一组低饱和的浅色/深色 tint。
 */
const SECTION_TINTS = {
  light: [
    { fill: '#dcd8f6', label: '#2a2a3d', border: '#b3ade4' },
    { fill: '#d3e8e6', label: '#1f3835', border: '#a3ccc7' },
    { fill: '#f0e2c4', label: '#3f3115', border: '#d9c191' },
    { fill: '#e6d8ee', label: '#342440', border: '#c6aed7' },
    { fill: '#d5e3f3', label: '#1f3346', border: '#a7c2e0' },
    { fill: '#e9ded9', label: '#3a2f2a', border: '#cbb6ad' },
  ],
  dark: [
    { fill: '#2b2b3c', label: '#e6e6ef', border: '#3d3d52' },
    { fill: '#26332f', label: '#dfeae6', border: '#354842' },
    { fill: '#3a3122', label: '#ece2cd', border: '#4f432f' },
    { fill: '#332a3b', label: '#e8e0ee', border: '#463a51' },
    { fill: '#27303c', label: '#dde6f0', border: '#374354' },
    { fill: '#332d2b', label: '#ece3df', border: '#473d39' },
  ],
} as const

function sectionThemeVariables(theme: MermaidTheme): Record<string, string> {
  const tints = SECTION_TINTS[theme]
  const variables: Record<string, string> = {}
  for (let index = 0; index < 12; index += 1) {
    const tint = tints[index % tints.length]
    variables[`cScale${index}`] = tint.fill
    variables[`cScaleLabel${index}`] = tint.label
    variables[`cScaleInv${index}`] = tint.label
    variables[`cScalePeer${index}`] = tint.fill
    variables[`cScalePeerLabel${index}`] = tint.label
  }
  return variables
}

const MERMAID_THEME = {
  light: {
    background: 'transparent',
    primaryColor: '#f0f0f5',
    primaryTextColor: '#232330',
    primaryBorderColor: '#c9c9d4',
    secondaryColor: '#f4e6c8',
    secondaryTextColor: '#6b4f18',
    secondaryBorderColor: '#dfc48c',
    tertiaryColor: '#fafafc',
    tertiaryTextColor: '#5c5c6b',
    lineColor: '#a8a8bb',
    textColor: '#33333f',
  },
  dark: {
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
  },
} as const

const FONT_FAMILY = 'Inter, "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif'

type ZoomMode = 'fit' | 'actual'
export type MermaidTheme = keyof typeof MERMAID_THEME

let mermaidModule: Promise<typeof import('mermaid').default> | null = null
let initializedFor: MermaidTheme | null = null

async function loadMermaid(theme: MermaidTheme) {
  if (!mermaidModule) {
    mermaidModule = import('mermaid').then((module) => module.default)
  }
  const mermaid = await mermaidModule
  // 主题切换后必须重新 initialize，Mermaid 才会用新的 themeVariables 渲染。
  if (initializedFor !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: FONT_FAMILY,
      themeVariables: { ...MERMAID_THEME[theme], ...sectionThemeVariables(theme), fontSize: '13px' },
      // 导图节点较多，按自然尺寸渲染再由容器控制缩放，避免默认缩放到不可读。
      mindmap: { useMaxWidth: false, padding: 8 },
      flowchart: { useMaxWidth: false },
    })
    initializedFor = theme
  }
  return mermaid
}

/**
 * Mermaid v11 的 `mindmap` 会用自带色阶生成 `<style>` 片段，`themeVariables.cScale*` 在该类型下不生效，
 * 结果是浅色主题里出现大面积高饱和色块。这里在渲染后按 section 重写这段 CSS 的填充与文字色，
 * 让导图与设计令牌保持一致。只处理 section 规则，不影响节点形状、连线与其他图形类型。
 */
export function rewriteSectionColors(css: string, theme: MermaidTheme): string {
  const tints = SECTION_TINTS[theme]
  const tintFor = (sectionKey: string) => {
    if (sectionKey === 'root' || sectionKey === '--1' || sectionKey === '-1') {
      return tints[0]
    }
    const index = Number(sectionKey.replace(/^--?/, ''))
    return Number.isFinite(index) ? tints[(index + 1) % tints.length] : tints[0]
  }

  // 按规则块重写，一次到位：只改 section 节点的填充与文字色，连线（section-edge / line 的 stroke）保持不变。
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (rule: string, selector: string, body: string) => {
    // Mermaid 的根节点写作 `.section-root` / `.section--1`，分支写作 `.section-0` / `.section-1`。
    const key = /\.section-(root|--?\d+|\d+)\b/.exec(selector)?.[1]
    if (!key) {
      return rule
    }
    const tint = tintFor(key)
    const isLabel = /\b(text|span)\b/.test(selector)
    // 节点形状才描边；连线规则只改颜色不改描边，避免把连接线画成色块。
    const isNodeShape = /\b(circle|rect|polygon)\b/.test(selector) && !/\bline\b/.test(selector)
    let nextBody = body
      .replace(/fill:[^;}]+/g, `fill:${isLabel ? tint.label : tint.fill}`)
      .replace(/color:[^;}]+/g, `color:${tint.label}`)
    if (isNodeShape) {
      nextBody = nextBody.replace(/stroke:[^;}]+/g, `stroke:${tint.border}`)
    }
    return `${selector}{${nextBody}}`
  })
}

function applySectionTints(svg: SVGSVGElement, theme: MermaidTheme): void {
  const styleElement = svg.querySelector('style')
  if (!styleElement?.textContent) {
    return
  }
  styleElement.textContent = rewriteSectionColors(styleElement.textContent, theme)
}

/**
 * Mermaid 渲染块。
 * - 渲染成功后可按「适应宽度 / 100%」切换；
 * - 渲染失败时降级为源码，并把失败原因展示出来，内容不会消失。
 */
export function MermaidBlock({
  className,
  source,
  theme,
}: {
  className?: string
  source: string
  theme: MermaidTheme
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [zoom, setZoom] = useState<ZoomMode>('actual')
  const [naturalWidth, setNaturalWidth] = useState(0)
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      try {
        const mermaid = await loadMermaid(theme)
        const { svg } = await mermaid.render(idRef.current, source)
        if (cancelled || !containerRef.current) {
          return
        }
        containerRef.current.innerHTML = svg
        const element = containerRef.current.querySelector('svg')
        if (element) {
          applySectionTints(element as SVGSVGElement, theme)
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
  }, [source, theme])

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
        <p className="text-meta text-warning">导图图形渲染失败，以下为源码：{failure.slice(0, 160)}</p>
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-card/60 p-3 text-meta text-text-muted">
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
              'rounded px-2 py-0.5 text-micro transition-colors',
              zoom === mode ? 'bg-secondary text-foreground' : 'text-text-subtle hover:text-foreground',
            )}
          >
            {mode === 'fit' ? '适应宽度' : '100%'}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="mermaid-host max-h-[32.5rem] overflow-auto [&_svg]:mx-auto" aria-hidden="true" />
    </div>
  )
}
