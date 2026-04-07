import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'react-hot-toast'
import '@uiw/react-md-editor/markdown-editor.css'
import '@uiw/react-markdown-preview/markdown.css'

import { WorkbenchHeader } from './components/workbench-header'
import { WorkbenchMainView } from './components/workbench-main-view'
import { QuickStartPanel } from './components/workbench-panels'
import {
  getLLMConfig,
  getTaskArtifactContent,
  getPromptTemplates,
  getTask,
  getWhisperConfig,
} from './lib/api'
import {
  DEFAULT_WHISPER_CONFIG,
  detectBundleArchiveFormat,
  detectWhisperPreset,
  FIELD_INPUT_CLASS_NAME,
  inferStageFromLogs,
  inferStageFromStatus,
  isTaskTerminalStatus,
  normalizeLocale,
  normalizeFusionPromptPreview,
  normalizeWhisperConfigForCpu,
  parseInteger,
  VM_PHASES,
  type MainViewMode,
  type SidebarPanelKey,
  type UILocale,
  type WhisperPresetKey,
  WHISPER_PRESET_CONFIGS,
  WHISPER_PRESET_KEYS,
  createEmptyVmPhaseMetrics,
} from './app/workbench-config'
import { buildWorkbenchMainViewProps } from './app/workbench-main-view-props'
import { useWorkbenchConfigManager } from './hooks/use-workbench-config-manager'
import { usePromptTemplateManager } from './hooks/use-prompt-template-manager'
import { useWorkbenchSelectOptions } from './hooks/use-workbench-select-options'
import { useSelfCheck } from './hooks/use-self-check'
import { useWorkbenchTaskEventHandler } from './hooks/use-workbench-task-event-handler'
import { useWorkbenchTaskManager } from './hooks/use-workbench-task-manager'
import { useTaskEvents } from './hooks/use-task-events'
import { useWorkbenchUiEffects } from './hooks/use-workbench-ui-effects'
import { useQuickStartDoc } from './hooks/use-quick-start-doc'
import {
  createEmptyStageLogs,
  createEmptyStageTimers,
  deriveVmPhaseLogsFromStageLogs,
  useTaskStream,
} from './hooks/use-task-stream'
import type {
  LLMConfig,
  TaskDetail,
  TaskEvent,
  TaskSummaryItem,
  TranscriptSegment,
  VmPhaseKey,
  VmPhaseMetric,
  WhisperConfig,
} from './types'

const ACTIVE_TASK_STORAGE_KEY = 'vidgnost-active-task-id'
const D_SUBPHASE_ORDER: VmPhaseKey[] = [
  'transcript_optimize',
  'notes_extract',
  'notes_outline',
  'notes_sections',
  'notes_coverage',
  'summary_delivery',
  'mindmap_delivery',
]

function resolveRunningDSubphase(metrics: Record<VmPhaseKey, VmPhaseMetric>): VmPhaseKey {
  for (const phase of D_SUBPHASE_ORDER) {
    const status = metrics[phase]?.status ?? 'pending'
    if (status === 'running' || status === 'pending') {
      return phase
    }
  }
  return 'D'
}

function GitHubIcon(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8a8.01 8.01 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.11 0 0 .67-.21 2.2.82a7.66 7.66 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.91.08 2.11.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .22.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function App() {
  const { t, i18n } = useTranslation()

  const [mainView, setMainView] = useState<MainViewMode>('workbench')
  const [isDark, setIsDark] = useState<boolean>(
    () => localStorage.getItem('vidgnost-theme') === 'dark',
  )
  const [headerGlass, setHeaderGlass] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [menuPortalTarget, setMenuPortalTarget] = useState<HTMLElement | null>(null)
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<SidebarPanelKey>(null)
  const [sourceMode, setSourceMode] = useState<'url' | 'path' | 'upload'>('url')
  const [urlInput, setUrlInput] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [history, setHistory] = useState<TaskSummaryItem[]>([])
  const [searchText, setSearchText] = useState('')
  const [editingHistoryTaskId, setEditingHistoryTaskId] = useState<string | null>(null)
  const [editingHistoryTitle, setEditingHistoryTitle] = useState('')
  const [historyActionBusyTaskId, setHistoryActionBusyTaskId] = useState<string | null>(null)
  const [pendingDeleteTask, setPendingDeleteTask] = useState<TaskSummaryItem | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => {
    const cached = localStorage.getItem(ACTIVE_TASK_STORAGE_KEY)
    return cached && cached.trim() ? cached : null
  })
  const [activeTask, setActiveTask] = useState<TaskDetail | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cancellingTask, setCancellingTask] = useState(false)
  const [rerunningStageD, setRerunningStageD] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notesMarkdownDirty, setNotesMarkdownDirty] = useState(false)
  const [mindmapMarkdownDirty, setMindmapMarkdownDirty] = useState(false)
  const [savingArtifacts, setSavingArtifacts] = useState(false)
  const [llmConfig, setLLMConfig] = useState<LLMConfig>({
    mode: 'api',
    load_profile: 'balanced',
    api_key: '',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.5-flash',
    correction_mode: 'strict',
    correction_batch_size: 24,
    correction_overlap: 3,
  })
  const [whisperConfig, setWhisperConfig] = useState<WhisperConfig>({
    ...WHISPER_PRESET_CONFIGS.balanced,
  })
  const [whisperDraft, setWhisperDraft] = useState<WhisperConfig>({
    ...WHISPER_PRESET_CONFIGS.balanced,
  })
  const [savingWhisperConfig, setSavingWhisperConfig] = useState(false)
  const [savingLlmConfig, setSavingLlmConfig] = useState(false)
  const [activeVmPhase, setActiveVmPhase] = useState<VmPhaseKey>('A')
  const [vmPhaseMetrics, setVmPhaseMetrics] =
    useState<Record<VmPhaseKey, VmPhaseMetric>>(createEmptyVmPhaseMetrics)
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([])
  const [optimizedTranscriptStream, setOptimizedTranscriptStream] = useState('')
  const [optimizedTranscriptSegments, setOptimizedTranscriptSegments] = useState<
    TranscriptSegment[]
  >([])
  const [fusionPromptPreview, setFusionPromptPreview] = useState('')
  const [configTab, setConfigTab] = useState<'llm' | 'whisper' | 'prompts'>('llm')
  const [showApiKey, setShowApiKey] = useState(true)
  const currentLocale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN')
  const quickStartMarkdown = useQuickStartDoc({ mainView, locale: currentLocale })
  const {
    promptTemplateView,
    setPromptTemplateView,
    activePromptTemplates,
    activePromptDraft,
    selectedPromptTemplateId,
    promptDraftReadonly,
    copiedPromptTemplateId,
    promptActionChannel,
    pendingPromptDelete,
    applyPromptTemplateBundle,
    beginCreatePromptTemplate,
    selectTemplateDraft,
    copyPromptTemplateContent,
    requestDeletePromptTemplate,
    updatePromptDraft,
    resetPromptDraft,
    savePromptTemplate,
    switchPromptTemplate,
    closePromptDeleteConfirm,
    removePromptTemplate,
  } = usePromptTemplateManager({
    t,
    setError,
  })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const taskEventHandlerRef = useRef<(event: TaskEvent) => void>(() => {})
  const transcriptPanelRef = useRef<HTMLDivElement | null>(null)
  const notesPanelRef = useRef<HTMLDivElement | null>(null)
  const mindmapMarkdownPanelRef = useRef<HTMLTextAreaElement | null>(null)
  const dispatchTaskEvent = useCallback((event: TaskEvent) => {
    taskEventHandlerRef.current(event)
  }, [])
  const { closeTaskEvents } = useTaskEvents({
    activeTaskId,
    onEvent: dispatchTaskEvent,
  })

  const {
    selfCheckSessionId,
    selfCheckReport,
    selfCheckLogs,
    selfCheckBusy,
    selfFixBusy,
    selfCheckError,
    runSelfCheck,
    runSelfCheckAutoFix,
    attachSelfCheckSession,
  } = useSelfCheck({
    panelOpen: activeSidebarPanel === 'selfCheck',
    autoFixStartedText: t('selfCheck.logs.autoFixStarted'),
    autoFixCompletedText: t('selfCheck.logs.autoFixCompleted'),
  })
  const isTaskRunning = Boolean(activeTask && !isTaskTerminalStatus(activeTask.status))
  const {
    activeStage,
    setActiveStage,
    overallProgress,
    setOverallProgress,
    stageLogs,
    setStageLogs,
    vmPhaseLogs,
    setVmPhaseLogs,
    setStageTimers,
    setRuntimeNowMs,
    transcriptStream,
    setTranscriptStream,
    summaryStream,
    setSummaryStream,
    notesStream,
    setNotesStream,
    mindmapStream,
    setMindmapStream,
    appendLog,
    appendVmPhaseLog,
    appendTranscript,
    appendSummary,
    appendNotes,
    appendMindmap,
    flushBufferedStream,
    resetRuntimePanels,
  } = useTaskStream({
    isTaskRunning,
    onReset: () => {
      setNotesMarkdownDirty(false)
      setMindmapMarkdownDirty(false)
      setSavingArtifacts(false)
      setActiveVmPhase('A')
      setVmPhaseMetrics(createEmptyVmPhaseMetrics())
      setTranscriptSegments([])
      setOptimizedTranscriptStream('')
      setOptimizedTranscriptSegments([])
      setFusionPromptPreview('')
      setRerunningStageD(false)
    },
  })
  const appendTranscriptSegment = useCallback((segment: TranscriptSegment) => {
    if (!segment.text.trim()) return
    setTranscriptSegments((prev) => {
      const exists = prev.some(
        (item) =>
          Math.abs(item.start - segment.start) < 0.001 &&
          Math.abs(item.end - segment.end) < 0.001 &&
          item.text === segment.text,
      )
      if (exists) return prev
      return prev.concat(segment).sort((left, right) => left.start - right.start)
    })
  }, [])
  const appendTranscriptOptimized = useCallback(
    (
      text: string,
      reset = false,
      streamMode: 'realtime' | 'compat' = 'realtime',
      start?: number,
      end?: number,
    ) => {
      void streamMode
      if (reset) {
        setOptimizedTranscriptStream(text)
        setOptimizedTranscriptSegments([])
        return
      }
      if (!text) return
      if (typeof start === 'number' && typeof end === 'number') {
        const normalizedText = text.trim()
        if (normalizedText) {
          const segment: TranscriptSegment = {
            start: Math.max(0, start),
            end: Math.max(Math.max(0, start), end),
            text: normalizedText,
          }
          setOptimizedTranscriptSegments((prev) => {
            const next = prev.filter(
              (item) =>
                !(
                  Math.abs(item.start - segment.start) < 0.001 &&
                  Math.abs(item.end - segment.end) < 0.001
                ),
            )
            next.push(segment)
            next.sort((left, right) => left.start - right.start)
            return next
          })
        }
      }
      setOptimizedTranscriptStream((prev) => `${prev}${text}`)
    },
    [],
  )
  const resetStageDRealtime = useCallback(() => {
    setOptimizedTranscriptStream('')
    setOptimizedTranscriptSegments([])
    setFusionPromptPreview('')
  }, [])
  const whisperPreset = useMemo(() => detectWhisperPreset(whisperConfig), [whisperConfig])
  const whisperDraftPreset = useMemo(() => detectWhisperPreset(whisperDraft), [whisperDraft])
  const bundleArchiveFormat = useMemo(() => detectBundleArchiveFormat(), [])
  const runtimeModel = whisperConfig.model_default
  const runtimeLanguage = whisperConfig.language.trim() || DEFAULT_WHISPER_CONFIG.language
  const isTaskCompleted = activeTask?.status === 'completed'
  const canEditStageDMarkdown = Boolean(
    activeTask &&
    (activeTask.status === 'completed' ||
      activeTask.status === 'failed' ||
      activeTask.status === 'cancelled'),
  )
  const hasUnsavedArtifactEdits = notesMarkdownDirty || mindmapMarkdownDirty

  const {
    uiLocaleOptions,
    whisperModelOptions,
    whisperLanguageOptions,
    computeTypeOptions,
    targetSampleRateOptions,
    transcriptCorrectionModeOptions,
    llmModeOptions,
    loadProfileOptions,
    targetChannelOptions,
  } = useWorkbenchSelectOptions({
    t,
  })
  useWorkbenchUiEffects({
    isDark,
    mainView,
    activeSidebarPanel,
    setMenuPortalTarget,
    setHeaderGlass,
    setActiveSidebarPanel,
    transcriptPanelRef,
    notesPanelRef,
    mindmapMarkdownPanelRef,
    transcriptStream,
    notesStream,
    mindmapStream,
    canEditStageDMarkdown,
  })

  const selectHistoryTask = (item: TaskSummaryItem) => {
    setActiveTaskId(item.id)
    void refreshTaskDetail(item.id)
    setActiveStage(item.status === 'completed' ? 'D' : 'A')
    setActiveSidebarPanel(null)
  }

  const refreshTaskDetail = async (taskId: string) => {
    flushBufferedStream()
    const detail = await getTask(taskId)
    setActiveTask(detail)
    const inferredStage = isTaskTerminalStatus(detail.status)
      ? inferStageFromLogs(detail.stage_logs ?? null)
      : inferStageFromStatus(detail.status)
    setActiveStage(inferredStage)
    const nextTimers = createEmptyStageTimers()
    if (!isTaskTerminalStatus(detail.status)) {
      nextTimers[inferredStage] = Date.now()
      setRuntimeNowMs(Date.now())
    }
    setStageTimers(nextTimers)
    if (isTaskTerminalStatus(detail.status)) {
      setCancellingTask(false)
      setRerunningStageD(false)
    }
    if (detail.progress > 0) setOverallProgress(detail.progress)
    setTranscriptStream(detail.transcript_text ?? '')
    setTranscriptSegments(detail.transcript_segments ?? [])
    setOptimizedTranscriptStream(detail.transcript_text ?? '')
    setOptimizedTranscriptSegments(detail.transcript_segments ?? [])
    setFusionPromptPreview(normalizeFusionPromptPreview(detail.fusion_prompt_markdown ?? ''))
    setSummaryStream(detail.summary_markdown ?? '')
    setNotesStream(detail.notes_markdown ?? '')
    setMindmapStream(detail.mindmap_markdown ?? '')
    setNotesMarkdownDirty(false)
    setMindmapMarkdownDirty(false)
    const nextVmMetrics = createEmptyVmPhaseMetrics()
    if (detail.vm_phase_metrics) {
      for (const phase of VM_PHASES) {
        const incoming = detail.vm_phase_metrics[phase]
        if (!incoming) continue
        nextVmMetrics[phase] = {
          ...nextVmMetrics[phase],
          ...incoming,
        }
      }
    }
    setVmPhaseMetrics(nextVmMetrics)
    const runningVmPhase =
      VM_PHASES.find((phase) => nextVmMetrics[phase]?.status === 'running') ?? null
    if (runningVmPhase) {
      if (detail.status === 'summarizing' && runningVmPhase === 'D') {
        setActiveVmPhase(resolveRunningDSubphase(nextVmMetrics))
      } else {
        setActiveVmPhase(runningVmPhase)
      }
    } else {
      const terminalVmPhase =
        [...VM_PHASES].reverse().find((phase) => {
          const status = nextVmMetrics[phase]?.status
          return status === 'completed' || status === 'skipped' || status === 'failed'
        }) ?? null
      if (terminalVmPhase) {
        setActiveVmPhase(terminalVmPhase)
      } else if (detail.status === 'summarizing') {
        setActiveVmPhase(resolveRunningDSubphase(nextVmMetrics))
      } else {
        setActiveVmPhase(inferredStage)
      }
    }
    if (detail.stage_logs) {
      const nextStageLogs = {
        A: detail.stage_logs.A ?? [],
        B: detail.stage_logs.B ?? [],
        C: detail.stage_logs.C ?? [],
        D: detail.stage_logs.D ?? [],
      }
      setStageLogs(nextStageLogs)
      setVmPhaseLogs(deriveVmPhaseLogsFromStageLogs(nextStageLogs))
    } else {
      setStageLogs(createEmptyStageLogs())
      setVmPhaseLogs(deriveVmPhaseLogsFromStageLogs(createEmptyStageLogs()))
    }
  }

  const updateActiveTaskRealtime = (
    patch: Partial<Pick<TaskDetail, 'status' | 'progress' | 'error_message'>>,
  ) => {
    setActiveTask((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...patch,
        updated_at: new Date().toISOString(),
      }
    })
  }

  const updateHistoryRealtime = (
    taskId: string,
    patch: Partial<Pick<TaskSummaryItem, 'status' | 'progress'>>,
  ) => {
    setHistory((prev) => prev.map((item) => (item.id === taskId ? { ...item, ...patch } : item)))
  }

  const loadArtifactContent = useCallback(
    async (path: string) => {
      if (!activeTaskId) {
        throw new Error(
          t('runtime.stageD.debugArtifactsNoTask', { defaultValue: '当前没有可读取的任务产物。' }),
        )
      }
      return getTaskArtifactContent(activeTaskId, path)
    },
    [activeTaskId, t],
  )

  const refreshRuntimeConfigCenterState = useCallback(async () => {
    const [config, whisper] = await Promise.all([getLLMConfig(), getWhisperConfig()])
    setLLMConfig(config)
    const normalizedWhisper = normalizeWhisperConfigForCpu(whisper)
    setWhisperConfig(normalizedWhisper)
    setWhisperDraft(normalizedWhisper)
  }, [normalizeWhisperConfigForCpu])

  useEffect(() => {
    if (activeTaskId) {
      localStorage.setItem(ACTIVE_TASK_STORAGE_KEY, activeTaskId)
      return
    }
    localStorage.removeItem(ACTIVE_TASK_STORAGE_KEY)
  }, [activeTaskId])

  const {
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
  } = useWorkbenchTaskManager({
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
    closeSidebarPanel: () => setActiveSidebarPanel(null),
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
  })

  useEffect(() => {
    void (async () => {
      const historyRows = await loadHistory('')
      if (!activeTaskId || historyRows === null) {
        return
      }
      const taskStillExists = historyRows.some((item) => item.id === activeTaskId)
      if (!taskStillExists) {
        setActiveTaskId(null)
        setActiveTask(null)
        setCancellingTask(false)
        resetRuntimePanels()
        return
      }
      try {
        await refreshTaskDetail(activeTaskId)
      } catch {
        setActiveTaskId(null)
        setActiveTask(null)
        setCancellingTask(false)
        resetRuntimePanels()
      }
    })()
    void (async () => {
      try {
        const promptTemplates = await getPromptTemplates()
        applyPromptTemplateBundle(promptTemplates)
        await refreshRuntimeConfigCenterState()
      } catch {
        // ignore first load failure
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyPromptTemplateBundle, refreshRuntimeConfigCenterState])

  const handleTaskEvent = useWorkbenchTaskEventHandler({
    t,
    activeTaskId,
    activeStage,
    flushBufferedStream,
    refreshTaskDetail,
    loadHistory: async () => {
      await loadHistory()
    },
    setActiveStage,
    setStageTimers,
    setActiveVmPhase,
    setVmPhaseMetrics,
    setRuntimeNowMs,
    setOverallProgress,
    setCancellingTask,
    setError,
    updateActiveTaskRealtime,
    updateHistoryRealtime,
    appendLog,
    appendVmPhaseLog,
    appendTranscript,
    appendTranscriptSegment,
    appendTranscriptOptimized,
    appendSummary,
    appendMindmap,
    appendNotes,
    setFusionPromptPreview,
    setRerunningStageD,
    resetStageDRealtime,
    flushOptimizedTranscript: () => undefined,
  })
  taskEventHandlerRef.current = handleTaskEvent

  const { saveWhisperRuntimeConfig, saveLlmConfig } = useWorkbenchConfigManager({
    t,
    llmConfig,
    whisperDraft,
    setLLMConfig,
    setWhisperConfig,
    setWhisperDraft,
    setSavingWhisperConfig,
    setSavingLlmConfig,
    setError,
    normalizeWhisperConfigForCpu,
    appendLog,
  })

  const applyWhisperPreset = (preset: WhisperPresetKey) => {
    setWhisperDraft({ ...WHISPER_PRESET_CONFIGS[preset] })
  }

  const switchLocale = async (locale: UILocale) => {
    if (locale === currentLocale) return
    await i18n.changeLanguage(locale)
  }

  const openConfigPanel = (tab: 'llm' | 'whisper' | 'prompts' = 'llm') => {
    setConfigTab(tab)
    setActiveSidebarPanel('config')
    void (async () => {
      try {
        await refreshRuntimeConfigCenterState()
      } catch {
        // ignore config refresh failure and keep last-known local state
      }
    })()
  }

  const closeConfigPanel = () => {
    setWhisperDraft({ ...whisperConfig })
    setShowApiKey(true)
    setActiveSidebarPanel(null)
  }

  const openSelfCheckPanel = () => {
    setActiveSidebarPanel('selfCheck')
    if (!selfCheckSessionId) {
      void runSelfCheck()
      return
    }
    void attachSelfCheckSession(selfCheckSessionId)
  }

  const handleNotesMarkdownChange = (value: string) => {
    if (!canEditStageDMarkdown) return
    setNotesStream(value)
    setNotesMarkdownDirty(true)
  }

  const handleMindmapMarkdownChange = (value: string) => {
    if (!canEditStageDMarkdown) return
    setMindmapStream(value)
    setMindmapMarkdownDirty(true)
  }

  const statusText = useCallback(
    (status: string) => t(`status.${status}`, { defaultValue: status }),
    [t],
  )
  const activeTaskRuntimeStatusText = useMemo(() => {
    if (!activeTask) return ''
    if (activeTask.status === 'transcribing') {
      return t('stages.C.label')
    }
    if (activeTask.status === 'summarizing') {
      const phase = activeVmPhase === 'D' ? resolveRunningDSubphase(vmPhaseMetrics) : activeVmPhase
      const phaseStatus = vmPhaseMetrics[phase]?.status ?? 'pending'
      if (phaseStatus === 'skipped') {
        return `${t(`stages.${phase}.label`)} · ${t('runtime.phase.skipped', { defaultValue: '已跳过' })}`
      }
      return t(`stages.${phase}.label`)
    }
    return statusText(activeTask.status)
  }, [activeTask, activeVmPhase, statusText, t, vmPhaseMetrics])
  const resolveHistoryTaskStatusText = useCallback(
    (item: TaskSummaryItem) => {
      if (activeTaskId && item.id === activeTaskId && activeTask) {
        return activeTaskRuntimeStatusText
      }
      return statusText(item.status)
    },
    [activeTask, activeTaskId, activeTaskRuntimeStatusText, statusText],
  )
  const configModalProps = {
    onClose: closeConfigPanel,
    configTab,
    setConfigTab,
    promptTemplatesTabProps: {
      t,
      isDark,
      fieldInputClassName: FIELD_INPUT_CLASS_NAME,
      promptTemplateView,
      setPromptTemplateView,
      activePromptTemplates,
      activePromptDraft,
      selectedPromptTemplateId,
      promptDraftReadonly,
      copiedPromptTemplateId,
      promptActionChannel,
      beginCreatePromptTemplate,
      selectTemplateDraft,
      copyPromptTemplateContent,
      requestDeletePromptTemplate,
      updatePromptDraft,
      resetPromptDraft,
      savePromptTemplate,
      switchPromptTemplate,
    },
    whisperConfigTabProps: {
      t,
      fieldInputClassName: FIELD_INPUT_CLASS_NAME,
      menuPortalTarget,
      whisperDraftPreset,
      whisperPresetKeys: WHISPER_PRESET_KEYS,
      applyWhisperPreset,
      whisperDraft,
      setWhisperDraft,
      llmConfig,
      setLLMConfig,
      whisperModelOptions,
      whisperLanguageOptions,
      computeTypeOptions,
      loadProfileOptions,
      targetSampleRateOptions,
      transcriptCorrectionModeOptions,
      targetChannelOptions,
      defaultChunkSeconds: DEFAULT_WHISPER_CONFIG.chunk_seconds,
      parseInteger,
      savingWhisperConfig,
      saveWhisperRuntimeConfig,
    },
    llmConfigTabProps: {
      t,
      fieldInputClassName: FIELD_INPUT_CLASS_NAME,
      menuPortalTarget,
      llmConfig,
      setLLMConfig,
      llmModeOptions,
      loadProfileOptions,
      showApiKey,
      setShowApiKey,
      savingLlmConfig,
      saveLlmConfig,
    },
  }
  const mainViewProps = buildWorkbenchMainViewProps({
    t,
    isDark,
    activeTask,
    activeTaskId,
    activeTaskRuntimeStatusText,
    overallProgress,
    statusText,
    isTaskCompleted: Boolean(isTaskCompleted),
    error,
    isTaskRunning,
    isTaskTerminalStatus,
    cancellingTask,
    cancelActiveTask,
    rerunningStageD,
    rerunActiveTaskStageD,
    vmPhaseMetrics,
    activeVmPhase,
    activeStage,
    setActiveStage,
    stageLogs,
    vmPhaseLogs,
    transcriptPanelRef,
    transcriptStream,
    transcriptSegments,
    optimizedTranscriptStream,
    optimizedTranscriptSegments,
    fusionPromptPreview,
    canEditStageDMarkdown,
    hasUnsavedArtifactEdits,
    savingArtifacts,
    persistEditedArtifacts,
    loadArtifactContent,
    notesPanelRef,
    notesStream,
    handleNotesMarkdownChange,
    mindmapMarkdownPanelRef,
    mindmapStream,
    handleMindmapMarkdownChange,
    llmConfig,
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
    fieldInputClassName: FIELD_INPUT_CLASS_NAME,
    searchText,
    setSearchText,
    loadHistory,
    history,
    editingHistoryTaskId,
    editingHistoryTitle,
    setEditingHistoryTitle,
    historyActionBusyTaskId,
    selectHistoryTask,
    startEditHistoryTitle,
    saveHistoryTitle,
    cancelEditHistoryTitle,
    openDeleteConfirm,
    resolveHistoryTaskStatusText,
    closeDeleteConfirm,
    pendingDeleteTask,
    removeHistoryTask,
    closePromptDeleteConfirm,
    pendingPromptDelete,
    promptActionChannel,
    removePromptTemplate,
    configModalProps,
    selfCheckBusy,
    selfFixBusy,
    selfCheckSessionId,
    selfCheckReport,
    selfCheckError,
    selfCheckLogs,
    runSelfCheck,
    runSelfCheckAutoFix,
    activeSidebarPanel,
    setActiveSidebarPanel,
    sidebarCollapsed,
    setSidebarCollapsed,
    openConfigPanel,
    openSelfCheckPanel,
    whisperPreset,
    bundleArchiveFormat,
    downloadAllArtifacts,
  })

  return (
    <div className="workbench-shell relative min-h-screen w-full min-w-[980px] bg-bg-base text-text-main">
      <Toaster
        position="top-center"
        gutter={10}
        toastOptions={{
          duration: 2600,
          className: 'vidgnost-toast',
          style: {
            background: 'var(--color-surface-elevated)',
            color: 'var(--color-text-main)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.9rem',
            boxShadow: '0 14px 34px rgba(15, 23, 42, 0.18)',
            backdropFilter: 'blur(10px)',
            padding: '0.65rem 0.75rem',
          },
          success: {
            iconTheme: {
              primary: 'var(--color-accent)',
              secondary: 'var(--color-bg-base)',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: 'var(--color-bg-base)',
            },
          },
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-45" />
      <div>
        <WorkbenchHeader
          t={t}
          headerGlass={headerGlass}
          mainView={mainView}
          onToggleMainView={() =>
            setMainView((prev) => (prev === 'quickstart' ? 'workbench' : 'quickstart'))
          }
          currentLocale={currentLocale}
          uiLocaleOptions={uiLocaleOptions}
          onSwitchLocale={switchLocale}
          menuPortalTarget={menuPortalTarget}
          isDark={isDark}
          setIsDark={setIsDark}
          githubIcon={GitHubIcon}
        />

        {mainView === 'workbench' ? (
          <WorkbenchMainView {...mainViewProps} />
        ) : quickStartMarkdown ? (
          <QuickStartPanel markdown={quickStartMarkdown} />
        ) : (
          <div className="mx-auto max-w-[1180px] px-4 py-8 text-sm text-text-subtle">
            {t('quickStart.entry')}...
          </div>
        )}
      </div>
    </div>
  )
}

export default App
