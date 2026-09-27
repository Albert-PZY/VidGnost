import { useEffect, useRef } from 'react'
import { AlertTriangle, Check, CircleDot, Loader2, MinusCircle } from 'lucide-react'

import type { StageState, TaskRecord } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { useAppStore } from '@/stores/app-store'

const STATUS_STYLE: Record<StageState['status'], { icon: typeof Check; tone: string }> = {
  pending: { icon: CircleDot, tone: 'text-text-subtle' },
  running: { icon: Loader2, tone: 'text-primary' },
  succeeded: { icon: Check, tone: 'text-success' },
  failed: { icon: AlertTriangle, tone: 'text-destructive' },
  skipped: { icon: MinusCircle, tone: 'text-text-subtle' },
}

/**
 * 处理中视图：10 个阶段的实时进度 + 阶段日志。
 * 只展示当前任务真实发生的事，不做进度条动画粉饰。
 */
export function StageBoard({ task }: { task: TaskRecord }) {
  const logs = useAppStore((state) => state.logs)
  const cancelTask = useAppStore((state) => state.cancelTask)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = logRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [logs.length])

  const running = task.status === 'running' || task.status === 'queued'
  const readiness = Math.round((task.readiness || 0) * 100)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pb-4 pt-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="label-eyebrow">
              {task.status === 'failed' ? '处理失败' : running ? '正在处理' : '已停止'}
            </p>
            <h2 className="mt-1.5 text-title font-semibold tracking-tight text-text-strong">{task.title}</h2>
            <p className="mt-1 text-meta text-text-muted">
              <span className="timecode">{formatTimecode(task.source.durationSeconds)}</span>
              <span className="mx-1.5">·</span>
              {task.source.kind === 'url' ? '在线来源' : '本地文件'}
              <span className="mx-1.5">·</span>
              {task.id}
            </p>
          </div>
          <div className="text-right">
            <p className="metric-value text-hero leading-none text-text-strong">{readiness}%</p>
            <p className="mt-1 text-micro text-text-subtle">就绪度</p>
          </div>
        </div>

        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn('h-full rounded-full transition-[width] duration-700', task.status === 'failed' ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${Math.max(2, readiness)}%` }}
          />
        </div>

        {task.error ? (
          <div role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-note font-medium text-destructive">{task.error.message}</p>
            {task.error.hint ? <p className="mt-1 text-meta text-destructive/80">{task.error.hint}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-5 px-6 pb-5">
        <ol className="min-h-0 space-y-0.5 overflow-y-auto pr-1">
          {task.stages.map((stage) => {
            const style = STATUS_STYLE[stage.status]
            const Icon = style.icon
            return (
              <li
                key={stage.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors',
                  stage.status === 'running' && 'bg-secondary/60',
                )}
              >
                <Icon className={cn('size-3.5 shrink-0', style.tone, stage.status === 'running' && 'animate-spin')} />
                <span className="w-[5.375rem] shrink-0 truncate text-note text-foreground">{stage.label}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-text-subtle">
                  {stage.status === 'running' && stage.progress > 0.01
                    ? `${stage.message || '处理中'} · ${Math.round(stage.progress * 100)}%`
                    : stage.message || (stage.status === 'pending' ? '等待中' : '')}
                </span>
                {stage.status === 'succeeded' ? (
                  <span className="timecode shrink-0 text-micro text-text-subtle">{stage.progress >= 1 ? '完成' : ''}</span>
                ) : null}
              </li>
            )
          })}
        </ol>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/50">
          <div className="flex items-center justify-between px-3.5 py-2 hairline-b">
            <span className="label-eyebrow">阶段日志</span>
            <span className="text-micro text-text-subtle">{logs.length} 条</span>
          </div>
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2">
            {logs.length === 0 ? (
              <p className="py-6 text-center text-meta text-text-subtle">等待第一条日志…</p>
            ) : (
              <ol className="space-y-1">
                {logs.map((line, index) => (
                  <li key={`${line.at}-${index}`} className="flex gap-2">
                    <span className="timecode shrink-0 pt-px text-micro text-text-subtle">
                      {new Date(line.at).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <span
                      className={cn(
                        'min-w-0 flex-1 break-words text-meta leading-relaxed',
                        line.level === 'error'
                          ? 'text-destructive'
                          : line.level === 'warn'
                            ? 'text-warning'
                            : 'text-text-muted',
                      )}
                    >
                      {line.message}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      {running ? (
        <div className="flex items-center justify-between px-6 pb-4">
          <p className="text-meta text-text-subtle">处理期间可以关闭窗口，任务会在后端继续执行并保留检查点。</p>
          <button
            type="button"
            onClick={() => void cancelTask()}
            className="rounded-md border border-border px-3 py-1.5 text-meta text-text-muted transition-colors hover:border-destructive/50 hover:text-destructive"
          >
            取消任务
          </button>
        </div>
      ) : null}
    </div>
  )
}
