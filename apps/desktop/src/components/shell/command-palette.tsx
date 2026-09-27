import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, FileText, LibraryBig, Search, Settings, Waypoints } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatTimecode, platformLabel } from '@/lib/format'
import type { TaskSummary } from '@vidgnost/contracts'

export interface Command {
  hint?: string
  id: string
  label: string
  run: () => void
}

/**
 * 命令面板（Ctrl/Cmd + K）。
 * 键盘优先：↑↓ 选择、Enter 执行、Esc 关闭；鼠标只作为辅助。
 */
export function CommandPalette({
  commands,
  onClose,
  onOpenTask,
  open,
  tasks,
}: {
  commands: Command[]
  onClose: () => void
  onOpenTask: (taskId: string) => void
  open: boolean
  tasks: TaskSummary[]
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const matchedTasks = tasks
      .filter((task) =>
        !keyword
          ? true
          : task.title.toLowerCase().includes(keyword) || task.id.toLowerCase().includes(keyword),
      )
      .slice(0, keyword ? 8 : 5)

    const matchedCommands = commands.filter((command) =>
      !keyword ? true : command.label.toLowerCase().includes(keyword),
    )

    const entries: Array<
      | { kind: 'command'; command: Command }
      | { kind: 'task'; task: TaskSummary }
    > = [
      ...matchedCommands.map((command) => ({ kind: 'command' as const, command })),
      ...matchedTasks.map((task) => ({ kind: 'task' as const, task })),
    ]
    return entries.slice(0, 14)
  }, [commands, query, tasks])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setCursor(0)
  }, [query])

  if (!open) {
    return null
  }

  const activate = (index: number) => {
    const entry = results[index]
    if (!entry) return
    if (entry.kind === 'command') {
      entry.command.run()
    } else {
      onOpenTask(entry.task.id)
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      style={{ background: 'var(--scrim)', backdropFilter: 'blur(6px)' }}
    >
      <div
        role="dialog"
        aria-label="命令面板"
        aria-modal="true"
        className="reveal w-[min(620px,92vw)] overflow-hidden rounded-xl border border-border-strong bg-popover/95 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setCursor((value) => Math.min(value + 1, results.length - 1))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setCursor((value) => Math.max(value - 1, 0))
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            activate(cursor)
          }
        }}
      >
        <div className="flex items-center gap-2 px-3.5 py-2.5 hairline-b">
          <Search className="size-4 text-text-subtle" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务、跳转页面、执行操作…"
            className="h-6 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-text-subtle"
          />
          <kbd className="timecode rounded border border-border px-1.5 py-0.5 text-micro text-text-subtle">ESC</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-note text-text-subtle">没有匹配结果</p>
          ) : (
            results.map((entry, index) => {
              const active = index === cursor
              const key = entry.kind === 'command' ? entry.command.id : entry.task.id
              return (
                <button
                  key={key}
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => activate(index)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-secondary' : 'hover:bg-secondary/60',
                  )}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-background/70 text-text-muted">
                    {entry.kind === 'task' ? (
                      <FileText className="size-3.5" strokeWidth={1.8} />
                    ) : entry.command.id.startsWith('nav') ? (
                      <LibraryBig className="size-3.5" strokeWidth={1.8} />
                    ) : (
                      <Settings className="size-3.5" strokeWidth={1.8} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-foreground">
                      {entry.kind === 'command' ? entry.command.label : entry.task.title}
                    </span>
                    <span className="block truncate text-meta text-text-subtle">
                      {entry.kind === 'command'
                        ? entry.command.hint || ''
                        : `${platformLabel(entry.task.platform)} · ${formatTimecode(entry.task.durationSeconds)}`}
                    </span>
                  </span>
                  {active ? <CornerDownLeft className="size-3.5 shrink-0 text-text-subtle" /> : null}
                </button>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between px-3.5 py-2 text-micro text-text-subtle hairline-t">
          <span>↑↓ 选择 · Enter 执行</span>
          <span className="inline-flex items-center gap-1">
            <Waypoints className="size-3" /> {tasks.length} 个任务
          </span>
        </div>
      </div>
    </div>
  )
}
