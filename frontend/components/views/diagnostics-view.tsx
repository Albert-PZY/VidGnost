"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Cpu,
  HardDrive,
  Database,
  Mic,
  Eye,
  Brain,
  Shuffle,
  Server,
  Zap,
  MemoryStick,
  Clock,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  getApiErrorMessage,
  getRuntimeMetrics,
  getSelfCheckReport,
  startSelfCheck,
  streamSelfCheckEvents,
} from "@/lib/api"
import { formatBytes, formatDurationSeconds } from "@/lib/format"
import type {
  RuntimeMetricsResponse,
  SelfCheckReportResponse,
  SelfCheckStepResponse,
  SelfCheckStreamEvent,
} from "@/lib/types"

type CheckStatus = "pending" | "checking" | "success" | "warning" | "error"

interface DiagnosticCheck {
  id: string
  name: string
  description: string
  icon: React.ElementType
  status: CheckStatus
  message?: string
  details?: Record<string, string>
}

const CHECK_ICON_MAP: Record<string, React.ElementType> = {
  env: Server,
  gpu: Zap,
  whisper: Mic,
  llm: Brain,
  embedding: Shuffle,
  vlm: Eye,
  chromadb: Database,
  storage: HardDrive,
  ffmpeg: Cpu,
  "model-cache": HardDrive,
}

const INITIAL_CHECKS: DiagnosticCheck[] = [
  { id: "env", name: "系统环境", description: "检查系统资源和运行环境", icon: Server, status: "pending" },
  { id: "gpu", name: "GPU 加速", description: "检查 CUDA 和 GPU 可用性", icon: Zap, status: "pending" },
  { id: "whisper", name: "FasterWhisper", description: "语音转写模型状态", icon: Mic, status: "pending" },
  { id: "llm", name: "LLM 模型", description: "大语言模型加载状态", icon: Brain, status: "pending" },
  { id: "embedding", name: "嵌入模型", description: "文本向量化模型状态", icon: Shuffle, status: "pending" },
  { id: "vlm", name: "VLM 模型", description: "视觉语言模型状态", icon: Eye, status: "pending" },
  { id: "chromadb", name: "ChromaDB", description: "向量数据库连接状态", icon: Database, status: "pending" },
  { id: "storage", name: "存储空间", description: "检查磁盘可用空间", icon: HardDrive, status: "pending" },
  { id: "ffmpeg", name: "FFmpeg", description: "检查视频预处理依赖", icon: Cpu, status: "pending" },
  { id: "model-cache", name: "Whisper 模型缓存", description: "检查本地模型缓存目录", icon: HardDrive, status: "pending" },
]

const EMPTY_METRICS: RuntimeMetricsResponse = {
  uptime_seconds: 0,
  cpu_percent: 0,
  memory_used_bytes: 0,
  memory_total_bytes: 0,
  gpu_percent: 0,
  gpu_memory_used_bytes: 0,
  gpu_memory_total_bytes: 0,
  sampled_at: "",
}

function formatSampledAt(value: string): string {
  if (!value) {
    return "等待首次采样"
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return "等待首次采样"
  }
  return parsed.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatUsagePercent(usedBytes: number, totalBytes: number): string {
  if (usedBytes <= 0 || totalBytes <= 0) {
    return "等待数据"
  }
  return `${Math.round((usedBytes / totalBytes) * 100)}% 已用`
}

function mapStepStatus(status: string): CheckStatus {
  switch (status) {
    case "passed":
      return "success"
    case "warning":
      return "warning"
    case "failed":
      return "error"
    case "running":
      return "checking"
    default:
      return "pending"
  }
}

const getStatusIcon = (status: CheckStatus) => {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-5 w-5 text-status-success" />
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-amber-500" />
    case "error":
      return <XCircle className="h-5 w-5 text-status-error" />
    case "checking":
      return <Loader2 className="h-5 w-5 text-status-processing animate-spin" />
    default:
      return <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
  }
}

const getStatusText = (status: CheckStatus) => {
  switch (status) {
    case "success":
      return "正常"
    case "warning":
      return "警告"
    case "error":
      return "异常"
    case "checking":
      return "检查中"
    default:
      return "待检查"
  }
}

function buildChecks(report: SelfCheckReportResponse | null): DiagnosticCheck[] {
  if (!report || report.steps.length === 0) {
    return INITIAL_CHECKS
  }

  return report.steps.map((step) => ({
    id: step.id,
    name: step.title,
    description: step.message || "等待检查",
    icon: CHECK_ICON_MAP[step.id] || Server,
    status: mapStepStatus(step.status),
    message: step.message,
    details: step.details,
  }))
}

export function DiagnosticsView() {
  const [report, setReport] = React.useState<SelfCheckReportResponse | null>(null)
  const [runtimeMetrics, setRuntimeMetrics] = React.useState<RuntimeMetricsResponse>(EMPTY_METRICS)
  const [activeSessionId, setActiveSessionId] = React.useState("")
  const [isStarting, setIsStarting] = React.useState(false)

  const loadRuntimeMetrics = React.useCallback(async () => {
    try {
      const payload = await getRuntimeMetrics()
      setRuntimeMetrics(payload)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "获取运行时信息失败"))
    }
  }, [])

  const refreshReport = React.useCallback(async (sessionId: string) => {
    const nextReport = await getSelfCheckReport(sessionId)
    setReport(nextReport)
    return nextReport
  }, [])

  React.useEffect(() => {
    void loadRuntimeMetrics()
    const interval = window.setInterval(() => {
      void loadRuntimeMetrics()
    }, 5000)
    return () => window.clearInterval(interval)
  }, [loadRuntimeMetrics])

  React.useEffect(() => {
    if (!activeSessionId) {
      return
    }

    const source = streamSelfCheckEvents(activeSessionId, (_event: SelfCheckStreamEvent) => {
      void refreshReport(activeSessionId).catch((error) => {
        toast.error(getApiErrorMessage(error, "同步自检状态失败"))
      })
    })

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
    }
  }, [activeSessionId, refreshReport])

  const runDiagnostics = async () => {
    setIsStarting(true)
    setReport(null)
    try {
      const payload = await startSelfCheck()
      setActiveSessionId(payload.session_id)
      await refreshReport(payload.session_id)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "启动系统自检失败"))
    } finally {
      setIsStarting(false)
    }
  }

  const checks = buildChecks(report)
  const currentCheckIndex = checks.findIndex((check) => check.status === "checking")
  const completedCount = checks.filter(
    (check) => check.status === "success" || check.status === "warning" || check.status === "error",
  ).length
  const progress = report?.progress ?? (checks.length > 0 ? (completedCount / checks.length) * 100 : 0)
  const isRunning = report?.status === "running" || isStarting

  const summary = React.useMemo(() => {
    const success = checks.filter((check) => check.status === "success").length
    const warning = checks.filter((check) => check.status === "warning").length
    const error = checks.filter((check) => check.status === "error").length
    return { success, warning, error }
  }, [checks])

  const runtimeMetricItems = React.useMemo(
    () => [
      {
        key: "uptime",
        label: "运行时间",
        icon: Clock,
        value: formatDurationSeconds(runtimeMetrics.uptime_seconds),
        detail: `采样 ${formatSampledAt(runtimeMetrics.sampled_at)}`,
      },
      {
        key: "cpu",
        label: "CPU 使用率",
        icon: Cpu,
        value: `${runtimeMetrics.cpu_percent.toFixed(0)}%`,
        detail: "后端进程实时负载",
      },
      {
        key: "memory",
        label: "内存使用",
        icon: MemoryStick,
        value:
          `${formatBytes(runtimeMetrics.memory_used_bytes)}` +
          (runtimeMetrics.memory_total_bytes > 0 ? ` / ${formatBytes(runtimeMetrics.memory_total_bytes)}` : ""),
        detail: formatUsagePercent(runtimeMetrics.memory_used_bytes, runtimeMetrics.memory_total_bytes),
      },
      {
        key: "gpu",
        label: "GPU 使用率",
        icon: Zap,
        value: `${runtimeMetrics.gpu_percent.toFixed(0)}%`,
        detail:
          runtimeMetrics.gpu_memory_total_bytes > 0
            ? `${formatBytes(runtimeMetrics.gpu_memory_used_bytes)} / ${formatBytes(runtimeMetrics.gpu_memory_total_bytes)} 显存`
            : "未检测到 GPU 遥测",
      },
    ],
    [runtimeMetrics],
  )

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">系统自检</h1>
            <p className="text-muted-foreground">
              检查系统环境和模型状态，确保所有组件正常运行
            </p>
          </div>
          <Button onClick={() => void runDiagnostics()} disabled={isRunning}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isRunning && "animate-spin")} />
            {isRunning ? "检查中..." : "开始检查"}
          </Button>
        </div>

        {(isRunning || report !== null) && (
          <Card className="gap-0 rounded-md border-border/70 bg-card/75 py-0 shadow-none">
            <CardContent className="p-3.5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium">
                  检查进度 ({completedCount}/{checks.length})
                </span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-status-success">
                    <CheckCircle2 className="h-4 w-4" />
                    {summary.success} 正常
                  </span>
                  {summary.warning > 0 && (
                    <span className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="h-4 w-4" />
                      {summary.warning} 警告
                    </span>
                  )}
                  {summary.error > 0 && (
                    <span className="flex items-center gap-1 text-status-error">
                      <XCircle className="h-4 w-4" />
                      {summary.error} 异常
                    </span>
                  )}
                </div>
              </div>
              <Progress value={progress} className="h-2" />
            </CardContent>
          </Card>
        )}

        <Card className="gap-0 overflow-hidden rounded-md border-border/70 bg-card/70 py-0 shadow-none">
          {checks.map((check, index) => (
            <div
              key={check.id}
              className={cn(
                "flex items-start gap-3.5 px-4 py-3 transition-colors",
                index !== 0 && "border-t border-border/60",
                currentCheckIndex === index && "bg-primary/[0.035]",
              )}
            >
              <div
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background/85",
                  check.status === "success" && "border-status-success/20 bg-status-success/6",
                  check.status === "warning" && "border-amber-500/20 bg-amber-500/6",
                  check.status === "error" && "border-status-error/20 bg-status-error/6",
                  (check.status === "pending" || check.status === "checking") && "border-border/60",
                )}
              >
                <check.icon
                  className={cn(
                    "h-4 w-4",
                    check.status === "success" && "text-status-success",
                    check.status === "warning" && "text-amber-500",
                    check.status === "error" && "text-status-error",
                    (check.status === "pending" || check.status === "checking") && "text-muted-foreground",
                  )}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{check.name}</span>
                  {check.status !== "pending" && (
                    <Badge
                      variant={
                        check.status === "success"
                          ? "default"
                          : check.status === "warning"
                            ? "secondary"
                            : check.status === "error"
                              ? "destructive"
                              : "outline"
                      }
                      className={cn(
                        "h-5 rounded-md px-1.5 text-[11px]",
                        check.status === "success" && "bg-status-success",
                        check.status === "checking" && "bg-status-processing",
                      )}
                    >
                      {getStatusText(check.status)}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {check.message || check.description}
                </p>

                {check.details && Object.keys(check.details).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                    {Object.entries(check.details).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="font-medium">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="shrink-0 pt-0.5">{getStatusIcon(check.status)}</div>
            </div>
          ))}
        </Card>

        <Card className="gap-0 rounded-md border-border/70 bg-card/75 py-0 shadow-none">
          <CardContent className="px-4 py-3">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2.5">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-medium">运行时信息</CardTitle>
                <span className="text-xs text-muted-foreground">每 5 秒自动刷新</span>
              </div>
              <span className="text-xs text-muted-foreground">
                最近采样 {formatSampledAt(runtimeMetrics.sampled_at)}
              </span>
            </div>

            <div className="mt-1.5 flex flex-col divide-y divide-border/50 md:flex-row md:divide-x md:divide-y-0">
              {runtimeMetricItems.map((item) => (
                <div
                  key={item.key}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 py-3 md:px-3 md:first:pl-0 md:last:pr-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                      <item.icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{item.label}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground/90">{item.detail}</div>
                  </div>
                  <div className="shrink-0 text-right text-sm font-semibold tracking-tight">{item.value}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
