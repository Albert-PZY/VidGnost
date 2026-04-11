"use client"

import * as React from "react"
import {
  FileText,
  MessageSquareText,
  History,
  Settings,
  Activity,
  ChevronDown,
  Plus,
  FolderOpen,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import type { TaskRecentItem, WorkflowType } from "@/lib/types"

type NavigationItem = {
  id: string
  title: string
  icon: React.ElementType
  badge?: number
}

interface AppSidebarProps {
  activeNav: string
  onNavChange: (navId: string) => void
  selectedWorkflow: WorkflowType
  onWorkflowChange: (workflow: WorkflowType) => void
  historyCount: number
  recentTasks: TaskRecentItem[]
  onOpenRecentTask: (taskId: string, meta?: { title?: string; workflow?: WorkflowType }) => void
}

const baseMainNavItems: NavigationItem[] = [
  {
    id: "new-task",
    title: "新建任务",
    icon: Plus,
  },
  {
    id: "history",
    title: "历史记录",
    icon: History,
  },
]

const systemNavItems: NavigationItem[] = [
  {
    id: "settings",
    title: "设置中心",
    icon: Settings,
  },
  {
    id: "diagnostics",
    title: "系统自检",
    icon: Activity,
  },
]

const workflowOptions = [
  {
    id: "notes" as WorkflowType,
    title: "笔记整理",
    description: "视频转写 + 笔记生成 + 思维导图",
    icon: FileText,
  },
  {
    id: "vqa" as WorkflowType,
    title: "视频问答",
    description: "语义检索 + 关键帧分析 + 智能问答",
    icon: MessageSquareText,
  },
]

export function AppSidebar({
  activeNav,
  onNavChange,
  selectedWorkflow,
  onWorkflowChange,
  historyCount,
  recentTasks,
  onOpenRecentTask,
}: AppSidebarProps) {
  const selectedWorkflowData = workflowOptions.find((w) => w.id === selectedWorkflow)
  const mainNavItems = React.useMemo(
    () =>
      baseMainNavItems.map((item) =>
        item.id === "history" ? { ...item, badge: historyCount } : item,
      ),
    [historyCount],
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm">
            <img
              src="/icon.svg"
              alt="VidGnost Logo"
              width={36}
              height={36}
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">VidGnost</span>
            <span className="truncate text-xs text-muted-foreground">
              本地多模态视频分析
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {/* 工作流选择 */}
        <SidebarGroup>
          <SidebarGroupLabel>工作流模式</SidebarGroupLabel>
          <SidebarGroupContent>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="sidebar-workflow-trigger w-full justify-between overflow-hidden group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {selectedWorkflowData && (
                      <>
                        <selectedWorkflowData.icon className="h-4 w-4 shrink-0" />
                        <span className="truncate group-data-[collapsible=icon]:hidden">
                          {selectedWorkflowData.title}
                        </span>
                      </>
                    )}
                  </div>
                  <ChevronDown className="h-4 w-4 opacity-50 group-data-[collapsible=icon]:hidden" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="sidebar-workflow-menu w-64">
                {workflowOptions.map((workflow) => (
                  <DropdownMenuItem
                    key={workflow.id}
                    onClick={() => onWorkflowChange(workflow.id)}
                    className="sidebar-workflow-option flex flex-col items-start gap-1 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <workflow.icon className="h-4 w-4" />
                      <span className="font-medium">{workflow.title}</span>
                    </div>
                    <span className="text-xs text-muted-foreground pl-6">
                      {workflow.description}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* 主导航 */}
        <SidebarGroup>
          <SidebarGroupLabel>任务管理</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeNav === item.id}
                    onClick={() => onNavChange(item.id)}
                    tooltip={item.title}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.badge && (
                      <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium">
                        {item.badge}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* 快速访问 - 最近任务 */}
        <SidebarGroup>
          <SidebarGroupLabel>最近任务</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {recentTasks.length === 0 && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="暂无任务" disabled>
                    <FolderOpen className="h-4 w-4" />
                    <span className="truncate">暂无最近任务</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {recentTasks.map((task) => (
                <SidebarMenuItem key={task.id}>
                  <SidebarMenuButton
                    tooltip={task.title}
                    onClick={() =>
                      onOpenRecentTask(task.id, {
                        title: task.title,
                        workflow: task.workflow,
                      })
                    }
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemNavItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeNav === item.id}
                    onClick={() => onNavChange(item.id)}
                    tooltip={item.title}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarFooter>
    </Sidebar>
  )
}
