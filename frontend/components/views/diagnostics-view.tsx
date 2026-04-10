"use client"

import * as React from "react"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

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

const initialChecks: DiagnosticCheck[] = [
  {
    id: "system",
    name: "系统环境",
    description: "检查系统资源和运行环境",
    icon: Server,
    status: "pending",
  },
  {
    id: "gpu",
    name: "GPU 加速",
    description: "检查 CUDA 和 GPU 可用性",
    icon: Zap,
    status: "pending",
  },
  {
    id: "whisper",
    name: "FasterWhisper",
    description: "语音转写模型状态",
    icon: Mic,
    status: "pending",
  },
  {
    id: "llm",
    name: "LLM 模型",
    description: "大语言模型加载状态",
    icon: Brain,
    status: "pending",
  },
  {
    id: "embedding",
    name: "嵌入模型",
    description: "文本向量化模型状态",
    icon: Shuffle,
    status: "pending",
  },
  {
    id: "vlm",
    name: "VLM 模型",
    description: "视觉语言模型状态",
    icon: Eye,
    status: "pending",
  },
  {
    id: "chromadb",
    name: "ChromaDB",
    description: "向量数据库连接状态",
    icon: Database,
    status: "pending",
  },
  {
    id: "storage",
    name: "存储空间",
    description: "检查磁盘可用空间",
    icon: HardDrive,
    status: "pending",
  },
]

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

export function DiagnosticsView() {
  const [checks, setChecks] = React.useState<DiagnosticCheck[]>(initialChecks)
  const [isRunning, setIsRunning] = React.useState(false)
  const [currentCheckIndex, setCurrentCheckIndex] = React.useState(-1)

  const completedCount = checks.filter((c) => 
    c.status === "success" || c.status === "warning" || c.status === "error"
  ).length
  const progress = (completedCount / checks.length) * 100

  const runDiagnostics = async () => {
    setIsRunning(true)
    setChecks(initialChecks)

    // 模拟逐项检查
    for (let i = 0; i < initialChecks.length; i++) {
      setCurrentCheckIndex(i)
      
      // 设置当前项为检查中
      setChecks((prev) =>
        prev.map((c, idx) =>
          idx === i ? { ...c, status: "checking" as CheckStatus } : c
        )
      )

      // 模拟检查延迟
      await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 500))

      // 模拟检查结果
      const results: Record<string, { status: CheckStatus; message: string; details?: Record<string, string> }> = {
        system: {
          status: "success",
          message: "系统环境正常",
          details: {
            "操作系统": "Windows 11 Pro",
            "CPU": "Intel Core i9-13900K",
            "内存": "64 GB DDR5",
          },
        },
        gpu: {
          status: "success",
          message: "GPU 加速可用",
          details: {
            "显卡": "NVIDIA RTX 4090",
            "显存": "24 GB",
            "CUDA": "12.4",
          },
        },
        whisper: {
          status: "success",
          message: "FasterWhisper Large-v3 已加载",
          details: {
            "模型版本": "large-v3",
            "量化": "float16",
          },
        },
        llm: {
          status: "success",
          message: "Qwen2.5-7B-Instruct 已加载",
          details: {
            "模型": "Qwen2.5-7B-Instruct",
            "上下文长度": "32768",
          },
        },
        embedding: {
          status: "success",
          message: "BGE-M3 已加载",
          details: {
            "模型": "BAAI/bge-m3",
            "维度": "1024",
          },
        },
        vlm: {
          status: "warning",
          message: "VLM 模型加载中，可能影响帧分析功能",
          details: {
            "模型": "Qwen2-VL-7B",
            "状态": "加载中 (85%)",
          },
        },
        chromadb: {
          status: "success",
          message: "ChromaDB 连接正常",
          details: {
            "版本": "0.4.22",
            "集合数": "12",
          },
        },
        storage: {
          status: "success",
          message: "存储空间充足",
          details: {
            "总空间": "2 TB",
            "可用": "1.2 TB",
            "已用": "40%",
          },
        },
      }

      const result = results[initialChecks[i].id]
      setChecks((prev) =>
        prev.map((c, idx) =>
          idx === i
            ? {
                ...c,
                status: result.status,
                message: result.message,
                details: result.details,
              }
            : c
        )
      )
    }

    setIsRunning(false)
    setCurrentCheckIndex(-1)
  }

  const summary = React.useMemo(() => {
    const success = checks.filter((c) => c.status === "success").length
    const warning = checks.filter((c) => c.status === "warning").length
    const error = checks.filter((c) => c.status === "error").length
    return { success, warning, error }
  }, [checks])

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-4xl mx-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">系统自检</h1>
            <p className="text-muted-foreground">
              检查系统环境和模型状态，确保所有组件正常运行
            </p>
          </div>
          <Button onClick={runDiagnostics} disabled={isRunning}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isRunning && "animate-spin")} />
            {isRunning ? "检查中..." : "开始检查"}
          </Button>
        </div>

        {/* 进度和摘要 */}
        {(isRunning || completedCount > 0) && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
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

        {/* 检查项列表 */}
        <div className="grid gap-4">
          {checks.map((check, index) => (
            <Card
              key={check.id}
              className={cn(
                "transition-all",
                currentCheckIndex === index && "ring-2 ring-primary"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* 图标 */}
                  <div className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    check.status === "success" && "bg-status-success/10",
                    check.status === "warning" && "bg-amber-500/10",
                    check.status === "error" && "bg-status-error/10",
                    (check.status === "pending" || check.status === "checking") && "bg-muted"
                  )}>
                    <check.icon className={cn(
                      "h-5 w-5",
                      check.status === "success" && "text-status-success",
                      check.status === "warning" && "text-amber-500",
                      check.status === "error" && "text-status-error",
                      (check.status === "pending" || check.status === "checking") && "text-muted-foreground"
                    )} />
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
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
                            check.status === "success" && "bg-status-success",
                            check.status === "checking" && "bg-status-processing"
                          )}
                        >
                          {getStatusText(check.status)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {check.message || check.description}
                    </p>

                    {/* 详细信息 */}
                    {check.details && (
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                        {Object.entries(check.details).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">{key}:</span>
                            <span className="font-medium">{value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 状态图标 */}
                  <div className="shrink-0">
                    {getStatusIcon(check.status)}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 系统信息卡片 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">运行时信息</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  运行时间
                </div>
                <div className="text-lg font-semibold">2h 34m</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Cpu className="h-4 w-4" />
                  CPU 使用率
                </div>
                <div className="text-lg font-semibold">23%</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MemoryStick className="h-4 w-4" />
                  内存使用
                </div>
                <div className="text-lg font-semibold">18.4 GB</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Zap className="h-4 w-4" />
                  GPU 使用率
                </div>
                <div className="text-lg font-semibold">45%</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
