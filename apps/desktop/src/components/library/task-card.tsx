import { AlertCircle, CheckCircle2, Clock3, Loader2, Trash2, XCircle } from 'lucide-react'

import type { TaskSummary } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'
import { formatRelativeTime, formatTimecode, platformLabel, statusLabel } from '@/lib/format'

const STATUS_ICON = {
  succeeded: CheckCircle2,
  running: Loader2,
  queued: Clock3,
  failed: AlertCircle,
  canceled: XCircle,
} as const

const STATUS_TONE: Record<TaskSummary['status'], string> = {
  succeeded: 'text-success',
  running: 'text-primary',
  queued: 'text-text-subtle',
  failed: 'text-destructive',
  canceled: 'text-text-subtle',
}

/**
 * 资产库卡片：只呈现「能不能用」与「是什么」——标题、就绪度、标签与规模。
 * 详情一律进入工作台查看，卡片不承载阅读内容。
 */
export function TaskCard({
  onDelete,
  onOpen,
  task,
}: {
  onDelete: () => void
  onOpen: () => void
  task: TaskSummary
}) {
  const Icon = STATUS_ICON[task.status] || Clock3
  const readiness = Math.round((task.readiness || 0) * 100)

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200',
        'border-border/60 bg-card/70 hover:-translate-y-0.5 hover:border-border-strong hover:bg-card',
      )}
    >
      <button type="button" onClick={onOpen} className="flex-1 px-4 pb-3 pt-3.5 text-left">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 text-[13px] font-medium leading-snug text-text-strong">{task.title}</h3>
          <span className={cn('mt-0.5 inline-flex shrink-0 items-center gap-1 text-[10px]', STATUS_TONE[task.status])}>
            <Icon className={cn('size-3', task.status === 'running' && 'animate-spin')} />
            {statusLabel(task.status)}
          </span>
        </div>

        <p className="mt-2 line-clamp-2 min-h-[32px] text-[11px] leading-relaxed text-text-muted">
          {task.tldr || (task.status === 'succeeded' ? '暂无摘要' : '处理完成后会生成摘要与章节')}
        </p>

        {task.tags.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {task.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-text-muted">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </button>

      <div className="px-4 pb-3">
        <div className="h-[3px] w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', task.status === 'failed' ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${Math.max(4, readiness)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-text-subtle">
          <span className="truncate">
            {platformLabel(task.platform)} · <span className="timecode">{formatTimecode(task.durationSeconds)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {task.chapters > 0 ? <span>{task.chapters} 章</span> : null}
            {task.knowledgeNodes > 0 ? <span>{task.knowledgeNodes} 概念</span> : null}
            <span>{formatRelativeTime(task.updatedAt)}</span>
          </span>
        </div>
      </div>

      <button
        type="button"
        aria-label="删除任务"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        className="absolute right-2 top-2 hidden size-7 place-items-center rounded-md text-text-subtle transition-colors hover:bg-destructive/15 hover:text-destructive group-hover:grid"
      >
        <Trash2 className="size-3.5" />
      </button>
    </article>
  )
}
