import type { RefObject } from 'react'
import type { TFunction } from 'i18next'

import type { SidebarPanelKey, WhisperPresetKey } from './workbench-config'
import type {
  LLMConfig,
  StageKey,
  TaskDetail,
  TaskSummaryItem,
  TranscriptSegment,
  VmPhaseKey,
  VmPhaseMetric,
} from '../types'

interface BuildMainViewPropsOptions {
  t: TFunction
  isDark: boolean
  activeTask: TaskDetail | null
  activeTaskId: string | null
  activeTaskRuntimeStatusText: string
  overallProgress: number
  statusText: (status: string) => string
  isTaskCompleted: boolean
  error: string | null
  isTaskRunning: boolean
  runtimeNowMs: number
  isTaskTerminalStatus: (status: string) => boolean
  cancellingTask: boolean
  cancelActiveTask: () => Promise<void>
  rerunningStageD: boolean
  rerunActiveTaskStageD: () => Promise<void>
  vmPhaseMetrics: Record<VmPhaseKey, VmPhaseMetric>
  activeVmPhase: VmPhaseKey
  totalVmElapsedSeconds: number
  displayedStageElapsedSeconds: number
  activeStageLogCount: number
  activeStage: StageKey
  setActiveStage: (stage: StageKey) => void
  stageLogs: Record<StageKey, string[]>
  vmPhaseLogs: Record<VmPhaseKey, string[]>
  transcriptPanelRef: RefObject<HTMLDivElement | null>
  transcriptStream: string
  transcriptSegments: TranscriptSegment[]
  optimizedTranscriptStream: string
  optimizedTranscriptSegments: TranscriptSegment[]
  fusionPromptPreview: string
  canEditStageDMarkdown: boolean
  hasUnsavedArtifactEdits: boolean
  savingArtifacts: boolean
  persistEditedArtifacts: () => Promise<boolean>
  loadArtifactContent: (path: string) => Promise<string>
  notesPanelRef: RefObject<HTMLDivElement | null>
  notesStream: string
  handleNotesMarkdownChange: (value: string) => void
  mindmapMarkdownPanelRef: RefObject<HTMLTextAreaElement | null>
  mindmapStream: string
  handleMindmapMarkdownChange: (value: string) => void
  llmConfig: LLMConfig
  sourceMode: 'url' | 'path' | 'upload'
  setSourceMode: (mode: 'url' | 'path' | 'upload') => void
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
  fieldInputClassName: string
  searchText: string
  setSearchText: (value: string) => void
  loadHistory: (query?: string) => Promise<TaskSummaryItem[] | null>
  history: TaskSummaryItem[]
  editingHistoryTaskId: string | null
  editingHistoryTitle: string
  setEditingHistoryTitle: (value: string) => void
  historyActionBusyTaskId: string | null
  selectHistoryTask: (item: TaskSummaryItem) => void
  startEditHistoryTitle: (item: TaskSummaryItem) => void
  saveHistoryTitle: (taskId: string) => Promise<void>
  cancelEditHistoryTitle: () => void
  openDeleteConfirm: (item: TaskSummaryItem) => void
  resolveHistoryTaskStatusText: (item: TaskSummaryItem) => string
  closeDeleteConfirm: () => void
  pendingDeleteTask: TaskSummaryItem | null
  removeHistoryTask: () => Promise<void>
  closePromptDeleteConfirm: () => void
  pendingPromptDelete: object | null
  promptActionChannel: 'summary' | 'notes' | 'mindmap' | null
  removePromptTemplate: () => Promise<void>
  configModalProps: object
  selfCheckBusy: boolean
  selfFixBusy: boolean
  selfCheckSessionId: string | null
  selfCheckReport: object | null
  selfCheckError: string | null
  selfCheckLogs: string[]
  runSelfCheck: () => Promise<void>
  runSelfCheckAutoFix: () => Promise<void>
  activeSidebarPanel: SidebarPanelKey
  setActiveSidebarPanel: (panel: SidebarPanelKey) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void
  openConfigPanel: (tab?: 'localModels' | 'whisper' | 'prompts') => void
  openSelfCheckPanel: () => void
  whisperPreset: WhisperPresetKey
  bundleArchiveFormat: string
  downloadAllArtifacts: () => Promise<void>
}

export function buildWorkbenchMainViewProps(options: BuildMainViewPropsOptions) {
  const runtimeMainProps = {
    isDark: options.isDark,
    activeTask: options.activeTask,
    overallProgress: options.overallProgress,
    statusText: options.statusText,
    isTaskCompleted: Boolean(options.isTaskCompleted),
    error: options.error,
    isTaskRunning: options.isTaskRunning,
    runtimeNowMs: options.runtimeNowMs,
    canCancelTask: Boolean(options.activeTask && !options.isTaskTerminalStatus(options.activeTask.status)),
    cancellingTask: options.cancellingTask,
    onCancelTask: options.cancelActiveTask,
    canRerunStageD: Boolean(
      options.activeTask
      && !options.rerunningStageD
      && (options.activeTask.status === 'failed' || options.activeTask.status === 'cancelled')
      && Boolean((options.activeTask.transcript_text ?? '').trim() || options.activeTask.transcript_segments.length > 0),
    ),
    onRerunStageD: options.rerunActiveTaskStageD,
    rerunningStageD: options.rerunningStageD,
    vmPhaseMetrics: options.vmPhaseMetrics,
    activeVmPhase: options.activeVmPhase,
    totalVmElapsedSeconds: options.totalVmElapsedSeconds,
    displayedStageElapsedSeconds: options.displayedStageElapsedSeconds,
    activeStageLogCount: options.activeStageLogCount,
    activeStage: options.activeStage,
    setActiveStage: options.setActiveStage,
    stageLogs: options.stageLogs,
    vmPhaseLogs: options.vmPhaseLogs,
    transcriptPanelRef: options.transcriptPanelRef,
    transcriptStream: options.transcriptStream,
    transcriptSegments: options.transcriptSegments,
    transcriptCorrectionMode: options.llmConfig.correction_mode,
    optimizedTranscriptStream: options.optimizedTranscriptStream,
    optimizedTranscriptSegments: options.optimizedTranscriptSegments,
    fusionPromptPreview: options.fusionPromptPreview,
    canEditStageDMarkdown: options.canEditStageDMarkdown,
    hasUnsavedArtifactEdits: options.hasUnsavedArtifactEdits,
    savingArtifacts: options.savingArtifacts,
    onPersistEditedArtifacts: options.persistEditedArtifacts,
    onLoadArtifactContent: options.loadArtifactContent,
    notesPanelRef: options.notesPanelRef,
    notesStream: options.notesStream,
    onNotesMarkdownChange: options.handleNotesMarkdownChange,
    mindmapMarkdownPanelRef: options.mindmapMarkdownPanelRef,
    mindmapStream: options.mindmapStream,
    onMindmapMarkdownChange: options.handleMindmapMarkdownChange,
  }

  return {
    t: options.t,
    sidebarCollapsed: options.sidebarCollapsed,
    setSidebarCollapsed: options.setSidebarCollapsed,
    activeSidebarPanel: options.activeSidebarPanel,
    setActiveSidebarPanel: options.setActiveSidebarPanel,
    loadHistory: async () => {
      await options.loadHistory()
    },
    openConfigPanel: options.openConfigPanel,
    openSelfCheckPanel: options.openSelfCheckPanel,
    runtimeModel: options.runtimeModel,
    runtimeLanguage: options.runtimeLanguage,
    whisperPreset: options.whisperPreset,
    activeTask: options.activeTask,
    activeTaskStatusText: options.activeTaskRuntimeStatusText,
    runtimeMainProps,
    isTaskCompleted: Boolean(options.isTaskCompleted),
    savingArtifacts: options.savingArtifacts,
    bundleArchiveFormat: options.bundleArchiveFormat,
    onDownloadAllArtifacts: () => {
      void options.downloadAllArtifacts()
    },
    sourceTaskModalProps: {
      onClose: () => options.setActiveSidebarPanel(null),
      sourceMode: options.sourceMode,
      setSourceMode: options.setSourceMode,
      urlInput: options.urlInput,
      setUrlInput: options.setUrlInput,
      pathInput: options.pathInput,
      setPathInput: options.setPathInput,
      uploadFile: options.uploadFile,
      setUploadFile: options.setUploadFile,
      dragging: options.dragging,
      setDragging: options.setDragging,
      fileInputRef: options.fileInputRef,
      runtimeModel: options.runtimeModel,
      runtimeLanguage: options.runtimeLanguage,
      submitting: options.submitting,
      submitTask: options.submitTask,
      inputClassName: options.fieldInputClassName,
    },
    historyModalProps: {
      onClose: () => options.setActiveSidebarPanel(null),
      searchText: options.searchText,
      setSearchText: options.setSearchText,
      loadHistory: async () => {
        await options.loadHistory()
      },
      history: options.history,
      editingHistoryTaskId: options.editingHistoryTaskId,
      editingHistoryTitle: options.editingHistoryTitle,
      setEditingHistoryTitle: options.setEditingHistoryTitle,
      historyActionBusyTaskId: options.historyActionBusyTaskId,
      activeTaskId: options.activeTaskId,
      onSelectTask: options.selectHistoryTask,
      startEditHistoryTitle: options.startEditHistoryTitle,
      saveHistoryTitle: options.saveHistoryTitle,
      cancelEditHistoryTitle: options.cancelEditHistoryTitle,
      openDeleteConfirm: options.openDeleteConfirm,
      resolveTaskStatusText: options.resolveHistoryTaskStatusText,
      isTaskTerminalStatus: options.isTaskTerminalStatus,
      inputClassName: options.fieldInputClassName,
    },
    deleteTaskConfirmModalProps: {
      onClose: options.closeDeleteConfirm,
      pendingDeleteTask: options.pendingDeleteTask,
      historyActionBusyTaskId: options.historyActionBusyTaskId,
      removeHistoryTask: options.removeHistoryTask,
    },
    promptTemplateDeleteModalProps: {
      onClose: options.closePromptDeleteConfirm,
      pendingPromptDelete: options.pendingPromptDelete,
      promptActionChannel: options.promptActionChannel,
      removePromptTemplate: options.removePromptTemplate,
    },
    configModalProps: options.configModalProps,
    selfCheckModalProps: {
      onClose: () => options.setActiveSidebarPanel(null),
      selfCheckBusy: options.selfCheckBusy,
      selfFixBusy: options.selfFixBusy,
      selfCheckSessionId: options.selfCheckSessionId,
      selfCheckReport: options.selfCheckReport,
      selfCheckError: options.selfCheckError,
      selfCheckLogs: options.selfCheckLogs,
      runSelfCheck: options.runSelfCheck,
      runSelfCheckAutoFix: options.runSelfCheckAutoFix,
    },
  }
}

