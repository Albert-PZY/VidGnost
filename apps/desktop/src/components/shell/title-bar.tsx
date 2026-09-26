import { useEffect, useState } from 'react'
import { ChevronsLeft, Minus, Square, X } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * 桌面标题栏：左侧品牌与当前位置，中部拖拽区域，右侧窗口控制。
 * 在浏览器调试模式下自动隐藏窗口控制按钮。
 */
export function TitleBar({
  breadcrumb,
  actions,
  onCommandPalette,
  onToggleAside,
  asideCollapsed,
  asideAvailable,
}: {
  actions?: React.ReactNode
  asideCollapsed: boolean
  asideAvailable: boolean
  breadcrumb: string
  onCommandPalette: () => void
  onToggleAside: () => void
}) {
  const bridge = typeof window !== 'undefined' ? window.vidGnostDesktop : undefined
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!bridge) return
    return bridge.onWindowStateChange((state) => setMaximized(Boolean(state?.maximized)))
  }, [bridge])

  return (
    <header className="drag-region relative z-20 flex h-11 items-center gap-3 pl-3 pr-0 hairline-b bg-background/70 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
          <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
            <path
              d="M2.2 3.6h5.1v3.2H4.6v1.5h2.7v3.1H2.2zM9.4 3.6h4.4v1.7l-2.3 3.2 2.3 3.3v1.6H9.4V9.9l2-2.7-2-2.7z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-text-strong">VidGnost</span>
      </div>

      <span className="h-4 w-px bg-border" />

      <span className="truncate text-[12px] text-text-muted">{breadcrumb}</span>

      <div className="flex-1" />

      <div className="no-drag flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCommandPalette}
          className="flex h-7 items-center gap-2 rounded-md border border-border/70 px-2.5 text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-foreground"
        >
          <span>搜索与命令</span>
          <kbd className="timecode rounded border border-border/70 px-1 py-px text-[10px] text-text-subtle">Ctrl K</kbd>
        </button>
        {actions}
        {asideAvailable ? (
          <button
            type="button"
            onClick={onToggleAside}
            aria-label={asideCollapsed ? '展开详情面板' : '收起详情面板'}
            className={cn(
              'grid size-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-secondary hover:text-foreground',
              !asideCollapsed && 'text-foreground',
            )}
          >
            <ChevronsLeft className={cn('size-3.5 transition-transform', !asideCollapsed && 'rotate-180')} />
          </button>
        ) : null}
      </div>

      {bridge ? (
        <div className="no-drag ml-1 flex h-11 items-stretch">
          <button
            type="button"
            aria-label="最小化"
            onClick={() => void bridge.minimizeWindow()}
            className="grid w-11 place-items-center text-text-muted transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={maximized ? '还原窗口' : '最大化'}
            onClick={() => void bridge.toggleMaximizeWindow()}
            className="grid w-11 place-items-center text-text-muted transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Square className="size-3" />
          </button>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => void bridge.closeWindow()}
            className="grid w-11 place-items-center text-text-muted transition-colors hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <span className="w-2" />
      )}
    </header>
  )
}
