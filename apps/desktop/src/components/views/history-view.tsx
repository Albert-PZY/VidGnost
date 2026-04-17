"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import {
  CheckCircle2,
  Search,
  Filter,
  FileText,
  MessageSquareText,
  Circle,
  Clock,
  MoreHorizontal,
  Play,
  Trash2,
  Download,
  FolderOpen,
  Calendar,
  X,
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
  onTasksChanged?: () => Promise<void> | void
}

type HistoryWorkflowFilter = WorkflowType | "all"
type HistoryStatusFilter = "all" | "queued" | "running" | "paused" | "completed" | "failed" | "cancelled"

const PAGE_SIZE = 24

const EMPTY_STATS: TaskStatsResponse = {
  total: 0,
  notes: 0,
  vqa: 0,
  completed: 0,
}

function isTaskDeletable(status: string) {
  return String(status || "").trim().length > 0
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
    case "paused":
      return <Badge variant="outline">已暂停</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export function HistoryView({ onOpenTask, onTasksChanged }: HistoryViewProps) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const deferredSearchQuery = React.useDeferredValue(searchQuery)
  const [workflowFilter, setWorkflowFilter] = React.useState<HistoryWorkflowFilter>("all")
  const [statusFilter, setStatusFilter] = React.useState<HistoryStatusFilter>("all")
  const [sortBy, setSortBy] = React.useState<"date" | "name" | "size">("date")
  const [page, setPage] = React.useState(1)
  const [tasks, setTasks] = React.useState<TaskSummaryItem[]>([])
  const [total, setTotal] = React.useState(0)
  const [stats, setStats] = React.useState<TaskStatsResponse>(EMPTY_STATS)
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyTaskId, setBusyTaskId] = React.useState<string>("")
  const [selectionMode, setSelectionMode] = React.useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = React.useState<string[]>([])
  const [pendingDeleteRequest, setPendingDeleteRequest] = React.useState<{
    ids: string[]
    description: string
  } | null>(null)

  const loadHistory = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [listResponse, statsResponse] = await Promise.all([
        listTasksWithQuery({
          q: deferredSearchQuery || undefined,
          workflow: workflowFilter,
          status: statusFilter === "all" ? undefined : statusFilter,
          sort_by: sortBy,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
        getTaskStats(),
      ])
      setTasks(listResponse.items)
      setTotal(listResponse.total)
      setStats(statsResponse)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "获取历史任务失败"))
    } finally {
      setIsLoading(false)
    }
  }, [deferredSearchQuery, page, sortBy, statusFilter, workflowFilter])

  React.useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  React.useEffect(() => {
    setPage(1)
  }, [deferredSearchQuery, sortBy, statusFilter, workflowFilter])

  React.useEffect(() => {
    const deletableIds = new Set(
      tasks.filter((task) => isTaskDeletable(task.status)).map((task) => task.id),
    )
    setSelectedTaskIds((current) => current.filter((taskId) => deletableIds.has(taskId)))
  }, [tasks])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const selectedTaskIdSet = React.useMemo(() => new Set(selectedTaskIds), [selectedTaskIds])
  const deletableTaskIdsOnPage = React.useMemo(
    () => tasks.filter((task) => isTaskDeletable(task.status)).map((task) => task.id),
    [tasks],
  )
  const hasDeletableTasksOnPage = deletableTaskIdsOnPage.length > 0
  const allDeletableTasksSelected =
    hasDeletableTasksOnPage &&
    deletableTaskIdsOnPage.every((taskId) => selectedTaskIdSet.has(taskId))
  const hasHistoryRecords = stats.total > 0

  const toggleSelectionMode = React.useCallback(() => {
    setSelectionMode((current) => {
      if (current) {
        setSelectedTaskIds([])
      }
      return !current
    })
  }, [])

  const clearSelection = React.useCallback(() => {
    setSelectionMode(false)
    setSelectedTaskIds([])
  }, [])

  const toggleTaskSelection = React.useCallback((taskId: string) => {
    setSelectedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    )
  }, [])

  const handleSelectAllVisible = React.useCallback(() => {
    setSelectedTaskIds(allDeletableTasksSelected ? [] : deletableTaskIdsOnPage)
  }, [allDeletableTasksSelected, deletableTaskIdsOnPage])

  const handleDeleteTask = async () => {
    if (!pendingDeleteRequest || pendingDeleteRequest.ids.length === 0) {
      return
    }

    const taskIds = pendingDeleteRequest.ids
    const deletedTaskIds = new Set<string>()
    let failureCount = 0
    let firstErrorMessage = ""

    setBusyTaskId(taskIds.length === 1 ? taskIds[0] : "__history-batch-delete__")
    try {
      for (const taskId of taskIds) {
        try {
          await deleteTask(taskId)
          deletedTaskIds.add(taskId)
        } catch (error) {
          failureCount += 1
          if (!firstErrorMessage) {
            firstErrorMessage = getApiErrorMessage(error, "删除任务失败")
          }
        }
      }

      setPendingDeleteRequest(null)
      setSelectedTaskIds((current) => current.filter((taskId) => !deletedTaskIds.has(taskId)))

      if (deletedTaskIds.size > 0) {
        toast.success(deletedTaskIds.size === 1 ? "任务已删除" : `已删除 ${deletedTaskIds.size} 个任务`)
        await loadHistory()
        await onTasksChanged?.()
      }

      if (failureCount > 0) {
        toast.error(
          deletedTaskIds.size > 0
            ? `有 ${failureCount} 个任务删除失败，请稍后重试`
            : firstErrorMessage || "删除任务失败",
        )
      }
    } finally {
      setBusyTaskId("")
    }
  }

  const handleExportTask = async (taskId: string) => {
    setBusyTaskId(taskId)
    try {
      await downloadTaskArtifact(taskId, "bundle")
      toast.success("结果包导出完成，文件已开始下载")
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

  const requestSingleDelete = React.useCallback((task: TaskSummaryItem) => {
    setPendingDeleteRequest({
      ids: [task.id],
      description: `删除后将移除任务“${task.title || task.source_input}”及其临时文件、分析产物、问答索引与日志。此操作无法恢复。`,
    })
  }, [])

  const requestBatchDelete = React.useCallback(() => {
    if (selectedTaskIds.length === 0) {
      return
    }
    setPendingDeleteRequest({
      ids: selectedTaskIds,
      description: `删除后将移除所选 ${selectedTaskIds.length} 个任务及其临时文件、分析产物、问答索引与日志。此操作无法恢复。`,
    })
  }, [selectedTaskIds])

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  return (
    <div className="flex-1 overflow-auto">
      <div className="container mx-auto max-w-5xl space-y-5 p-6">
        {/* 页面标题 */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">历史记录</h1>
          <p className="text-muted-foreground">
            查看和管理所有分析任务
          </p>
        </div>

        {/* 统计卡片 */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/60 bg-card/80 shadow-none">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-3">
                <div className="history-stat-icon-shell flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                  <FolderOpen className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-xl font-semibold leading-none">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">总任务数</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-none">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-3">
                <div className="history-stat-icon-shell flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                  <FileText className="h-4.5 w-4.5 text-primary" />
                </div>
                <div>
                  <div className="text-xl font-semibold leading-none">{stats.notes}</div>
                  <div className="text-xs text-muted-foreground">笔记整理</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-none">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-3">
                <div className="history-stat-icon-shell flex h-9 w-9 items-center justify-center rounded-md bg-accent">
                  <MessageSquareText className="h-4.5 w-4.5 text-accent-foreground" />
                </div>
                <div>
                  <div className="text-xl font-semibold leading-none">{stats.vqa}</div>
                  <div className="text-xs text-muted-foreground">视频问答</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 shadow-none">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-3">
                <div className="history-stat-icon-shell flex h-9 w-9 items-center justify-center rounded-md bg-status-success/10">
                  <Clock className="h-4.5 w-4.5 text-status-success" />
                </div>
                <div>
                  <div className="text-xl font-semibold leading-none">{stats.completed}</div>
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
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as HistoryStatusFilter)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="状态" />
            </SelectTrigger>
              <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="queued">排队中</SelectItem>
              <SelectItem value="running">处理中</SelectItem>
              <SelectItem value="paused">已暂停</SelectItem>
              <SelectItem value="completed">已完成</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
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
        <Card className="border-border/60 shadow-none">
          <CardContent className="p-0">
            <div className="history-selection-toolbar flex flex-wrap items-center justify-between gap-2 border-b bg-muted/10 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "history-pagination-button h-8 px-3 shadow-none",
                    selectionMode && "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                  )}
                  disabled={!selectionMode && (!hasHistoryRecords || isLoading)}
                  onClick={toggleSelectionMode}
                >
                  <Trash2 className="h-4 w-4" />
                  批量删除
                </Button>
                {selectionMode ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 shadow-none"
                      onClick={handleSelectAllVisible}
                      disabled={!hasDeletableTasksOnPage || Boolean(busyTaskId)}
                    >
                      {allDeletableTasksSelected ? "取消全选" : "全选本页"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2.5"
                      onClick={clearSelection}
                      disabled={Boolean(busyTaskId)}
                    >
                      <X className="h-4 w-4" />
                      退出选择
                    </Button>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectionMode ? (
                  <>
                    <span className="text-sm text-muted-foreground">
                      已选 {selectedTaskIds.length} 项
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="history-batch-delete-button h-8 px-3 shadow-none"
                      disabled={selectedTaskIds.length === 0 || Boolean(busyTaskId)}
                      onClick={requestBatchDelete}
                    >
                      <Trash2 className="h-4 w-4" />
                      删除已选
                    </Button>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground/90">
                    {hasHistoryRecords
                      ? "所有状态的任务都支持删除；删除后会一并清理临时文件与分析产物。"
                      : "暂无历史记录可执行批量删除。"}
                  </span>
                )}
              </div>
            </div>
            <div className="divide-y">
              {tasks.length === 0 && !isLoading && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  暂无匹配的历史任务
                </div>
              )}
              {tasks.map((task) => {
                const canDeleteTask = isTaskDeletable(task.status)
                const isSelected = selectedTaskIdSet.has(task.id)

                return (
                  <div
                    key={task.id}
                    className={cn(
                      "flex items-center gap-4 p-3.5 transition-colors hover:bg-muted/35",
                      selectionMode && isSelected && "bg-primary/5",
                    )}
                  >
                    {selectionMode ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className={cn(
                          "history-selection-toggle shrink-0 rounded-full",
                          isSelected && "text-primary",
                        )}
                        aria-pressed={isSelected}
                        title={
                          canDeleteTask
                            ? isSelected
                              ? "取消选择"
                              : "选择任务"
                            : "当前任务不可删除"
                        }
                        disabled={!canDeleteTask || Boolean(busyTaskId)}
                        onClick={() => toggleTaskSelection(task.id)}
                      >
                        {isSelected ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                      </Button>
                    ) : null}
                    {/* 图标 */}
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                        task.workflow === "notes" ? "bg-primary/10" : "bg-accent",
                      )}
                    >
                      {task.workflow === "notes" ? (
                        <FileText className="h-4.5 w-4.5 text-primary" />
                      ) : (
                        <MessageSquareText className="h-4.5 w-4.5 text-accent-foreground" />
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
                        className="history-open-button"
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
                            disabled={!canDeleteTask}
                            onClick={() => requestSingleDelete(task)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">
                共 {total} 条结果，当前第 {page} / {totalPages} 页
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="history-pagination-button"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="history-pagination-button"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  下一页
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <ConfirmDialog
          open={Boolean(pendingDeleteRequest)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingDeleteRequest(null)
            }
          }}
          title="确认删除任务？"
          description={pendingDeleteRequest?.description || "删除后无法恢复。"}
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
