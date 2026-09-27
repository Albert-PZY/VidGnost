import { Play } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { Chapter } from '@vidgnost/contracts'

import { api } from '@/lib/api'
import { formatTimecode } from '@/lib/format'
import { usePlayerStore } from '@/stores/player-store'

/**
 * 画面带：左侧为视频舞台（固定 16:9），右侧跟随当前章节的上下文。
 * 视频只在播放时占据注意力，其余时间把横向空间让给章节信息，避免大面积黑边。
 */
export function VideoBand({ chapters, taskId }: { chapters: Chapter[]; taskId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const setVideoEl = usePlayerStore((state) => state.setVideoEl)
  const setDuration = usePlayerStore((state) => state.setDuration)
  const setCurrentTime = usePlayerStore((state) => state.setCurrentTime)
  const setPlaying = usePlayerStore((state) => state.setPlaying)
  const toggle = usePlayerStore((state) => state.toggle)
  const seek = usePlayerStore((state) => state.seek)
  const currentTime = usePlayerStore((state) => state.currentTime)

  useEffect(() => {
    setVideoEl(videoRef.current)
    return () => setVideoEl(null)
  }, [setVideoEl])

  const activeChapter =
    chapters.find((chapter) => currentTime >= chapter.start && currentTime <= chapter.end) || chapters[0] || null

  // flex-wrap：字号放大后中间栏放不下「视频 + 章节卡」时改上下排列，不让章节卡被挤到溢出。
  return (
    <div className="flex shrink-0 flex-wrap gap-4 px-5 pt-3.5">
      {/* max-w-full：字号放大后中间栏可能比视频的设计宽度还窄，此时按栏宽收缩而不是把旁边的章节卡挤没。 */}
      <div className="group relative w-[18.75rem] max-w-full shrink-0 overflow-hidden rounded-lg border border-border/60 bg-black">
        <video
          ref={videoRef}
          src={`${api.mediaUrl(taskId)}#t=0.5`}
          preload="metadata"
          className="aspect-video w-full bg-black object-contain"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <button
          type="button"
          aria-label="播放"
          onClick={toggle}
          className="absolute inset-0 grid place-items-center bg-background/10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <span className="grid size-10 place-items-center rounded-full bg-background/85 text-foreground backdrop-blur">
            <Play className="size-4 translate-x-px" />
          </span>
        </button>
      </div>

      <div className="min-w-0 flex-1 rounded-lg border border-border/50 bg-card/40 px-4 py-3">
        {activeChapter ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="label-eyebrow">当前章节</span>
              <button
                type="button"
                onClick={() => seek(activeChapter.start)}
                className="timecode rounded px-1 text-timestamp transition-colors hover:bg-timestamp-surface/60"
              >
                {formatTimecode(activeChapter.start)}
              </button>
            </div>
            <h3 className="mt-1.5 truncate text-body font-medium text-text-strong">{activeChapter.title}</h3>
            <p className="mt-1 line-clamp-2 text-meta leading-relaxed text-text-muted">{activeChapter.gist}</p>
            {activeChapter.bullets.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {activeChapter.bullets.slice(0, 3).map((bullet, index) => (
                  <li key={index} className="flex gap-2 text-meta leading-relaxed text-text-muted">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-text-subtle" />
                    <span className="line-clamp-1">{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-meta text-text-subtle">章节结构生成后，这里会跟随播放位置显示当前章节。</p>
        )}
      </div>
    </div>
  )
}
