"use client"

import { Activity, AlertTriangle, FolderOpen, Loader2, RefreshCw, ServerCrash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

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
  const isBlocking = status === "initializing" || status === "connecting"
  const isLoading = status !== "degraded"

  return (
    <div
      className={cn(
        "absolute inset-0 z-50",
        isBlocking
          ? "flex items-center justify-center bg-background/82 px-6 backdrop-blur-md"
          : "pointer-events-none flex items-start justify-end p-4 sm:p-6",
      )}
    >
      <Card
        aria-live="polite"
        className={cn(
          "border-border/70 shadow-2xl",
          isBlocking
            ? "w-full max-w-xl bg-card/92"
            : "pointer-events-auto w-full max-w-md bg-card/95 shadow-[0_24px_64px_-28px_rgba(15,23,42,0.42)]",
        )}
      >
        <CardHeader className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
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

          {isLoading ? (
            <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">启动进行中</div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    首次启动或后端重启时，通常需要几秒完成健康检查与配置同步。
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary/80 animate-pulse" />
                  <span className="h-2.5 w-2.5 rounded-full bg-primary/55 animate-pulse [animation-delay:180ms]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-primary/35 animate-pulse [animation-delay:360ms]" />
                </div>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-primary/10">
                <div className="h-full w-2/5 rounded-full bg-primary/75 animate-[pulse_1.4s_ease-in-out_infinite]" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-5 text-muted-foreground">
                你可以先切到诊断页排查问题，当前界面不会再被状态面板锁死。
              </p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={onRetry}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  重试连接
                </Button>
                <Button variant="outline" onClick={onOpenDiagnostics}>
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  查看诊断
                </Button>
                {canOpenLogs ? (
                  <Button variant="outline" onClick={onOpenLogs}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    打开日志目录
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
