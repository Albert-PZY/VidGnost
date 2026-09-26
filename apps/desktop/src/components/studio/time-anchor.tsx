import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { usePlayerStore } from '@/stores/player-store'

/** 时间锚点：所有引用、时间码、章节标题都用它回到原片。 */
export function TimeAnchor({
  autoplay = true,
  className,
  seconds,
  tone = 'quiet',
}: {
  autoplay?: boolean
  className?: string
  seconds: number | undefined
  tone?: 'chip' | 'quiet'
}) {
  const seek = usePlayerStore((state) => state.seek)
  const talk = '点击跳到原片对应片段'

  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return null
  }

  return (
    <button
      type="button"
      title={talk}
      aria-label={`跳到 ${formatTimecode(seconds)}`}
      onClick={(event) => {
        event.stopPropagation()
        seek(seconds, { autoplay })
      }}
      className={cn(
        'timecode shrink-0 rounded px-1.5 py-[3px] align-middle transition-colors',
        tone === 'chip'
          ? 'bg-timestamp-surface/70 text-timestamp hover:bg-timestamp-surface'
          : 'text-text-subtle hover:bg-secondary hover:text-timestamp',
        className,
      )}
    >
      {formatTimecode(seconds)}
    </button>
  )
}
