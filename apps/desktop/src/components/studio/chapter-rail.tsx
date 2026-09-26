import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { usePlayerStore } from '@/stores/player-store'
import type { Chapter } from '@vidgnost/contracts'

/** 章节轨：结构导航 + 时间锚点。当前播放章节自动跟随高亮。 */
export function ChapterRail({ chapters }: { chapters: Chapter[] }) {
  const currentTime = usePlayerStore((state) => state.currentTime)
  const seek = usePlayerStore((state) => state.seek)
  const activeRef = useRef<HTMLButtonElement>(null)
  const activeId = chapters.find((chapter) => currentTime >= chapter.start && currentTime <= chapter.end)?.id

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId])

  if (chapters.length === 0) {
    return (
      <aside className="w-[228px] shrink-0 px-4 py-5 hairline-r">
        <span className="label-eyebrow">章节</span>
        <p className="mt-3 text-[11px] leading-relaxed text-text-subtle">处理完成后会在这里生成章节结构。</p>
      </aside>
    )
  }

  return (
    <aside className="flex w-[228px] shrink-0 flex-col hairline-r">
      <div className="flex items-baseline justify-between px-4 pb-2 pt-4">
        <span className="label-eyebrow">章节</span>
        <span className="text-[10px] text-text-subtle">{chapters.length}</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {chapters.map((chapter, index) => {
          const active = chapter.id === activeId
          return (
            <button
              key={chapter.id}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => seek(chapter.start, { autoplay: false })}
              className={cn(
                'mb-0.5 flex w-full gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                active ? 'bg-secondary' : 'hover:bg-secondary/50',
              )}
            >
              <span
                className={cn(
                  'metric-value mt-px w-4 shrink-0 text-[10px]',
                  active ? 'text-primary' : 'text-text-subtle',
                )}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block text-[12px] font-medium leading-snug',
                    active ? 'text-text-strong' : 'text-foreground/90',
                  )}
                >
                  {chapter.title}
                </span>
                <span className="timecode mt-0.5 block text-[10px] text-text-subtle">
                  {formatTimecode(chapter.start)}
                </span>
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
