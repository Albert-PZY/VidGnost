"use client"

import * as React from "react"
import { toast } from "react-hot-toast"

import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppBackgroundLayer } from "@/components/app-background-layer"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { NewTaskView } from "@/components/views/new-task-view"
import { BootstrapStatusOverlay, type BootstrapStatus } from "@/components/views/bootstrap-status-overlay"
import { DiagnosticsView } from "@/components/views/diagnostics-view"
import { HistoryView } from "@/components/views/history-view"
import { SettingsView } from "@/components/views/settings-view"
import { TaskProcessingView } from "@/components/views/task-processing-view"
import {
  createTaskFromPath,
  createTaskFromUrl,
  getApiErrorMessage,
  getHealth,
  getRecentTasks,
  getRuntimePaths,
  getTaskStats,
  getUiSettings,
  updateUiSettings,
  uploadTaskFiles,
} from "@/lib/api"
import type {
  TaskDetailResponse,
  TaskRecentItem,
  RuntimePathsResponse,
  TaskStatsResponse,
  UISettingsResponse,
  WorkflowType,
} from "@/lib/types"

type NavigationId = "new-task" | "history" | "settings" | "diagnostics"
type ViewState =
  | { type: "new-task" }
  | { type: "processing"; taskId: string; workflow: WorkflowType; taskTitle: string }
  | { type: "history" }
  | { type: "settings" }
  | { type: "diagnostics" }

const DEFAULT_UI_SETTINGS: UISettingsResponse = {
  language: "zh",
  font_size: 14,
  auto_save: true,
  theme_hue: 220,
  background_image: null,
  background_image_opacity: 28,
  background_image_blur: 0,
  background_image_scale: 1,
  background_image_focus_x: 0.5,
  background_image_focus_y: 0.5,
  background_image_fill_mode: "cover",
}

const getPageTitle = (viewState: ViewState) => {
  switch (viewState.type) {
    case "new-task":
      return { title: "新建任务", subtitle: "导入视频开始分析" }
    case "processing":
      return { title: "任务处理", subtitle: viewState.taskTitle }
    case "history":
      return { title: "历史记录", subtitle: "查看所有分析任务" }
    case "settings":
      return { title: "设置中心", subtitle: "配置模型和应用" }
    case "diagnostics":
      return { title: "系统自检", subtitle: "检查运行状态" }
  }
}

export default function VideoMindApp() {
  const [activeNav, setActiveNav] = React.useState<NavigationId>("new-task")
  const [selectedWorkflow, setSelectedWorkflow] = React.useState<WorkflowType>("notes")
  const [viewState, setViewState] = React.useState<ViewState>({ type: "new-task" })
  const [taskStats, setTaskStats] = React.useState<TaskStatsResponse>({
    total: 0,
    notes: 0,
    vqa: 0,
    completed: 0,
  })
  const [recentTasks, setRecentTasks] = React.useState<TaskRecentItem[]>([])
  const [uiSettings, setUiSettings] = React.useState<UISettingsResponse>(DEFAULT_UI_SETTINGS)
  const [uiSettingsPreviewPatch, setUiSettingsPreviewPatch] = React.useState<Partial<UISettingsResponse> | null>(null)
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = React.useState(false)
  const [bootstrapStatus, setBootstrapStatus] = React.useState<BootstrapStatus>("initializing")
  const [bootstrapMessage, setBootstrapMessage] = React.useState("正在装载最近任务与界面配置。")
  const [runtimePaths, setRuntimePaths] = React.useState<RuntimePathsResponse | null>(null)
  const uiSettingsRef = React.useRef(uiSettings)
  const desktopBootstrapCompletedRef = React.useRef(false)
  const effectiveUiSettings = React.useMemo(
    () => ({
      ...uiSettings,
      ...(uiSettingsPreviewPatch || {}),
    }),
    [uiSettings, uiSettingsPreviewPatch],
  )

  React.useEffect(() => {
    uiSettingsRef.current = uiSettings
  }, [uiSettings])

  const reportDesktopBootstrapState = React.useCallback((state: DesktopBootstrapState) => {
    window.vidGnostDesktop?.reportBootstrapState?.(state)
  }, [])

  const completeDesktopBootstrap = React.useCallback((state?: DesktopBootstrapState) => {
    if (desktopBootstrapCompletedRef.current) {
      return
    }
    desktopBootstrapCompletedRef.current = true
    window.vidGnostDesktop?.completeBootstrap?.(state)
  }, [])

  const settleStartupFrame = React.useCallback(async () => {
    if (typeof window !== "undefined") {
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
    }

    if (typeof document !== "undefined" && "fonts" in document) {
      try {
        await document.fonts.ready
      } catch {
        // Font settling is best-effort; startup should not block forever on it.
      }
    }
  }, [])

  React.useEffect(() => {
    reportDesktopBootstrapState({
      progress: 46,
      title: "初始化引擎",
      message: "初始化本地机器学习组件",
      detail: "新建任务、历史记录、设置中心、诊断页和处理工作台都会在启动阶段一次性预热。",
    })
  }, [reportDesktopBootstrapState])

  const refreshOverview = React.useCallback(async () => {
    const [statsResponse, recentResponse] = await Promise.all([getTaskStats(), getRecentTasks(3)])
    setTaskStats(statsResponse)
    setRecentTasks(recentResponse.items)
  }, [])

  const runBootstrap = React.useCallback(
    async (showToastOnError = false) => {
      setBootstrapStatus((current) => (current === "ready" ? "connecting" : "initializing"))
      setBootstrapMessage("正在连接后端并同步任务、设置与运行时目录。")
      reportDesktopBootstrapState({
        progress: 68,
        title: "初始化引擎",
        message: "初始化本地机器学习组件",
        detail: "正在连接本地服务，并校验模型、运行状态与基础目录。",
      })

      try {
        await getHealth()
        setBootstrapStatus("connecting")
        setBootstrapMessage("后端已连接，正在同步任务、设置和运行时路径。")
        reportDesktopBootstrapState({
          progress: 86,
          title: "初始化引擎",
          message: "挂载应用程序 UI",
          detail: "最近任务、统计信息、UI 设置和运行时路径已完成同步。",
        })

        const [statsResponse, recentResponse, uiResponse, pathsResponse] = await Promise.all([
          getTaskStats(),
          getRecentTasks(3),
          getUiSettings(),
          getRuntimePaths(),
        ])

        setTaskStats(statsResponse)
        setRecentTasks(recentResponse.items)
        setUiSettings(uiResponse)
        setRuntimePaths(pathsResponse)
        await settleStartupFrame()
        setBootstrapStatus("ready")
        setBootstrapMessage("系统运行正常。")
        reportDesktopBootstrapState({
          progress: 92,
          title: "初始化引擎",
          message: "挂载应用程序 UI",
          detail: "主界面即将显示，你打开历史、设置和诊断页面时将不再经过懒加载占位。",
        })
        completeDesktopBootstrap({
          progress: 100,
          title: "系统准备就绪",
          message: "系统准备就绪",
          detail: "正在切换到主工作台界面。",
        })
      } catch (error) {
        const message = getApiErrorMessage(error, "后端当前不可用，请稍后重试。")
        setBootstrapStatus("degraded")
        setBootstrapMessage(message)
        await settleStartupFrame()
        reportDesktopBootstrapState({
          progress: 96,
          title: "初始化引擎",
          message: "挂载应用程序 UI",
          detail: "后端尚未就绪，你仍可进入主界面查看诊断信息并继续重试连接。",
        })
        completeDesktopBootstrap({
          progress: 100,
          title: "系统准备就绪",
          message: "系统准备就绪",
          detail: "主界面会继续打开，并保留诊断与重试入口。",
        })
        if (showToastOnError) {
          toast.error(message)
        }
      }
    },
    [completeDesktopBootstrap, reportDesktopBootstrapState, settleStartupFrame],
  )

  React.useEffect(() => {
    void runBootstrap(false)
  }, [runBootstrap])

  React.useEffect(() => {
    document.documentElement.lang = effectiveUiSettings.language
    document.documentElement.style.fontSize = `${effectiveUiSettings.font_size}px`
    document.documentElement.style.setProperty("--theme-hue", String(effectiveUiSettings.theme_hue))
    document.documentElement.style.setProperty(
      "--app-background-opacity",
      String(effectiveUiSettings.background_image_opacity),
    )
    document.documentElement.style.setProperty(
      "--app-background-blur",
      `${effectiveUiSettings.background_image_blur}px`,
    )
    document.body.dataset.appBackgroundActive = effectiveUiSettings.background_image ? "true" : "false"

    return () => {
      document.documentElement.style.removeProperty("font-size")
      document.documentElement.style.removeProperty("--theme-hue")
      document.documentElement.style.removeProperty("--app-background-opacity")
      document.documentElement.style.removeProperty("--app-background-blur")
      delete document.body.dataset.appBackgroundActive
    }
  }, [
    effectiveUiSettings.background_image,
    effectiveUiSettings.background_image_blur,
    effectiveUiSettings.background_image_opacity,
    effectiveUiSettings.font_size,
    effectiveUiSettings.language,
    effectiveUiSettings.theme_hue,
  ])

  React.useEffect(() => {
    const unsubscribe = window.vidGnostDesktop?.onWindowCloseRequested?.(() => {
      setIsCloseConfirmOpen(true)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  const persistUiSettings = React.useCallback(
    async (patch: Partial<UISettingsResponse>) => {
      const current = uiSettingsRef.current
      const saved = await updateUiSettings({
        language: patch.language ?? current.language,
        font_size: patch.font_size ?? current.font_size,
        auto_save: patch.auto_save ?? current.auto_save,
        theme_hue: patch.theme_hue ?? current.theme_hue,
        background_image:
          patch.background_image !== undefined ? patch.background_image : current.background_image,
        background_image_opacity:
          patch.background_image_opacity ?? current.background_image_opacity,
        background_image_blur:
          patch.background_image_blur ?? current.background_image_blur,
        background_image_scale:
          patch.background_image_scale ?? current.background_image_scale,
        background_image_focus_x:
          patch.background_image_focus_x ?? current.background_image_focus_x,
        background_image_focus_y:
          patch.background_image_focus_y ?? current.background_image_focus_y,
        background_image_fill_mode:
          patch.background_image_fill_mode ?? current.background_image_fill_mode,
      })
      setUiSettings(saved)
      setUiSettingsPreviewPatch(null)
      return saved
    },
    [],
  )

  const handleNavChange = (navId: string) => {
    setActiveNav(navId as NavigationId)
    switch (navId) {
      case "new-task":
        setViewState({ type: "new-task" })
        break
      case "history":
        setViewState({ type: "history" })
        break
      case "settings":
        setViewState({ type: "settings" })
        break
      case "diagnostics":
        setViewState({ type: "diagnostics" })
        break
    }
  }

  const handleStartTask = React.useCallback(
    async (
      input:
        | {
            source: "upload"
            files: File[]
            workflow: WorkflowType
            onProgress: (progress: number) => void
          }
        | {
            source: "url"
            url: string
            workflow: WorkflowType
          }
        | {
            source: "path"
            localPath: string
            workflow: WorkflowType
          },
    ) => {
      let firstTask:
        | {
            task_id: string
            workflow: WorkflowType
          }
        | undefined
      let displayTitle = ""

      if (input.source === "upload") {
        const response = await uploadTaskFiles({
          files: input.files,
          workflow: input.workflow,
          onProgress: input.onProgress,
        })
        firstTask = response.tasks[0]
        displayTitle = input.files[0]?.name || firstTask?.task_id || ""
        toast.success(
          response.tasks.length > 1
            ? `已创建 ${response.tasks.length} 个任务，当前打开第一个任务。`
            : "任务已提交，正在进入处理页。",
        )
      } else if (input.source === "url") {
        const response = await createTaskFromUrl({
          url: input.url,
          workflow: input.workflow,
        })
        firstTask = response
        displayTitle = input.url
        toast.success("已根据网络链接创建任务。")
      } else {
        const response = await createTaskFromPath({
          local_path: input.localPath,
          workflow: input.workflow,
        })
        firstTask = response
        displayTitle = input.localPath
        toast.success("已根据本地路径创建任务。")
      }

      if (!firstTask) {
        throw new Error("后端未返回任务信息。")
      }

      setSelectedWorkflow(firstTask.workflow)
      setViewState({
        type: "processing",
        taskId: firstTask.task_id,
        workflow: firstTask.workflow,
        taskTitle: displayTitle || firstTask.task_id,
      })
      await refreshOverview()
    },
    [refreshOverview],
  )

  const handleBackFromProcessing = () => {
    setViewState({ type: "new-task" })
    setActiveNav("new-task")
  }

  const handleOpenTask = React.useCallback(
    (taskId: string, meta?: { title?: string; workflow?: WorkflowType }) => {
      const workflow = meta?.workflow || "notes"
      setSelectedWorkflow(workflow)
      setActiveNav("history")
      setViewState({
        type: "processing",
        taskId,
        workflow,
        taskTitle: meta?.title || taskId,
      })
    },
    [],
  )

  const handleTaskLoaded = React.useCallback((task: TaskDetailResponse) => {
    setViewState((current) => {
      if (current.type !== "processing" || current.taskId !== task.id) {
        return current
      }
      return {
        type: "processing",
        taskId: task.id,
        workflow: task.workflow,
        taskTitle: task.title || task.source_input || task.id,
      }
    })
  }, [])

  const handleTaskChanged = React.useCallback(async () => {
    try {
      await refreshOverview()
    } catch (error) {
      toast.error(getApiErrorMessage(error, "刷新任务概览失败"))
    }
  }, [refreshOverview])

  const pageInfo = getPageTitle(viewState)

  return (
    <>
      <AppBackgroundLayer uiSettings={effectiveUiSettings} />
      <div className="relative z-10 h-svh">
        <SidebarProvider>
          <AppSidebar
            activeNav={activeNav}
            onNavChange={handleNavChange}
            selectedWorkflow={selectedWorkflow}
            onWorkflowChange={setSelectedWorkflow}
            historyCount={taskStats.total}
            recentTasks={recentTasks}
            onOpenRecentTask={handleOpenTask}
          />
          <SidebarInset className="h-svh overflow-hidden">
            <AppHeader
              title={pageInfo.title}
              subtitle={pageInfo.subtitle}
              language={effectiveUiSettings.language}
              onOpenSettings={() => handleNavChange("settings")}
              onRequestClose={() => setIsCloseConfirmOpen(true)}
              onLanguageChange={(language) => {
                void persistUiSettings({ language }).catch((error) => {
                  toast.error(getApiErrorMessage(error, "更新语言设置失败"))
                })
              }}
            />
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {viewState.type === "new-task" && (
                <NewTaskView
                  selectedWorkflow={selectedWorkflow}
                  onStartTask={handleStartTask}
                />
              )}
              {viewState.type === "processing" && (
                <TaskProcessingView
                  taskId={viewState.taskId}
                  workflow={viewState.workflow}
                  taskTitle={viewState.taskTitle}
                  onBack={handleBackFromProcessing}
                  onTaskChanged={handleTaskChanged}
                  onTaskLoaded={handleTaskLoaded}
                />
              )}
              {viewState.type === "history" && (
                <HistoryView onOpenTask={handleOpenTask} />
              )}
              {viewState.type === "settings" && (
                <SettingsView
                  uiSettings={uiSettings}
                  onUiSettingsChange={persistUiSettings}
                  onUiSettingsPreviewChange={setUiSettingsPreviewPatch}
                />
              )}
              {viewState.type === "diagnostics" && <DiagnosticsView />}
            </main>
            <BootstrapStatusOverlay
              status={bootstrapStatus}
              message={bootstrapMessage}
              canOpenLogs={Boolean(runtimePaths?.event_log_dir)}
              onRetry={() => {
                void runBootstrap(true)
              }}
              onOpenDiagnostics={() => handleNavChange("diagnostics")}
              onOpenLogs={() => {
                const targetPath = runtimePaths?.event_log_dir || runtimePaths?.trace_log_dir || ""
                if (!targetPath) {
                  toast.error("当前还没有可用的日志目录。")
                  return
                }
                if (window.vidGnostDesktop?.openPath) {
                  void window.vidGnostDesktop.openPath(targetPath).then((result) => {
                    if (!result.ok) {
                      toast.error(result.message || "打开日志目录失败")
                    }
                  })
                  return
                }
                void navigator.clipboard.writeText(targetPath).then(() => {
                  toast.success("当前不在 Electron 环境，日志目录已复制到剪贴板。")
                })
              }}
            />
            <ConfirmDialog
              open={isCloseConfirmOpen}
              onOpenChange={setIsCloseConfirmOpen}
              title="确认关闭应用？"
              description="关闭窗口后将结束当前桌面会话。请确认当前操作已经处理完成。"
              confirmLabel="关闭应用"
              confirmVariant="destructive"
              onConfirm={() => {
                if (window.vidGnostDesktop?.closeWindow) {
                  void window.vidGnostDesktop.closeWindow()
                  return
                }
                window.close()
              }}
            />
          </SidebarInset>
        </SidebarProvider>
      </div>
    </>
  )
}
