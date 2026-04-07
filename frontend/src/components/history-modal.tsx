import type { TFunction } from 'i18next'
import { Check, Pencil, Search, Trash2, X } from 'lucide-react'

import { PreText } from './pretext'
import { ModalPanel } from './workbench-panels'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { TaskSummaryItem } from '../types'

interface HistoryModalProps {
  open: boolean
  onClose: () => void
  t: TFunction
  searchText: string
  setSearchText: (value: string) => void
  loadHistory: () => Promise<void>
  history: TaskSummaryItem[]
  editingHistoryTaskId: string | null
  editingHistoryTitle: string
  setEditingHistoryTitle: (value: string) => void
  historyActionBusyTaskId: string | null
  activeTaskId: string | null
  onSelectTask: (item: TaskSummaryItem) => void
  startEditHistoryTitle: (item: TaskSummaryItem) => void
  saveHistoryTitle: (taskId: string) => Promise<void>
  cancelEditHistoryTitle: () => void
  openDeleteConfirm: (item: TaskSummaryItem) => void
  resolveTaskStatusText: (item: TaskSummaryItem) => string
  isTaskTerminalStatus: (status: string) => boolean
  inputClassName: string
}

export function HistoryModal({
  open,
  onClose,
  t,
  searchText,
  setSearchText,
  loadHistory,
  history,
  editingHistoryTaskId,
  editingHistoryTitle,
  setEditingHistoryTitle,
  historyActionBusyTaskId,
  activeTaskId,
  onSelectTask,
  startEditHistoryTitle,
  saveHistoryTitle,
  cancelEditHistoryTitle,
  openDeleteConfirm,
  resolveTaskStatusText,
  isTaskTerminalStatus,
  inputClassName,
}: HistoryModalProps) {
  return (
    <ModalPanel
      open={open}
      title={t('history.modal.title')}
      description={t('history.modal.description')}
      onClose={onClose}
    >
      <div className="mb-3.5 flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-2.5 py-1.5">
        <Search className="h-4 w-4 text-text-subtle" />
        <input
          className="w-full bg-transparent text-[0.9rem] outline-none"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void loadHistory()
          }}
          placeholder={t('history.searchPlaceholder')}
        />
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 min-w-[72px] whitespace-nowrap px-4"
          onClick={() => void loadHistory()}
        >
          {t('history.searchAction')}
        </Button>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-bg-base/70 px-3 py-1.5">
        <PreText variant="timestamp">{t('history.listMeta', { count: history.length })}</PreText>
        <PreText variant="timestamp">{t('history.activeHint')}</PreText>
      </div>
      <div className="max-h-[480px] space-y-2.5 overflow-auto pr-1">
        {history.length === 0 && (
          <div className="rounded-xl border border-border bg-surface-muted px-3 py-6 text-center text-sm text-text-subtle">
            {t('history.empty')}
          </div>
        )}
        {history.map((item) => {
          const isEditing = editingHistoryTaskId === item.id
          const busy = historyActionBusyTaskId === item.id
          const canDelete = isTaskTerminalStatus(item.status)

          return (
            <div
              key={item.id}
              className={cn(
                'w-full rounded-xl border border-transparent bg-surface-muted/92 px-3.5 py-2.5 transition hover:border-accent/40',
                item.id === activeTaskId &&
                  'border-accent/60 shadow-[0_10px_24px_-20px_rgba(31,142,241,0.7)]',
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    if (isEditing) return
                    onSelectTask(item)
                  }}
                >
                  {isEditing ? (
                    <input
                      className={cn(inputClassName, 'h-8')}
                      value={editingHistoryTitle}
                      onChange={(event) => setEditingHistoryTitle(event.target.value)}
                      placeholder={t('history.actions.titlePlaceholder')}
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void saveHistoryTitle(item.id)
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelEditHistoryTitle()
                        }
                      }}
                    />
                  ) : (
                    <PreText variant="h3" className="line-clamp-1">
                      {item.title ?? item.source_input}
                    </PreText>
                  )}
                  <div className="mt-1 inline-flex rounded-md border border-border/70 bg-bg-base/75 px-1.5 py-0.5 text-[11px] text-text-subtle">
                    {item.source_type === 'bilibili' ? t('source.mode.url') : t('source.mode.path')}
                  </div>
                  <PreText variant="timestamp" className="mt-0.5">
                    {resolveTaskStatusText(item)} · {item.progress}%
                  </PreText>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  {isEditing ? (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t('history.actions.save')}
                        disabled={busy}
                        onClick={() => void saveHistoryTitle(item.id)}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t('history.actions.cancel')}
                        disabled={busy}
                        onClick={cancelEditHistoryTitle}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t('history.actions.edit')}
                        disabled={busy}
                        onClick={() => startEditHistoryTitle(item)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t('history.actions.delete')}
                        title={!canDelete ? t('history.actions.deleteDisabledRunning') : undefined}
                        disabled={busy || !canDelete}
                        onClick={() => openDeleteConfirm(item)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </ModalPanel>
  )
}
