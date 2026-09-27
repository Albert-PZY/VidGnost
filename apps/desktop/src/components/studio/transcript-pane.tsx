import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import type { TranscriptDoc } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { usePlayerStore } from '@/stores/player-store'
import { EmptyState } from '@/components/studio/notes-pane'
import { Input } from '@/components/ui/input'

/**
 * 原文视图：转写逐句呈现，当前播放句自动跟随并高亮。
 * 点击任意句即回到原片该位置；搜索只过滤显示，不改变播放位置。
 */
export function TranscriptPane({ transcript }: { transcript: TranscriptDoc | null }) {
  const currentTime = usePlayerStore((state) => state.currentTime)
  const seek = usePlayerStore((state) => state.seek)
  const [query, setQuery] = useState('')
  const activeRef = useRef<HTMLLIElement>(null)

  const segments = transcript?.segments || []
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return segments
    return segments.filter((segment) => segment.text.toLowerCase().includes(keyword))
  }, [query, segments])

  const activeId = useMemo(
    () => segments.find((segment) => currentTime >= segment.start && currentTime <= segment.end)?.id,
    [currentTime, segments],
  )

  useEffect(() => {
    if (!query) {
      activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeId, query])

  if (!transcript) {
    return <EmptyState message="转写还没完成。" />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-6 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-subtle" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="在转写中查找"
            aria-label="在转写中查找"
            className="h-7 w-[13.75rem] pl-8 text-note"
          />
        </div>
        <span className="text-meta text-text-subtle">
          {query ? `${filtered.length} / ${segments.length} 句` : `${segments.length} 句`}
          <span className="mx-1.5">·</span>
          {transcript.engine === 'faster-whisper' ? '本地 Whisper' : '在线转写'}
          <span className="mx-1.5">·</span>
          {transcript.language}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {filtered.length === 0 ? (
          <EmptyState message={`没有包含「${query}」的句子。`} />
        ) : (
          <ol className="mx-auto max-w-[47.5rem]">
            {filtered.map((segment) => {
              const active = segment.id === activeId
              return (
                <li
                  key={segment.id}
                  ref={active ? activeRef : undefined}
                  className={cn(
                    'group flex gap-3 rounded-lg px-2 py-1.5 transition-colors',
                    active ? 'bg-secondary/70' : 'hover:bg-secondary/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => seek(segment.start)}
                    className={cn(
                      'timecode mt-[3px] w-[2.875rem] shrink-0 text-left transition-colors',
                      active ? 'text-timestamp' : 'text-text-subtle group-hover:text-timestamp',
                    )}
                  >
                    {formatTimecode(segment.start)}
                  </button>
                  <p className={cn('min-w-0 flex-1 text-body leading-[1.75]', active ? 'text-text-strong' : 'text-foreground/90')}>
                    {segment.text}
                  </p>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
