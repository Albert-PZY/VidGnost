import { LibraryBig, Settings, Sparkles, Waypoints } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Workspace } from '@/stores/app-store'

const ITEMS: Array<{ icon: typeof LibraryBig; id: Workspace; label: string }> = [
  { id: 'library', label: '资产库', icon: LibraryBig },
  { id: 'studio', label: '工作台', icon: Sparkles },
  { id: 'providers', label: '模型', icon: Waypoints },
  { id: 'settings', label: '设置', icon: Settings },
]

/** 左侧图标导航轨。宽度固定 52px，只在选中项显示强调色。 */
export function SideRail({
  active,
  hasTask,
  onSelect,
}: {
  active: Workspace
  hasTask: boolean
  onSelect: (workspace: Workspace) => void
}) {
  return (
    <nav
      aria-label="主导航"
      className="flex w-[52px] flex-col items-center gap-1 py-3 hairline-r bg-background/60"
    >
      {ITEMS.map((item) => {
        const disabled = item.id === 'studio' && !hasTask
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            aria-current={active === item.id ? 'page' : undefined}
            title={disabled ? '先打开一个任务' : item.label}
            onClick={() => onSelect(item.id)}
            className={cn(
              'group relative grid size-10 place-items-center rounded-lg text-text-muted transition-colors',
              'hover:bg-secondary hover:text-foreground',
              active === item.id && 'bg-secondary text-foreground',
              disabled && 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-text-muted',
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.7} />
            <span
              className={cn(
                'absolute -left-[9px] h-5 w-[2px] rounded-full bg-primary transition-opacity',
                active === item.id ? 'opacity-100' : 'opacity-0',
              )}
            />
            <span className="pointer-events-none absolute left-12 z-30 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground shadow-lg group-hover:block">
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
