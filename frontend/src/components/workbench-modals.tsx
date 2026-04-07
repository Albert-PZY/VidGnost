import type { RefObject } from 'react'
import type { TFunction } from 'i18next'
import { AlertTriangle, CloudUpload, LoaderCircle, Trash2 } from 'lucide-react'

import { PreText } from './pretext'
import { ModalPanel } from './workbench-panels'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { PromptTemplateChannel, TaskSummaryItem } from '../types'

type SourceMode = 'url' | 'path' | 'upload'

interface SourceTaskModalProps {
  open: boolean
  onClose: () => void
  t: TFunction
  sourceMode: SourceMode
  setSourceMode: (mode: SourceMode) => void
  urlInput: string
  setUrlInput: (value: string) => void
  pathInput: string
  setPathInput: (value: string) => void
  uploadFile: File | null
  setUploadFile: (file: File | null) => void
  dragging: boolean
  setDragging: (value: boolean) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  runtimeModel: string
  runtimeLanguage: string
  submitting: boolean
  submitTask: () => Promise<void>
  inputClassName: string
}

export function SourceTaskModal({
  open,
  onClose,
  t,
  sourceMode,
  setSourceMode,
  urlInput,
  setUrlInput,
  pathInput,
  setPathInput,
  uploadFile,
  setUploadFile,
  dragging,
  setDragging,
  fileInputRef,
  runtimeModel,
  runtimeLanguage,
  submitting,
  submitTask,
  inputClassName,
}: SourceTaskModalProps) {
  const sourceModeHintKey: `source.modeHint.${SourceMode}` = `source.modeHint.${sourceMode}`

  return (
    <ModalPanel
      open={open}
      title={t('source.modal.title')}
      description={t('source.modal.description')}
      onClose={onClose}
    >
      <div className="mb-3.5 grid grid-cols-3 gap-2.5">
        <Button size="sm" variant={sourceMode === 'url' ? 'default' : 'secondary'} onClick={() => setSourceMode('url')}>
          {t('source.mode.url')}
        </Button>
        <Button size="sm" variant={sourceMode === 'path' ? 'default' : 'secondary'} onClick={() => setSourceMode('path')}>
          {t('source.mode.path')}
        </Button>
        <Button size="sm" variant={sourceMode === 'upload' ? 'default' : 'secondary'} onClick={() => setSourceMode('upload')}>
          {t('source.mode.upload')}
        </Button>
      </div>

      <div className="mb-3 rounded-xl border border-accent/25 bg-accent/8 px-3 py-2">
        <PreText variant="timestamp" className="text-text-main">
          {t(sourceModeHintKey)}
        </PreText>
      </div>

      {sourceMode === 'url' && (
        <input
          className={cn(inputClassName, 'mb-3')}
          value={urlInput}
          onChange={(event) => setUrlInput(event.target.value)}
          placeholder={t('source.placeholders.url')}
        />
      )}

      {sourceMode === 'path' && (
        <input
          className={cn(inputClassName, 'mb-3')}
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          placeholder={t('source.placeholders.path')}
        />
      )}

      {sourceMode === 'upload' && (
        <div
          className={cn(
            'mb-3 rounded-xl border border-dashed p-3.5 text-center transition-all duration-200',
            dragging ? 'border-accent bg-accent/10' : 'border-border bg-surface-muted',
          )}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files[0]
            if (file) setUploadFile(file)
          }}
        >
          <PreText variant="timestamp" className="text-text-main">
            {t('source.upload.drop')}
          </PreText>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => fileInputRef.current?.click()}>
            {t('source.upload.chooseFile')}
          </Button>
          {uploadFile && (
            <PreText variant="timestamp" className="mt-1 text-text-main">
              {t('source.upload.selected', { name: uploadFile.name })}
            </PreText>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mkv,.mov,.webm,.flv,.avi,.m4v"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) setUploadFile(file)
            }}
          />
        </div>
      )}

      <div className="mb-3 rounded-xl border border-border bg-surface-muted/85 px-3 py-2.5">
        <PreText variant="h3" className="mb-1">
          {t('source.runtimeDefaultsTitle')}
        </PreText>
        <PreText variant="timestamp">{t('source.runtimeDefaults', { model: runtimeModel, language: runtimeLanguage })}</PreText>
      </div>

      <Button className="w-full" onClick={() => void submitTask()} disabled={submitting}>
        {submitting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />}
        {t('source.start')}
      </Button>
    </ModalPanel>
  )
}

interface DeleteTaskConfirmModalProps {
  open: boolean
  onClose: () => void
  t: TFunction
  pendingDeleteTask: TaskSummaryItem | null
  historyActionBusyTaskId: string | null
  removeHistoryTask: () => Promise<void>
}

export function DeleteTaskConfirmModal({
  open,
  onClose,
  t,
  pendingDeleteTask,
  historyActionBusyTaskId,
  removeHistoryTask,
}: DeleteTaskConfirmModalProps) {
  return (
    <ModalPanel
      open={open}
      title={t('history.actions.deleteModalTitle')}
      description={t('history.actions.deleteModalDescription')}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-red-400/45 bg-red-500/10 px-3 py-3 text-sm text-text-main">
          <div className="mb-1 flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-semibold">{t('history.actions.deleteDangerTitle')}</span>
          </div>
          <PreText variant="timestamp" className="text-text-main">
            {t('history.actions.deleteConfirm', {
              title: pendingDeleteTask?.title ?? pendingDeleteTask?.source_input ?? '',
            })}
          </PreText>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={historyActionBusyTaskId === pendingDeleteTask?.id}
          >
            {t('history.actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            className="bg-red-500 text-white hover:brightness-95"
            onClick={() => void removeHistoryTask()}
            disabled={historyActionBusyTaskId === pendingDeleteTask?.id}
          >
            {historyActionBusyTaskId === pendingDeleteTask?.id ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            {t('history.actions.delete')}
          </Button>
        </div>
      </div>
    </ModalPanel>
  )
}

interface PromptTemplateDeleteModalProps {
  open: boolean
  onClose: () => void
  t: TFunction
  pendingPromptDelete: { channel: PromptTemplateChannel; templateId: string; name: string } | null
  promptActionChannel: PromptTemplateChannel | null
  removePromptTemplate: () => Promise<void>
}

export function PromptTemplateDeleteModal({
  open,
  onClose,
  t,
  pendingPromptDelete,
  promptActionChannel,
  removePromptTemplate,
}: PromptTemplateDeleteModalProps) {
  return (
    <ModalPanel
      open={open}
      title={t('llm.promptTemplates.deleteModalTitle')}
      description={t('llm.promptTemplates.deleteModalDescription')}
      onClose={onClose}
      zIndexClassName="z-[80]"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-red-400/45 bg-red-500/10 px-3 py-3 text-sm text-text-main">
          <div className="mb-1 flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-semibold">{t('llm.promptTemplates.deleteDangerTitle')}</span>
          </div>
          <PreText variant="timestamp" className="text-text-main">
            {t('llm.promptTemplates.deleteConfirm', { name: pendingPromptDelete?.name ?? '' })}
          </PreText>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={Boolean(pendingPromptDelete && promptActionChannel === pendingPromptDelete.channel)}
          >
            {t('history.actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            className="bg-red-500 text-white hover:brightness-95"
            onClick={() => void removePromptTemplate()}
            disabled={Boolean(pendingPromptDelete && promptActionChannel === pendingPromptDelete.channel)}
          >
            {pendingPromptDelete && promptActionChannel === pendingPromptDelete.channel ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            {t('llm.promptTemplates.deleteAction')}
          </Button>
        </div>
      </div>
    </ModalPanel>
  )
}
