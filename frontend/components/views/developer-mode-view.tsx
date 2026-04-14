"use client"

import * as React from "react"
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  Bug,
  FolderOpen,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  SquareTerminal,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getApiErrorMessage, getDeveloperLogs, streamDeveloperLogs } from "@/lib/api"
import { formatDateTime, formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  DeveloperLogCategory,
  DeveloperLogEntry,
  DeveloperLogLevel,
  RuntimePathsResponse,
} from "@/lib/types"

type StreamState = "connecting" | "live" | "paused" | "error"

interface DeveloperModeViewProps {
  runtimePaths: RuntimePathsResponse | null
  onOpenLogsDirectory?: () => void
}

type FilterState = {
  category: string
  level: string
  source: string
  taskId: string
  traceId: string
  sessionId: string
  query: string
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "全部分类" },
  { value: "system", label: "系统" },
  { value: "runtime", label: "运行时" },
  { value: "task", label: "任务执行" },
  { value: "self_check", label: "自检与修复" },
  { value: "vqa", label: "检索与推理" },
  { value: "frontend", label: "前端交互" },
  { value: "error", label: "异常与错误" },
]

const LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "debug", label: "全部级别" },
  { value: "info", label: "从信息开始" },
  { value: "warning", label: "仅警告及错误" },
  { value: "error", label: "仅错误" },
]

const DEFAULT_FILTERS: FilterState = {
  category: "all",
  level: "debug",
  source: "",
  taskId: "",
  traceId: "",
  sessionId: "",
  query: "",
}

const MAX_VISIBLE_LOGS = 500

const categoryLabels: Record<DeveloperLogCategory, string> = {
  system: "系统",
  runtime: "运行时",
  task: "任务",
  self_check: "自检",
  vqa: "检索",
  frontend: "前端",
  error: "异常",
}

const levelLabels: Record<DeveloperLogLevel, string> = {
  debug: "调试",
  info: "信息",
  warning: "警告",
  error: "错误",
}

export function DeveloperModeView({ runtimePaths, onOpenLogsDirectory }: DeveloperModeViewProps) {
  const [filters, setFilters] = React.useState<FilterState>(DEFAULT_FILTERS)
  const [logs, setLogs] = React.useState<DeveloperLogEntry[]>([])
  const [selectedLogId, setSelectedLogId] = React.useState("")
  const [isInitialLoading, setIsInitialLoading] = React.useState(true)
  const [streamState, setStreamState] = React.useState<StreamState>("connecting")
  const [streamVersion, setStreamVersion] = React.useState(0)
  const [lastError, setLastError] = React.useState("")
  const [autoFollow, setAutoFollow] = React.useState(true)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const logIdSetRef = React.useRef(new Set<string>())

  const deferredSource = React.useDeferredValue(filters.source)
  const deferredTaskId = React.useDeferredValue(filters.taskId)
  const deferredTraceId = React.useDeferredValue(filters.traceId)
  const deferredSessionId = React.useDeferredValue(filters.sessionId)
  const deferredQuery = React.useDeferredValue(filters.query)

  const effectiveFilters = React.useMemo(
    () => ({
      category: filters.category === "all" ? "" : filters.category,
      level: filters.level === "debug" ? "" : filters.level,
      source: deferredSource.trim(),
      task_id: deferredTaskId.trim(),
      trace_id: deferredTraceId.trim(),
      session_id: deferredSessionId.trim(),
      q: deferredQuery.trim(),
      limit: MAX_VISIBLE_LOGS,
    }),
    [
      deferredQuery,
      deferredSessionId,
      deferredSource,
      deferredTaskId,
      deferredTraceId,
      filters.category,
      filters.level,
    ],
  )
  const isRealtimePaused = streamState === "paused"

  const applyLogs = React.useEffectEvent((entries: DeveloperLogEntry[], reset = false) => {
    React.startTransition(() => {
      setLogs((previous) => {
        const nextSet = reset ? new Set<string>() : new Set(logIdSetRef.current)
        const nextEntries = reset ? [] : [...previous]
        if (reset) {
          logIdSetRef.current = nextSet
        }
        for (const entry of entries) {
          if (nextSet.has(entry.id)) {
            continue
          }
          nextSet.add(entry.id)
          nextEntries.push(entry)
        }
        nextEntries.sort((left, right) => left.sequence - right.sequence)
        const trimmed = nextEntries.slice(-MAX_VISIBLE_LOGS)
        logIdSetRef.current = new Set(trimmed.map((item) => item.id))
        return trimmed
      })
    })
  })

  const scrollToBottom = React.useEffectEvent(() => {
    if (!autoFollow) {
      return
    }
    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (!viewport) {
        return
      }
      viewport.scrollTop = viewport.scrollHeight
    })
  })

  const reloadLogs = React.useCallback(async () => {
    setIsInitialLoading(true)
    setLastError("")
    try {
      const response = await getDeveloperLogs(effectiveFilters)
      applyLogs(response.items, true)
      if (response.items.length > 0) {
        setSelectedLogId((current) =>
          current && response.items.some((item) => item.id === current)
            ? current
            : response.items[response.items.length - 1]?.id ?? "",
        )
      } else {
        setSelectedLogId("")
      }
    } catch (error) {
      setLastError(getApiErrorMessage(error, "加载开发者日志失败"))
      applyLogs([], true)
      setSelectedLogId("")
    } finally {
      setIsInitialLoading(false)
    }
  }, [applyLogs, effectiveFilters])

  React.useEffect(() => {
    void reloadLogs()
  }, [reloadLogs])

  React.useEffect(() => {
    if (isRealtimePaused) {
      return
    }

    setStreamState("connecting")
    const source = streamDeveloperLogs(
      {
        ...effectiveFilters,
        history_limit: 0,
      },
      (entry) => {
        setLastError("")
        setStreamState("live")
        applyLogs([entry])
        setSelectedLogId((current) => current || entry.id)
        scrollToBottom()
      },
    )

    source.onopen = () => {
      setStreamState("live")
    }

    source.onerror = () => {
      source.close()
      setStreamState("error")
      setLastError("实时日志流连接已中断，可手动刷新或恢复订阅。")
    }

    return () => {
      source.close()
    }
  }, [applyLogs, effectiveFilters, isRealtimePaused, scrollToBottom, streamVersion])

  React.useEffect(() => {
    scrollToBottom()
  }, [logs, scrollToBottom])

  const selectedLog = React.useMemo(
    () => logs.find((item) => item.id === selectedLogId) ?? logs[logs.length - 1] ?? null,
    [logs, selectedLogId],
  )

  const summary = React.useMemo(() => {
    let warningCount = 0
    let errorCount = 0
    for (const entry of logs) {
      if (entry.level === "warning") {
        warningCount += 1
      }
      if (entry.level === "error") {
        errorCount += 1
      }
    }
    return {
      total: logs.length,
      warningCount,
      errorCount,
      latest: logs[logs.length - 1]?.ts ?? "",
    }
  }, [logs])

  const handleViewportScroll = React.useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const distanceToBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    if (distanceToBottom < 24) {
      setAutoFollow(true)
      return
    }
    if (distanceToBottom > 96) {
      setAutoFollow(false)
    }
  }, [])

  const developerLogDir = runtimePaths?.developer_log_dir || ""
  const canResumeRealtime = streamState === "paused" || streamState === "error"

  return (
    <div className="flex-1 overflow-auto">
      <div className="container mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">开发者模式</h1>
            <p className="text-sm text-muted-foreground">
              聚合前端交互、任务执行、自检、检索与系统异常日志，支持实时增量追踪。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={canResumeRealtime ? "default" : "outline"}
              onClick={() => {
                if (canResumeRealtime) {
                  setStreamState("connecting")
                  setStreamVersion((value) => value + 1)
                  return
                }
                setStreamState("paused")
              }}
            >
              {canResumeRealtime ? (
                <PlayCircle className="h-4 w-4" />
              ) : (
                <PauseCircle className="h-4 w-4" />
              )}
              {canResumeRealtime ? "恢复实时" : "暂停实时"}
            </Button>
            <Button
              variant={autoFollow ? "default" : "outline"}
              onClick={() => {
                setAutoFollow((current) => !current)
              }}
            >
              <ArrowDown className="h-4 w-4" />
              {autoFollow ? "自动跟随中" : "开启自动跟随"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void reloadLogs()
                if (streamState === "error" || streamState === "paused") {
                  setStreamState("connecting")
                  setStreamVersion((value) => value + 1)
                }
              }}
            >
              <RefreshCw className={cn("h-4 w-4", isInitialLoading && "animate-spin")} />
              刷新列表
            </Button>
            <Button variant="outline" onClick={onOpenLogsDirectory} disabled={!developerLogDir}>
              <FolderOpen className="h-4 w-4" />
              打开日志目录
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={SquareTerminal}
            label="当前载入"
            value={`${summary.total} 条`}
            detail={summary.latest ? `最近更新 ${formatRelativeTime(summary.latest)}` : "等待第一条日志"}
          />
          <SummaryCard
            icon={AlertTriangle}
            label="警告"
            value={`${summary.warningCount} 条`}
            detail="包含运行时回退、链路异常前兆等事件"
          />
          <SummaryCard
            icon={Bug}
            label="错误"
            value={`${summary.errorCount} 条`}
            detail="聚合后端异常、流式故障与前端未捕获错误"
          />
          <SummaryCard
            icon={streamState === "error" ? AlertTriangle : Activity}
            label="实时状态"
            value={getStreamStateLabel(streamState)}
            detail={lastError || (autoFollow ? "新日志会自动贴底显示" : "已关闭自动跟随")}
            tone={streamState === "error" ? "error" : streamState === "live" ? "success" : "default"}
          />
        </div>

        <Card className="gap-0 rounded-md border-border/70 bg-card/75 py-0 shadow-none">
          <CardContent className="grid gap-3 px-4 py-4 lg:grid-cols-[repeat(4,minmax(0,1fr))] xl:grid-cols-[1fr_0.85fr_0.9fr_0.9fr_0.9fr_0.9fr_1.1fr]">
            <FilterSelect
              label="日志分类"
              value={filters.category}
              options={CATEGORY_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
              onValueChange={(value) => setFilters((current) => ({ ...current, category: value }))}
            />
            <FilterSelect
              label="最低级别"
              value={filters.level}
              options={LEVEL_OPTIONS}
              onValueChange={(value) => setFilters((current) => ({ ...current, level: value }))}
            />
            <FilterInput
              label="来源"
              placeholder="如 services.vqa_runtime"
              value={filters.source}
              onChange={(value) => setFilters((current) => ({ ...current, source: value }))}
            />
            <FilterInput
              label="任务 ID"
              placeholder="task-..."
              value={filters.taskId}
              onChange={(value) => setFilters((current) => ({ ...current, taskId: value }))}
            />
            <FilterInput
              label="Trace ID"
              placeholder="trace-..."
              value={filters.traceId}
              onChange={(value) => setFilters((current) => ({ ...current, traceId: value }))}
            />
            <FilterInput
              label="会话 ID"
              placeholder="self-check 会话"
              value={filters.sessionId}
              onChange={(value) => setFilters((current) => ({ ...current, sessionId: value }))}
            />
            <div className="space-y-2">
              <label className="text-xs font-medium tracking-[0.08em] text-muted-foreground">关键词</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="消息、来源、payload、阶段"
                  value={filters.query}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, query: event.target.value }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.95fr)]">
          <Card className="min-h-[32rem] gap-0 overflow-hidden rounded-md border-border/70 bg-card/75 py-0 shadow-none">
            <CardContent className="flex min-h-[32rem] flex-col px-0 py-0">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div className="min-w-0">
                  <CardTitle className="text-sm font-medium">实时日志流</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    当前筛选结果会持续追加新日志，适合跟踪任务执行和异常定位。
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      streamState === "live" && "bg-status-success animate-pulse",
                      streamState === "connecting" && "bg-status-processing animate-pulse",
                      streamState === "paused" && "bg-muted-foreground/60",
                      streamState === "error" && "bg-status-error",
                    )}
                  />
                  <span>{getStreamStateLabel(streamState)}</span>
                </div>
              </div>

              {isInitialLoading ? (
                <div className="flex flex-1 items-center justify-center px-6 py-8">
                  <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>正在装载日志历史和实时订阅状态…</span>
                  </div>
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-6 py-8">
                  <div className="max-w-md space-y-2 text-center">
                    <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-muted/20">
                      <SquareTerminal className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">当前筛选条件下还没有日志</p>
                    <p className="text-sm text-muted-foreground">
                      可以放宽筛选条件，或者保持实时订阅等待新的链路事件进入。
                    </p>
                  </div>
                </div>
              ) : (
                <ScrollArea className="min-h-0 flex-1">
                  <div
                    ref={viewportRef}
                    onScroll={handleViewportScroll}
                    className="h-[32rem] space-y-2 overflow-y-auto px-3 py-3"
                  >
                    {logs.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedLogId(entry.id)}
                        className={cn(
                          "w-full rounded-md border border-border/65 bg-background/60 p-3 text-left transition-colors hover:bg-accent/35",
                          selectedLog?.id === entry.id && "border-primary/40 bg-primary/[0.06]",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={getLevelBadgeVariant(entry.level)} className={getLevelBadgeClassName(entry.level)}>
                            {levelLabels[entry.level]}
                          </Badge>
                          <Badge variant="outline">{categoryLabels[entry.category]}</Badge>
                          <span className="text-[11px] text-muted-foreground">{formatDateTime(entry.ts)}</span>
                          {entry.stage ? (
                            <span className="text-[11px] text-muted-foreground">
                              {entry.substage ? `${entry.stage}/${entry.substage}` : entry.stage}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 line-clamp-2 text-sm font-medium leading-6">{entry.message}</div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                          <span>来源 {entry.source}</span>
                          {entry.task_id ? <span>任务 {entry.task_id}</span> : null}
                          {entry.trace_id ? <span>链路 {entry.trace_id}</span> : null}
                          {entry.session_id ? <span>会话 {entry.session_id}</span> : null}
                          {entry.event_type ? <span>事件 {entry.event_type}</span> : null}
                        </div>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card className="min-h-[32rem] gap-0 overflow-hidden rounded-md border-border/70 bg-card/75 py-0 shadow-none">
            <CardContent className="flex min-h-[32rem] flex-col px-0 py-0">
              <div className="border-b border-border/60 px-4 py-3">
                <CardTitle className="text-sm font-medium">日志详情</CardTitle>
                <p className="text-xs text-muted-foreground">
                  查看当前日志的上下文、关联标识与原始 payload。
                </p>
              </div>

              {selectedLog ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="space-y-4 px-4 py-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getLevelBadgeVariant(selectedLog.level)} className={getLevelBadgeClassName(selectedLog.level)}>
                          {levelLabels[selectedLog.level]}
                        </Badge>
                        <Badge variant="outline">{categoryLabels[selectedLog.category]}</Badge>
                        {selectedLog.event_type ? <Badge variant="secondary">{selectedLog.event_type}</Badge> : null}
                      </div>
                      <p className="text-sm font-medium leading-6">{selectedLog.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(selectedLog.ts)} · {formatRelativeTime(selectedLog.ts)}
                      </p>
                    </div>

                    <div className="grid gap-2 text-xs md:grid-cols-2">
                      <DetailField label="来源" value={selectedLog.source} />
                      <DetailField label="Topic" value={selectedLog.topic} />
                      <DetailField label="任务 ID" value={selectedLog.task_id} />
                      <DetailField label="Trace ID" value={selectedLog.trace_id} />
                      <DetailField label="会话 ID" value={selectedLog.session_id} />
                      <DetailField
                        label="阶段"
                        value={
                          selectedLog.stage
                            ? selectedLog.substage
                              ? `${selectedLog.stage}/${selectedLog.substage}`
                              : selectedLog.stage
                            : ""
                        }
                      />
                    </div>
                  </div>

                  <div className="border-t border-border/60 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium tracking-[0.08em] text-muted-foreground">原始 PAYLOAD</span>
                      <span className="text-[11px] text-muted-foreground">
                        {developerLogDir ? `落盘目录：${developerLogDir}` : "当前未检测到日志目录"}
                      </span>
                    </div>
                  </div>

                  <ScrollArea className="min-h-0 flex-1">
                    <pre className="min-h-full overflow-x-auto px-4 py-4 font-mono text-[12px] leading-6 text-foreground">
                      {JSON.stringify(selectedLog.payload ?? {}, null, 2)}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center px-6 py-8">
                  <div className="max-w-sm space-y-2 text-center">
                    <p className="text-sm font-medium">尚未选中日志</p>
                    <p className="text-sm text-muted-foreground">
                      从左侧流式列表中选择一条记录，这里会展示完整上下文和原始 payload。
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: React.ElementType
  label: string
  value: string
  detail: string
  tone?: "default" | "success" | "error"
}) {
  return (
    <Card className="gap-0 rounded-md border-border/70 bg-card/75 py-0 shadow-none">
      <CardContent className="flex items-start justify-between gap-3 px-4 py-4">
        <div className="space-y-1">
          <div className="text-xs font-medium tracking-[0.08em] text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold tracking-tight">{value}</div>
          <div className="text-xs leading-5 text-muted-foreground">{detail}</div>
        </div>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md border bg-background/85",
            tone === "success" && "border-status-success/20 bg-status-success/8 text-status-success",
            tone === "error" && "border-status-error/20 bg-status-error/8 text-status-error",
            tone === "default" && "border-border/60 text-muted-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onValueChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium tracking-[0.08em] text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function FilterInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium tracking-[0.08em] text-muted-foreground">{label}</label>
      <Input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/55 px-3 py-2.5">
      <div className="text-[11px] tracking-[0.08em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-[12px] leading-5">{value || "-"}</div>
    </div>
  )
}

function getLevelBadgeVariant(level: DeveloperLogLevel): "default" | "secondary" | "destructive" | "outline" {
  if (level === "error") {
    return "destructive"
  }
  if (level === "warning") {
    return "secondary"
  }
  if (level === "info") {
    return "default"
  }
  return "outline"
}

function getLevelBadgeClassName(level: DeveloperLogLevel): string {
  if (level === "warning") {
    return "bg-amber-500 text-white"
  }
  if (level === "info") {
    return "bg-status-processing text-white"
  }
  return ""
}

function getStreamStateLabel(state: StreamState): string {
  switch (state) {
    case "live":
      return "实时连接中"
    case "paused":
      return "已暂停"
    case "error":
      return "连接异常"
    default:
      return "连接中"
  }
}
