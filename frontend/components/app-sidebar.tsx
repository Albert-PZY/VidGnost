"use client"

import * as React from "react"
import {
  Video,
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

type NavigationItem = {
  id: string
  title: string
  icon: React.ElementType
  badge?: number
}

type WorkflowType = "notes" | "vqa"

interface AppSidebarProps {
  activeNav: string
  onNavChange: (navId: string) => void
  selectedWorkflow: WorkflowType
  onWorkflowChange: (workflow: WorkflowType) => void
}

const mainNavItems: NavigationItem[] = [
  {
    id: "new-task",
    title: "新建任务",
    icon: Plus,
  },
  {
    id: "history",
    title: "历史记录",
    icon: History,
    badge: 12,
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
}: AppSidebarProps) {
  const selectedWorkflowData = workflowOptions.find(
    (w) => w.id === selectedWorkflow
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Video className="h-5 w-5" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">VideoMind</span>
            <span className="text-xs text-muted-foreground">
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
                  className="w-full justify-between group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center"
                >
                  <div className="flex items-center gap-2">
                    {selectedWorkflowData && (
                      <>
                        <selectedWorkflowData.icon className="h-4 w-4 shrink-0" />
                        <span className="group-data-[collapsible=icon]:hidden">
                          {selectedWorkflowData.title}
                        </span>
                      </>
                    )}
                  </div>
                  <ChevronDown className="h-4 w-4 opacity-50 group-data-[collapsible=icon]:hidden" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {workflowOptions.map((workflow) => (
                  <DropdownMenuItem
                    key={workflow.id}
                    onClick={() => onWorkflowChange(workflow.id)}
                    className="flex flex-col items-start gap-1 p-3"
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
                    <span>{item.title}</span>
                    {item.badge && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium">
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
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="产品设计讲座">
                  <FolderOpen className="h-4 w-4" />
                  <span className="truncate">产品设计讲座.mp4</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="AI技术分享">
                  <FolderOpen className="h-4 w-4" />
                  <span className="truncate">AI技术分享会议.mp4</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="用户调研访谈">
                  <FolderOpen className="h-4 w-4" />
                  <span className="truncate">用户调研访谈记录.mp4</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
                    <span>{item.title}</span>
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
