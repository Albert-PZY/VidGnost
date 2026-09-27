import type { KeyFrame } from '@vidgnost/contracts'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { EmptyState } from '@/components/studio/notes-pane'
import { usePlayerStore } from '@/stores/player-store'

/**
 * 画面视图：关键帧网格。每帧都是时间锚点，点击跳转原片。
 * 图注与屏上文字就是进入检索索引的那部分内容，因此这里同时是「检索证据预览」。
 */
export function FramesPane({ frames, taskId }: { frames: KeyFrame[] | null; taskId: string }) {
  const seek = usePlayerStore((state) => state.seek)

  if (!frames || frames.length === 0) {
    return <EmptyState message="没有关键帧。视觉增强未开启，或来源是纯音频。" />
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4 pb-8">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {frames.map((frame) => (
          <button
            key={frame.id}
            type="button"
            onClick={() => seek(frame.time)}
            className={cn(
              'group overflow-hidden rounded-xl border border-border/60 bg-card/50 text-left transition-all duration-200',
              'hover:-translate-y-0.5 hover:border-border-strong',
            )}
          >
            <div className="relative aspect-video overflow-hidden bg-background">
              <img
                src={api.frameUrl(taskId, frame.id)}
                alt={frame.caption || `关键帧 ${formatTimecode(frame.time)}`}
                loading="lazy"
                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
              <span className="timecode absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 text-timestamp">
                {formatTimecode(frame.time)}
              </span>
              {frame.slideLike ? (
                <span className="absolute right-2 top-2 rounded bg-primary/85 px-1.5 py-0.5 text-micro text-primary-foreground">
                  信息型画面
                </span>
              ) : null}
            </div>
            <div className="px-3 py-2.5">
              <p className="line-clamp-2 text-note leading-relaxed text-foreground/90">
                {frame.caption || '（无图注）'}
              </p>
              {frame.onScreenText ? (
                <p className="mt-1.5 line-clamp-2 border-l border-border pl-2 text-meta leading-relaxed text-text-subtle">
                  {frame.onScreenText}
                </p>
              ) : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
