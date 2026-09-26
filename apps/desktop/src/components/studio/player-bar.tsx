import { useEffect, useRef } from 'react'
import { Gauge, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'

import type { Chapter } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { usePlayerStore } from '@/stores/player-store'
import { useState } from 'react'

const RATES = [0.75, 1, 1.25, 1.5, 2]

/**
 * 底部播放条：把视频、章节结构与时间线放在一起。
 * 时间线上的章节分段是可点击的跳转锚点，因此「摘要里的时间码」与「时间线」是同一套坐标。
 */
export function PlayerBar({ chapters }: { chapters: Chapter[] }) {
  const { currentTime, duration, playing, setCurrentTime, setDuration, setPlaying, seek, toggle, nudge } =
    usePlayerStore()
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (event.code === 'Space') {
        event.preventDefault()
        toggle()
      }
      if (event.code === 'ArrowLeft') nudge(-5)
      if (event.code === 'ArrowRight') nudge(5)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [nudge, toggle])

  const total = duration || 1

  const seekFromEvent = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    seek(ratio * total)
  }

  const activeChapter = chapters.find((chapter) => currentTime >= chapter.start && currentTime <= chapter.end)

  return (
    <div className="hairline-t bg-background/85 px-4 py-2.5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="timecode flex w-[92px] shrink-0 items-baseline gap-1 text-text-muted">
          <span className="text-[12px] text-foreground">{formatTimecode(currentTime)}</span>
          <span className="text-text-subtle">/</span>
          <span>{formatTimecode(duration)}</span>
        </div>

        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(currentTime)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') nudge(-5)
            if (event.key === 'ArrowRight') nudge(5)
          }}
          onMouseDown={(event) => {
            draggingRef.current = true
            seekFromEvent(event.clientX)
          }}
          onMouseMove={(event) => {
            if (draggingRef.current) seekFromEvent(event.clientX)
          }}
          onMouseUp={() => {
            draggingRef.current = false
          }}
          onMouseLeave={() => {
            draggingRef.current = false
          }}
          className="group relative h-6 flex-1 cursor-pointer select-none"
        >
          <div className="absolute inset-x-0 top-1/2 h-[5px] -translate-y-1/2 overflow-hidden rounded-full bg-secondary">
            {/* 章节区间：既是结构可视化，也是可点击的跳转锚点 */}
            {chapters.map((chapter) => {
              const left = (chapter.start / total) * 100
              const width = Math.max(0.5, ((chapter.end - chapter.start) / total) * 100)
              return (
                <button
                  key={chapter.id}
                  type="button"
                  title={`${chapter.title} · ${formatTimecode(chapter.start)}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    seek(chapter.start)
                  }}
                  className={cn(
                    'absolute top-0 h-full border-r border-background/80 transition-colors',
                    activeChapter?.id === chapter.id ? 'bg-primary/45' : 'bg-foreground/18 hover:bg-foreground/30',
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              )
            })}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary/25"
              style={{ width: `${(currentTime / total) * 100}%` }}
            />
          </div>

          <div
            className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover:opacity-100"
            style={{ left: `${(currentTime / total) * 100}%` }}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            onClick={toggle}
            className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
          </button>
          <button
            type="button"
            aria-label="后退 5 秒"
            onClick={() => nudge(-5)}
            className="grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={muted ? '取消静音' : '静音'}
            onClick={() => {
              const element = usePlayerStore.getState().videoEl
              if (element) element.muted = !muted
              setMuted(!muted)
            }}
            className="grid size-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-secondary hover:text-foreground"
          >
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label="播放速度"
            onClick={() => {
              const index = RATES.indexOf(rate)
              const next = RATES[(index + 1) % RATES.length]
              const element = usePlayerStore.getState().videoEl
              if (element) element.playbackRate = next
              setRate(next)
            }}
            className="timecode flex h-8 items-center gap-1 rounded-lg px-2 text-text-muted transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Gauge className="size-3.5" />
            {rate}×
          </button>
        </div>
      </div>

      <div className="mt-1 flex items-center gap-2 pl-[104px] text-[10px] text-text-subtle">
        {activeChapter ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="text-text-muted">{activeChapter.title}</span>
            <TimeAnchorInline seconds={activeChapter.start} />
            {activeChapter.gist ? <span className="truncate">· {activeChapter.gist}</span> : null}
          </span>
        ) : chapters.length > 0 ? (
          <span>把鼠标放到进度条上可以看到章节区间，点击分段直接跳转。</span>
        ) : (
          <span>章节结构生成后，进度条上会出现可点击的分段。</span>
        )}
        <span className="ml-auto shrink-0">Space 播放 · ←/→ 快退快进 5s</span>
      </div>
    </div>
  )
}

function TimeAnchorInline({ seconds }: { seconds: number }) {
  const seek = usePlayerStore((state) => state.seek)
  return (
    <button
      type="button"
      onClick={() => seek(seconds)}
      className="timecode ml-1.5 rounded px-1 text-text-subtle transition-colors hover:bg-secondary hover:text-timestamp"
    >
      {formatTimecode(seconds)}
    </button>
  )
}
