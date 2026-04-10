"use client"

import * as React from "react"
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
  ChevronDown,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
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

type WorkflowType = "notes" | "vqa" | "all"
type TaskStatus = "completed" | "processing" | "failed"

interface HistoryTask {
  id: string
  videoName: string
  workflow: "notes" | "vqa"
  status: TaskStatus
  createdAt: string
  duration: string
  fileSize: string
}

interface HistoryViewProps {
  onOpenTask: (taskId: string) => void
}

const mockHistory: HistoryTask[] = [
  {
    id: "1",
    videoName: "产品设计讲座.mp4",
    workflow: "notes",
    status: "completed",
    createdAt: "2024-01-15 14:30",
    duration: "45:20",
    fileSize: "1.2 GB",
  },
  {
    id: "2",
    videoName: "AI技术分享会议.mp4",
    workflow: "vqa",
    status: "completed",
    createdAt: "2024-01-15 10:15",
    duration: "1:23:45",
    fileSize: "2.8 GB",
  },
  {
    id: "3",
    videoName: "用户调研访谈记录.mp4",
    workflow: "notes",
    status: "processing",
    createdAt: "2024-01-14 16:45",
    duration: "32:10",
    fileSize: "856 MB",
  },
  {
    id: "4",
    videoName: "季度复盘会议.mp4",
    workflow: "vqa",
    status: "completed",
    createdAt: "2024-01-14 09:00",
    duration: "2:15:30",
    fileSize: "4.2 GB",
  },
  {
    id: "5",
    videoName: "新员工培训视频.mp4",
    workflow: "notes",
    status: "failed",
    createdAt: "2024-01-13 11:20",
    duration: "58:40",
    fileSize: "1.5 GB",
  },
  {
    id: "6",
    videoName: "技术架构评审.mp4",
    workflow: "vqa",
    status: "completed",
    createdAt: "2024-01-12 15:30",
    duration: "1:45:00",
    fileSize: "3.1 GB",
  },
]

const getStatusBadge = (status: TaskStatus) => {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-status-success text-white">已完成</Badge>
    case "processing":
      return <Badge variant="secondary" className="bg-status-processing text-white">处理中</Badge>
    case "failed":
      return <Badge variant="destructive">失败</Badge>
  }
}

export function HistoryView({ onOpenTask }: HistoryViewProps) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [workflowFilter, setWorkflowFilter] = React.useState<WorkflowType>("all")
  const [sortBy, setSortBy] = React.useState<"date" | "name" | "size">("date")

  const filteredHistory = React.useMemo(() => {
    let result = [...mockHistory]

    // 搜索过滤
    if (searchQuery) {
      result = result.filter((task) =>
        task.videoName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // 工作流过滤
    if (workflowFilter !== "all") {
      result = result.filter((task) => task.workflow === workflowFilter)
    }

    // 排序
    result.sort((a, b) => {
      switch (sortBy) {
        case "date":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case "name":
          return a.videoName.localeCompare(b.videoName)
        case "size":
          return parseFloat(b.fileSize) - parseFloat(a.fileSize)
        default:
          return 0
      }
    })

    return result
  }, [searchQuery, workflowFilter, sortBy])

  const stats = React.useMemo(() => {
    return {
      total: mockHistory.length,
      notes: mockHistory.filter((t) => t.workflow === "notes").length,
      vqa: mockHistory.filter((t) => t.workflow === "vqa").length,
      completed: mockHistory.filter((t) => t.status === "completed").length,
    }
  }, [])

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
              {filteredHistory.map((task) => (
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
                      <span className="font-medium truncate">{task.videoName}</span>
                      {getStatusBadge(task.status)}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {task.createdAt}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {task.duration}
                      </span>
                      <span>{task.fileSize}</span>
                    </div>
                  </div>

                  {/* 操作 */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenTask(task.id)}
                      disabled={task.status !== "completed"}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      查看
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Download className="h-4 w-4 mr-2" />
                          导出结果
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <FolderOpen className="h-4 w-4 mr-2" />
                          打开文件位置
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive">
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
      </div>
    </div>
  )
}
