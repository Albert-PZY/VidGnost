import { Activity, AlertTriangle, ChevronRight, Loader2 } from 'lucide-react'

import type { TaskRecord } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'

/**
 * 处理中提示条：任务运行时在内容区顶部保留一条常驻状态，
 * 打断「看不到进度」的不确定感，同时不抢占已经可读的产物区域。
 */
export function ProcessingStrip({
  expanded,
  onToggle,
  task,
}: {
  expanded: boolean
  onToggle: () => void
  task: TaskRecord
}) {
  const running = task.stages.find((stage) => stage.status === 'running')
  const failed = task.stages.find((stage) => stage.status === 'failed')
  const readiness = Math.round((task.readiness || 0) * 100)

  const tone = failed ? 'text-destructive' : task.status === 'succeeded' ? 'text-success' : 'text-primary'
  const Icon = failed ? AlertTriangle : task.status === 'succeeded' ? Activity : Loader2

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="group flex w-full items-center gap-3 px-5 py-2 text-left transition-colors hairline-b hover:bg-secondary/40"
    >
      <Icon className={cn('size-3.5 shrink-0', tone, !failed && task.status !== 'succeeded' && 'animate-spin')} />

      <span className={cn('shrink-0 text-meta', tone)}>
        {failed ? '处理中断' : task.status === 'succeeded' ? '处理完成' : task.status === 'queued' ? '排队中' : '正在处理'}
      </span>

      <span className="min-w-0 flex-1 truncate text-meta text-text-muted">
        {failed
          ? `${failed.label}：${failed.error?.message || '未知错误'}`
          : running
            ? `${running.label} · ${running.message || '处理中'}`
            : task.status === 'succeeded'
              ? `${task.stats.chapters} 章 · ${task.stats.chunks} 个检索块 · ${task.stats.knowledgeNodes} 个概念`
              : '等待调度'}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span className="h-1 w-24 overflow-hidden rounded-full bg-secondary">
          <span
            className={cn('block h-full rounded-full transition-[width] duration-700', failed ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${Math.max(2, readiness)}%` }}
          />
        </span>
        <span className="metric-value text-micro text-text-subtle">{readiness}%</span>
        <ChevronRight className={cn('size-3.5 text-text-subtle transition-transform', expanded && 'rotate-90')} />
      </span>
    </button>
  )
}
