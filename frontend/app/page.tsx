"use client"

import * as React from "react"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { NewTaskView } from "@/components/views/new-task-view"
import { TaskProcessingView } from "@/components/views/task-processing-view"
import { HistoryView } from "@/components/views/history-view"
import { SettingsView } from "@/components/views/settings-view"
import { DiagnosticsView } from "@/components/views/diagnostics-view"

type NavigationId = "new-task" | "history" | "settings" | "diagnostics"
type WorkflowType = "notes" | "vqa"
type ViewState = 
  | { type: "new-task" }
  | { type: "processing"; videoName: string; workflow: WorkflowType }
  | { type: "history" }
  | { type: "settings" }
  | { type: "diagnostics" }

const getPageTitle = (viewState: ViewState) => {
  switch (viewState.type) {
    case "new-task":
      return { title: "新建任务", subtitle: "导入视频开始分析" }
    case "processing":
      return { title: "任务处理", subtitle: viewState.videoName }
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

  const handleStartTask = (files: Array<{ id: string; name: string }>, workflow: WorkflowType) => {
    if (files.length > 0) {
      setViewState({
        type: "processing",
        videoName: files[0].name,
        workflow,
      })
    }
  }

  const handleBackFromProcessing = () => {
    setViewState({ type: "new-task" })
    setActiveNav("new-task")
  }

  const handleOpenTask = (taskId: string) => {
    // 模拟打开历史任务
    setViewState({
      type: "processing",
      videoName: "产品设计讲座.mp4",
      workflow: "notes",
    })
  }

  const pageInfo = getPageTitle(viewState)

  return (
    <SidebarProvider>
      <AppSidebar
        activeNav={activeNav}
        onNavChange={handleNavChange}
        selectedWorkflow={selectedWorkflow}
        onWorkflowChange={setSelectedWorkflow}
      />
      <SidebarInset>
        <AppHeader title={pageInfo.title} subtitle={pageInfo.subtitle} />
        <main className="flex-1 flex flex-col overflow-hidden">
          {viewState.type === "new-task" && (
            <NewTaskView
              selectedWorkflow={selectedWorkflow}
              onStartTask={handleStartTask}
            />
          )}
          {viewState.type === "processing" && (
            <TaskProcessingView
              workflow={viewState.workflow}
              videoName={viewState.videoName}
              onBack={handleBackFromProcessing}
            />
          )}
          {viewState.type === "history" && (
            <HistoryView onOpenTask={handleOpenTask} />
          )}
          {viewState.type === "settings" && <SettingsView />}
          {viewState.type === "diagnostics" && <DiagnosticsView />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
