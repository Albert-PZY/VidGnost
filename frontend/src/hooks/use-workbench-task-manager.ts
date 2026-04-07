import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import toast from 'react-hot-toast'

import {
  cancelTask,
  createTaskByFile,
  createTaskByPath,
  createTaskByUrl,
  deleteTask,
  exportTaskBundleUrl,
  listTasks,
  rerunTaskStageD,
  updateTaskArtifacts,
  updateTaskTitle,
  type BundleArchiveFormat,
} from '../lib/api'
import type { StageKey, TaskDetail, TaskSummaryItem } from '../types'

type TaskSourceMode = 'url' | 'path' | 'upload'

interface UseWorkbenchTaskManagerOptions {
  t: TFunction
  sourceMode: TaskSourceMode
  urlInput: string
  pathInput: string
  uploadFile: File | null
  runtimeModel: 'small'
  runtimeLanguage: string
  searchText: string
  editingHistoryTitle: string
  historyActionBusyTaskId: string | null
  pendingDeleteTask: TaskSummaryItem | null
  activeTaskId: string | null
  activeTask: TaskDetail | null
  activeStage: StageKey
  cancellingTask: boolean
  rerunningStageD: boolean
  hasUnsavedArtifactEdits: boolean
  summaryStream: string
  notesStream: string
  mindmapStream: string
  bundleArchiveFormat: BundleArchiveFormat
  isTaskTerminalStatus: (status: string) => boolean
  closeTaskEvents: () => void
  resetRuntimePanels: () => void
  refreshTaskDetail: (taskId: string) => Promise<void>
  appendLog: (stage: StageKey, message: string) => void
  closeSidebarPanel: () => void
  setHistory: Dispatch<SetStateAction<TaskSummaryItem[]>>
  setError: Dispatch<SetStateAction<string | null>>
  setEditingHistoryTaskId: Dispatch<SetStateAction<string | null>>
  setEditingHistoryTitle: Dispatch<SetStateAction<string>>
  setHistoryActionBusyTaskId: Dispatch<SetStateAction<string | null>>
  setPendingDeleteTask: Dispatch<SetStateAction<TaskSummaryItem | null>>
  setActiveTaskId: Dispatch<SetStateAction<string | null>>
  setActiveTask: Dispatch<SetStateAction<TaskDetail | null>>
  setCancellingTask: Dispatch<SetStateAction<boolean>>
  setRerunningStageD: Dispatch<SetStateAction<boolean>>
  setSubmitting: Dispatch<SetStateAction<boolean>>
  setSavingArtifacts: Dispatch<SetStateAction<boolean>>
  setNotesMarkdownDirty: Dispatch<SetStateAction<boolean>>
  setMindmapMarkdownDirty: Dispatch<SetStateAction<boolean>>
  setSummaryStream: Dispatch<SetStateAction<string>>
  setNotesStream: Dispatch<SetStateAction<string>>
  setMindmapStream: Dispatch<SetStateAction<string>>
}

export function useWorkbenchTaskManager({
  t,
  sourceMode,
  urlInput,
  pathInput,
  uploadFile,
  runtimeModel,
  runtimeLanguage,
  searchText,
  editingHistoryTitle,
  historyActionBusyTaskId,
  pendingDeleteTask,
  activeTaskId,
  activeTask,
  activeStage,
  cancellingTask,
  rerunningStageD,
  hasUnsavedArtifactEdits,
  summaryStream,
  notesStream,
  mindmapStream,
  bundleArchiveFormat,
  isTaskTerminalStatus,
  closeTaskEvents,
  resetRuntimePanels,
  refreshTaskDetail,
  appendLog,
  closeSidebarPanel,
  setHistory,
  setError,
  setEditingHistoryTaskId,
  setEditingHistoryTitle,
  setHistoryActionBusyTaskId,
  setPendingDeleteTask,
  setActiveTaskId,
  setActiveTask,
  setCancellingTask,
  setRerunningStageD,
  setSubmitting,
  setSavingArtifacts,
  setNotesMarkdownDirty,
  setMindmapMarkdownDirty,
  setSummaryStream,
  setNotesStream,
  setMindmapStream,
}: UseWorkbenchTaskManagerOptions) {
  const loadHistory = useCallback(
    async (query = searchText): Promise<TaskSummaryItem[] | null> => {
      try {
        const rows = await listTasks(query)
        setHistory(rows)
        return rows
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.loadHistoryFailed'))
        return null
      }
    },
    [searchText, setError, setHistory, t],
  )

  const startEditHistoryTitle = useCallback(
    (item: TaskSummaryItem) => {
      setEditingHistoryTaskId(item.id)
      setEditingHistoryTitle((item.title ?? item.source_input).trim())
    },
    [setEditingHistoryTaskId, setEditingHistoryTitle],
  )

  const cancelEditHistoryTitle = useCallback(() => {
    setEditingHistoryTaskId(null)
    setEditingHistoryTitle('')
  }, [setEditingHistoryTaskId, setEditingHistoryTitle])

  const saveHistoryTitle = useCallback(
    async (taskId: string) => {
      const nextTitle = editingHistoryTitle.trim()
      if (!nextTitle) {
        const message = t('errors.historyTitleRequired')
        setError(message)
        toast.error(message)
        return
      }
      setHistoryActionBusyTaskId(taskId)
      try {
        const updated = await updateTaskTitle(taskId, nextTitle)
        setHistory((prev) =>
          prev.map((item) => (item.id === taskId ? { ...item, ...updated } : item)),
        )
        if (activeTask?.id === taskId) {
          setActiveTask((prev) =>
            prev ? { ...prev, title: updated.title, updated_at: updated.updated_at } : prev,
          )
        }
        cancelEditHistoryTitle()
        toast.success(t('history.actions.updateSuccess'))
      } catch (err) {
        const message = err instanceof Error ? err.message : t('errors.updateHistoryTitleFailed')
        setError(message)
        toast.error(message)
      } finally {
        setHistoryActionBusyTaskId(null)
      }
    },
    [
      activeTask?.id,
      cancelEditHistoryTitle,
      editingHistoryTitle,
      setActiveTask,
      setError,
      setHistory,
      setHistoryActionBusyTaskId,
      t,
    ],
  )

  const openDeleteConfirm = useCallback(
    (item: TaskSummaryItem) => {
      if (!isTaskTerminalStatus(item.status)) return
      setPendingDeleteTask(item)
    },
    [isTaskTerminalStatus, setPendingDeleteTask],
  )

  const closeDeleteConfirm = useCallback(() => {
    if (pendingDeleteTask && historyActionBusyTaskId === pendingDeleteTask.id) return
    setPendingDeleteTask(null)
  }, [historyActionBusyTaskId, pendingDeleteTask, setPendingDeleteTask])

  const removeHistoryTask = useCallback(async () => {
    if (!pendingDeleteTask) return
    const taskId = pendingDeleteTask.id
    setHistoryActionBusyTaskId(taskId)
    try {
      await deleteTask(taskId)
      setHistory((prev) => prev.filter((item) => item.id !== taskId))
      if (activeTaskId === taskId) {
        closeTaskEvents()
        setActiveTaskId(null)
        setActiveTask(null)
        setCancellingTask(false)
        setError(null)
        resetRuntimePanels()
      }
      cancelEditHistoryTitle()
      setPendingDeleteTask(null)
      await loadHistory(searchText)
      toast.success(t('history.actions.deleteSuccess'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.deleteHistoryFailed')
      setError(message)
      toast.error(message)
    } finally {
      setHistoryActionBusyTaskId(null)
    }
  }, [
    activeTaskId,
    cancelEditHistoryTitle,
    closeTaskEvents,
    loadHistory,
    pendingDeleteTask,
    resetRuntimePanels,
    searchText,
    setActiveTask,
    setActiveTaskId,
    setCancellingTask,
    setError,
    setHistory,
    setHistoryActionBusyTaskId,
    setPendingDeleteTask,
    t,
  ])

  const cancelActiveTask = useCallback(async () => {
    if (!activeTask || isTaskTerminalStatus(activeTask.status) || cancellingTask) return
    setCancellingTask(true)
    setError(null)
    try {
      await cancelTask(activeTask.id)
      appendLog(activeStage, t('runtime.log.cancelRequested'))
      toast.success(t('runtime.cancel.requested'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.cancelTaskFailed')
      setError(message)
      toast.error(message)
      setCancellingTask(false)
    }
  }, [
    activeStage,
    activeTask,
    appendLog,
    cancellingTask,
    isTaskTerminalStatus,
    setCancellingTask,
    setError,
    t,
  ])

  const rerunActiveTaskStageD = useCallback(async () => {
    if (!activeTask) return
    if (!isTaskTerminalStatus(activeTask.status)) return
    if (rerunningStageD) return
    setSubmitting(true)
    setCancellingTask(false)
    setRerunningStageD(true)
    setError(null)
    resetRuntimePanels()
    try {
      await rerunTaskStageD(activeTask.id)
      appendLog('D', t('runtime.log.stageDRerunRequested'))
      await refreshTaskDetail(activeTask.id)
      await loadHistory()
      toast.success(t('runtime.stageD.rerunRequested'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('runtime.stageD.rerunFailed')
      setError(message)
      toast.error(message)
      setRerunningStageD(false)
    } finally {
      setSubmitting(false)
    }
  }, [
    activeTask,
    appendLog,
    isTaskTerminalStatus,
    loadHistory,
    refreshTaskDetail,
    resetRuntimePanels,
    setCancellingTask,
    setError,
    setRerunningStageD,
    setSubmitting,
    rerunningStageD,
    t,
  ])

  const submitTask = useCallback(async () => {
    setSubmitting(true)
    setCancellingTask(false)
    setError(null)
    resetRuntimePanels()
    try {
      let taskId = ''
      if (sourceMode === 'url') {
        if (!urlInput.trim()) throw new Error(t('errors.urlRequired'))
        const created = await createTaskByUrl({
          url: urlInput.trim(),
          model_size: runtimeModel,
          language: runtimeLanguage,
        })
        taskId = created.task_id
      } else if (sourceMode === 'path') {
        if (!pathInput.trim()) throw new Error(t('errors.pathRequired'))
        const created = await createTaskByPath({
          local_path: pathInput.trim(),
          model_size: runtimeModel,
          language: runtimeLanguage,
        })
        taskId = created.task_id
      } else {
        if (!uploadFile) throw new Error(t('errors.fileRequired'))
        const created = await createTaskByFile({
          file: uploadFile,
          model_size: runtimeModel,
          language: runtimeLanguage,
        })
        taskId = created.task_id
      }
      setActiveTaskId(taskId)
      await refreshTaskDetail(taskId)
      await loadHistory()
      closeSidebarPanel()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }, [
    closeSidebarPanel,
    loadHistory,
    pathInput,
    refreshTaskDetail,
    resetRuntimePanels,
    runtimeLanguage,
    runtimeModel,
    setActiveTaskId,
    setCancellingTask,
    setError,
    setSubmitting,
    sourceMode,
    t,
    uploadFile,
    urlInput,
  ])

  const persistEditedArtifacts = useCallback(async (): Promise<boolean> => {
    if (!activeTask || !hasUnsavedArtifactEdits) return true
    setSavingArtifacts(true)
    setError(null)
    try {
      const detail = await updateTaskArtifacts(activeTask.id, {
        notes_markdown: notesStream,
        mindmap_markdown: mindmapStream,
      })
      setActiveTask(detail)
      setSummaryStream(detail.summary_markdown ?? '')
      setNotesStream(detail.notes_markdown ?? '')
      setMindmapStream(detail.mindmap_markdown ?? '')
      setNotesMarkdownDirty(false)
      setMindmapMarkdownDirty(false)
      setHistory((prev) =>
        prev.map((item) =>
          item.id === detail.id ? { ...item, updated_at: detail.updated_at } : item,
        ),
      )
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.saveArtifactsFailed')
      setError(message)
      toast.error(message)
      return false
    } finally {
      setSavingArtifacts(false)
    }
  }, [
    activeTask,
    hasUnsavedArtifactEdits,
    mindmapStream,
    setActiveTask,
    setError,
    setHistory,
    setMindmapMarkdownDirty,
    setMindmapStream,
    setNotesMarkdownDirty,
    setSavingArtifacts,
    setSummaryStream,
    setNotesStream,
    summaryStream,
    notesStream,
    t,
  ])

  const downloadAllArtifacts = useCallback(async () => {
    if (!activeTask) return
    if (hasUnsavedArtifactEdits) {
      const saved = await persistEditedArtifacts()
      if (!saved) return
    }
    const anchor = document.createElement('a')
    anchor.href = exportTaskBundleUrl(activeTask.id, bundleArchiveFormat)
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [activeTask, bundleArchiveFormat, hasUnsavedArtifactEdits, persistEditedArtifacts])

  return {
    loadHistory,
    startEditHistoryTitle,
    cancelEditHistoryTitle,
    saveHistoryTitle,
    openDeleteConfirm,
    closeDeleteConfirm,
    removeHistoryTask,
    cancelActiveTask,
    rerunActiveTaskStageD,
    submitTask,
    persistEditedArtifacts,
    downloadAllArtifacts,
  }
}
