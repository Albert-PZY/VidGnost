import { useState } from 'react'
import { Inbox, Loader2, Plus, Search } from 'lucide-react'

import type { TaskOptions } from '@vidgnost/contracts'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NewTaskDialog } from '@/components/library/new-task-dialog'
import { TaskCard } from '@/components/library/task-card'
import { useAppStore } from '@/stores/app-store'

/** 资产库：所有已处理视频的唯一入口，承担识别、比较与进入工作台。 */
export function LibraryView() {
  const library = useAppStore((state) => state.library)
  const loading = useAppStore((state) => state.libraryLoading)
  const query = useAppStore((state) => state.libraryQuery)
  const setQuery = useAppStore((state) => state.setLibraryQuery)
  const createTask = useAppStore((state) => state.createTask)
  const deleteTask = useAppStore((state) => state.deleteTask)
  const openTask = useAppStore((state) => state.openTask)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const filtered = library
  const empty = !loading && filtered.length === 0

  const submit = async (input: { source: string; options: Partial<TaskOptions> }) => {
    setSubmitting(true)
    try {
      await createTask(input)
      setDialogOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-4 px-6 pb-3.5 pt-5">
        <div>
          <h1 className="text-page font-semibold tracking-tight text-text-strong">资产库</h1>
          <p className="mt-0.5 text-meta text-text-muted">
            {empty ? '还没有处理过的视频' : `共 ${library.length} 个任务 · 点击卡片进入工作台`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-subtle" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题或任务 ID"
              aria-label="搜索任务"
              className="h-8 w-[15rem] pl-8 text-note"
            />
          </div>
          <Button size="sm" className="h-8 gap-1.5 text-note" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" /> 新建任务
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {loading && library.length === 0 ? (
          <div className="flex h-40 items-center justify-center gap-2 text-note text-text-muted">
            <Loader2 className="size-4 animate-spin" /> 正在读取资产库…
          </div>
        ) : empty && query ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <Search className="size-6 text-text-subtle" />
            <p className="text-body text-text-muted">没有匹配「{query}」的任务</p>
            <Button variant="ghost" size="sm" className="h-7 text-meta" onClick={() => setQuery('')}>
              清除搜索条件
            </Button>
          </div>
        ) : empty ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-secondary text-text-muted">
              <Inbox className="size-5" strokeWidth={1.6} />
            </span>
            <div>
              <p className="text-lead font-medium text-text-strong">把一个视频变成可检索的知识</p>
              <p className="mt-1 text-note text-text-muted">
                拖入本地文件或粘贴链接，VidGnost 会产出章节、摘要、思维导图、知识图谱与可追问的索引。
              </p>
            </div>
            <Button size="sm" className="mt-1 gap-1.5 text-note" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3.5" /> 新建任务
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onOpen={() => void openTask(task.id)}
                onDelete={() => setPendingDelete(task.id)}
              />
            ))}
          </div>
        )}
      </div>

      <NewTaskDialog open={dialogOpen} onOpenChange={setDialogOpen} onSubmit={submit} submitting={submitting} />

      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center"
          style={{ background: 'var(--scrim)', backdropFilter: 'blur(4px)' }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null)
          }}
        >
          <div className="reveal w-[min(400px,92vw)] rounded-xl border border-border-strong bg-popover p-5">
            <h2 className="text-lead font-semibold text-text-strong">删除这个任务？</h2>
            <p className="mt-1.5 text-note leading-relaxed text-text-muted">
              转写、章节、摘要、索引与导出产物都会被一并删除，无法恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-note" onClick={() => setPendingDelete(null)}>
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-note"
                onClick={async () => {
                  const target = pendingDelete
                  setPendingDelete(null)
                  await deleteTask(target)
                }}
              >
                删除
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
