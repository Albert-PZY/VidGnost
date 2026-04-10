"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Search,
  Filter,
  FileText,
  MessageSquareText,
  Clock,
  MoreHorizontal,
  Play,
  Trash2,
  Download,
  FolderOpen,
  Calendar,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  deleteTask,
  downloadTaskArtifact,
  getApiErrorMessage,
  getTaskStats,
  listTasksWithQuery,
  openTaskLocation,
} from "@/lib/api"
import { formatBytes, formatDateTime, formatDurationSeconds } from "@/lib/format"
import type { TaskStatsResponse, TaskSummaryItem, WorkflowType } from "@/lib/types"

interface HistoryViewProps {
  onOpenTask: (taskId: string, meta?: { title?: string; workflow?: WorkflowType }) => void
}

type HistoryWorkflowFilter = WorkflowType | "all"

const EMPTY_STATS: TaskStatsResponse = {
  total: 0,
  notes: 0,
  vqa: 0,
  completed: 0,
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-status-success text-white">已完成</Badge>
    case "running":
      return <Badge variant="secondary" className="bg-status-processing text-white">处理中</Badge>
    case "queued":
      return <Badge variant="secondary">排队中</Badge>
    case "failed":
      return <Badge variant="destructive">失败</Badge>
    case "cancelled":
      return <Badge variant="outline">已取消</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function HistoryView({ onOpenTask }: HistoryViewProps) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const deferredSearchQuery = React.useDeferredValue(searchQuery)
  const [workflowFilter, setWorkflowFilter] = React.useState<HistoryWorkflowFilter>("all")
  const [sortBy, setSortBy] = React.useState<"date" | "name" | "size">("date")
  const [tasks, setTasks] = React.useState<TaskSummaryItem[]>([])
  const [stats, setStats] = React.useState<TaskStatsResponse>(EMPTY_STATS)
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyTaskId, setBusyTaskId] = React.useState<string>("")
  const [pendingDeleteTask, setPendingDeleteTask] = React.useState<TaskSummaryItem | null>(null)

  const loadHistory = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [listResponse, statsResponse] = await Promise.all([
        listTasksWithQuery({
          q: deferredSearchQuery || undefined,
          workflow: workflowFilter,
          sort_by: sortBy,
          limit: 100,
        }),
        getTaskStats(),
      ])
      setTasks(listResponse.items)
      setStats(statsResponse)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "获取历史任务失败"))
    } finally {
      setIsLoading(false)
    }
  }, [deferredSearchQuery, sortBy, workflowFilter])

  React.useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleDeleteTask = async () => {
    if (!pendingDeleteTask) {
      return
    }

    setBusyTaskId(pendingDeleteTask.id)
    try {
      await deleteTask(pendingDeleteTask.id)
      setPendingDeleteTask(null)
      toast.success("任务已删除")
      await loadHistory()
    } catch (error) {
      toast.error(getApiErrorMessage(error, "删除任务失败"))
    } finally {
      setBusyTaskId("")
    }
  }

  const handleExportTask = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      await downloadTaskArtifact(taskId, "bundle")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "导出结果失败"))
    } finally {
      setBusyTaskId("")
    }
  }

  const handleOpenLocation = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      const payload = await openTaskLocation(taskId)
      if (window.vidGnostDesktop?.openPath) {
        const result = await window.vidGnostDesktop.openPath(payload.path)
        if (!result.ok) {
          throw new Error(result.message || "打开目录失败")
        }
        toast.success("已打开任务目录")
      } else {
        await navigator.clipboard.writeText(payload.path)
        toast.success("当前不在 Electron 环境，目录路径已复制到剪贴板")
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "获取任务目录失败"))
    } finally {
      setBusyTaskId("")
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-5xl mx-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">历史记录</h1>
          <p className="text-muted-foreground">
            查看和管理所有分析任务
          </p>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <FolderOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-2xl font-semibold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">总任务数</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <div className="text-2xl font-semibold">{stats.notes}</div>
                  <div className="text-xs text-muted-foreground">笔记整理</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                  <MessageSquareText className="h-5 w-5 text-accent-foreground" />
                </div>
                <div>
                  <div className="text-2xl font-semibold">{stats.vqa}</div>
                  <div className="text-xs text-muted-foreground">视频问答</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-success/10">
                  <Clock className="h-5 w-5 text-status-success" />
                </div>
                <div>
                  <div className="text-2xl font-semibold">{stats.completed}</div>
                  <div className="text-xs text-muted-foreground">已完成</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 筛选和搜索 */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索视频名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={workflowFilter} onValueChange={(v) => setWorkflowFilter(v as WorkflowType)}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="工作流" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="notes">笔记整理</SelectItem>
              <SelectItem value="vqa">视频问答</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">按时间</SelectItem>
              <SelectItem value="name">按名称</SelectItem>
              <SelectItem value="size">按大小</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 任务列表 */}
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {tasks.length === 0 && !isLoading && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  暂无匹配的历史任务
                </div>
              )}
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors"
                >
                  {/* 图标 */}
                  <div className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    task.workflow === "notes" ? "bg-primary/10" : "bg-accent"
                  )}>
                    {task.workflow === "notes" ? (
                      <FileText className="h-5 w-5 text-primary" />
                    ) : (
                      <MessageSquareText className="h-5 w-5 text-accent-foreground" />
                    )}
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{task.title || task.source_input}</span>
                      {getStatusBadge(task.status)}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDateTime(task.created_at)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDurationSeconds(task.duration_seconds)}
                      </span>
                      <span>{formatBytes(task.file_size_bytes)}</span>
                    </div>
                  </div>

                  {/* 操作 */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onOpenTask(task.id, {
                          title: task.title || task.source_input,
                          workflow: task.workflow,
                        })
                      }
                      disabled={task.status !== "completed" && task.status !== "running" && task.status !== "queued"}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      查看
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busyTaskId === task.id}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void handleExportTask(task.id)} disabled={task.status !== "completed"}>
                          <Download className="h-4 w-4 mr-2" />
                          导出结果
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleOpenLocation(task.id)}>
                          <FolderOpen className="h-4 w-4 mr-2" />
                          打开文件位置
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          disabled={!["completed", "failed", "cancelled"].includes(task.status)}
                          onClick={() => setPendingDeleteTask(task)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <ConfirmDialog
          open={Boolean(pendingDeleteTask)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDeleteTask(null)
            }
          }}
          title="确认删除任务？"
          description={
            pendingDeleteTask
              ? `删除后将移除任务“${pendingDeleteTask.title || pendingDeleteTask.source_input}”及其分析产物。此操作无法恢复。`
              : "删除后无法恢复。"
          }
          confirmLabel="确认删除"
          confirmVariant="destructive"
          isPending={Boolean(busyTaskId)}
          onConfirm={() => {
            void handleDeleteTask()
          }}
        />
      </div>
    </div>
  )
}
