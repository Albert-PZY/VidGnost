"use client"

import { Activity, AlertTriangle, RefreshCw, ServerCrash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export type BootstrapStatus = "initializing" | "connecting" | "degraded" | "ready"

interface BootstrapStatusOverlayProps {
  status: BootstrapStatus
  message: string
  canOpenLogs: boolean
  onRetry: () => void
  onOpenDiagnostics: () => void
  onOpenLogs: () => void
}

const statusCopy: Record<
  BootstrapStatus,
  { title: string; description: string; icon: typeof Activity }
> = {
  initializing: {
    title: "正在初始化桌面工作台",
    description: "正在装载界面骨架和最近一次 UI 配置。",
    icon: Activity,
  },
  connecting: {
    title: "正在连接后端",
    description: "等待 Python 服务就绪并同步任务与设置数据。",
    icon: RefreshCw,
  },
  degraded: {
    title: "后端当前不可用",
    description: "你仍然可以保留当前界面，但需要恢复后端连接后才能继续分析任务。",
    icon: ServerCrash,
  },
  ready: {
    title: "",
    description: "",
    icon: Activity,
  },
}

export function BootstrapStatusOverlay({
  status,
  message,
  canOpenLogs,
  onRetry,
  onOpenDiagnostics,
  onOpenLogs,
}: BootstrapStatusOverlayProps) {
  if (status === "ready") {
    return null
  }

  const copy = statusCopy[status]
  const Icon = copy.icon

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/82 px-6 backdrop-blur-md">
      <Card className="w-full max-w-xl border-border/70 bg-card/92 shadow-2xl">
        <CardHeader className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className={status === "connecting" ? "h-5 w-5 animate-spin" : "h-5 w-5"} />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">{copy.title}</CardTitle>
            <CardDescription className="text-sm leading-6">{copy.description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
            {message || "等待系统返回更多状态信息。"}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={onRetry} disabled={status === "connecting"}>
              <RefreshCw className={status === "connecting" ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
              重试连接
            </Button>
            <Button variant="outline" onClick={onOpenDiagnostics}>
              <AlertTriangle className="mr-2 h-4 w-4" />
              查看诊断
            </Button>
            <Button variant="outline" disabled={!canOpenLogs} onClick={onOpenLogs}>
              打开日志目录
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
