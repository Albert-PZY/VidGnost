"use client"

import * as React from "react"
import { toast } from "react-hot-toast"

import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { NewTaskView } from "@/components/views/new-task-view"
import {
  getApiErrorMessage,
  getRecentTasks,
  getTaskStats,
  getUiSettings,
  updateUiSettings,
  uploadTaskFiles,
} from "@/lib/api"
import type {
  TaskDetailResponse,
  TaskRecentItem,
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
}

const TaskProcessingView = React.lazy(async () => {
  const module = await import("@/components/views/task-processing-view")
  return { default: module.TaskProcessingView }
})

const HistoryView = React.lazy(async () => {
  const module = await import("@/components/views/history-view")
  return { default: module.HistoryView }
})

const SettingsView = React.lazy(async () => {
  const module = await import("@/components/views/settings-view")
  return { default: module.SettingsView }
})

const DiagnosticsView = React.lazy(async () => {
  const module = await import("@/components/views/diagnostics-view")
  return { default: module.DiagnosticsView }
})

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

function ViewLoadingFallback() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="rounded-lg border border-border/70 bg-card/80 px-4 py-3 text-sm text-muted-foreground shadow-sm">
        正在加载界面...
      </div>
    </div>
  )
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
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = React.useState(false)
  const uiSettingsRef = React.useRef(uiSettings)

  React.useEffect(() => {
    uiSettingsRef.current = uiSettings
  }, [uiSettings])

  const refreshOverview = React.useCallback(async () => {
    const [statsResponse, recentResponse] = await Promise.all([getTaskStats(), getRecentTasks(3)])
    setTaskStats(statsResponse)
    setRecentTasks(recentResponse.items)
  }, [])

  React.useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      try {
        const [statsResponse, recentResponse, uiResponse] = await Promise.all([
          getTaskStats(),
          getRecentTasks(3),
          getUiSettings(),
        ])
        if (!mounted) {
          return
        }
        setTaskStats(statsResponse)
        setRecentTasks(recentResponse.items)
        setUiSettings(uiResponse)
      } catch (error) {
        if (!mounted) {
          return
        }
        toast.error(getApiErrorMessage(error, "初始化应用数据失败"))
      }
    }

    void bootstrap()

    return () => {
      mounted = false
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.lang = uiSettings.language
    document.documentElement.style.fontSize = `${uiSettings.font_size}px`
    document.documentElement.style.setProperty("--theme-hue", String(uiSettings.theme_hue))

    return () => {
      document.documentElement.style.removeProperty("font-size")
      document.documentElement.style.removeProperty("--theme-hue")
    }
  }, [uiSettings.font_size, uiSettings.language, uiSettings.theme_hue])

  React.useEffect(() => {
    const unsubscribe = window.vidGnostDesktop?.onWindowCloseRequested?.(() => {
      setIsCloseConfirmOpen(true)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  React.useEffect(() => {
    const warmupViews = () => {
      void import("@/components/views/history-view")
      void import("@/components/views/settings-view")
      void import("@/components/views/diagnostics-view")
    }

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(warmupViews, { timeout: 1500 })
      return () => {
        window.cancelIdleCallback?.(idleId)
      }
    }

    const timer = window.setTimeout(warmupViews, 900)
    return () => {
      window.clearTimeout(timer)
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
      })
      setUiSettings(saved)
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
    async (input: {
      files: File[]
      workflow: WorkflowType
      onProgress: (progress: number) => void
    }) => {
      const { files, workflow, onProgress } = input
      const response = await uploadTaskFiles({ files, workflow, onProgress })
      const firstTask = response.tasks[0]
      if (!firstTask) {
        throw new Error("后端未返回任务信息。")
      }

      setSelectedWorkflow(firstTask.workflow)
      setViewState({
        type: "processing",
        taskId: firstTask.task_id,
        workflow: firstTask.workflow,
        taskTitle: files[0]?.name || firstTask.task_id,
      })
      await refreshOverview()
      toast.success(
        response.tasks.length > 1
          ? `已创建 ${response.tasks.length} 个任务，当前打开第一个任务。`
          : "任务已提交，正在进入处理页。",
      )
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
          language={uiSettings.language}
          onOpenSettings={() => handleNavChange("settings")}
          onRequestClose={() => setIsCloseConfirmOpen(true)}
          onLanguageChange={(language) => {
            void persistUiSettings({ language }).catch((error) => {
              toast.error(getApiErrorMessage(error, "更新语言设置失败"))
            })
          }}
        />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <React.Suspense fallback={<ViewLoadingFallback />}>
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
              />
            )}
            {viewState.type === "diagnostics" && <DiagnosticsView />}
          </React.Suspense>
        </main>
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
  )
}
