"use client"

import * as React from "react"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Clock,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  MessageSquare,
  Send,
  MapPin,
  Search,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

type WorkflowType = "notes" | "vqa"
type StepStatus = "pending" | "processing" | "completed" | "error"

interface ProcessingStep {
  id: string
  name: string
  description: string
  status: StepStatus
  progress?: number
  duration?: string
  logs?: string[]
}

interface TranscriptSegment {
  id: string
  startTime: number
  endTime: number
  text: string
  speaker?: string
}

interface VideoResult {
  timestamp: number
  preview?: string
  relevance: number
  context: string
}

interface TaskProcessingViewProps {
  workflow: WorkflowType
  videoName: string
  onBack: () => void
}

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m}:${s.toString().padStart(2, "0")}`
}

// 模拟处理步骤数据
const getInitialSteps = (workflow: WorkflowType): ProcessingStep[] => {
  const baseSteps: ProcessingStep[] = [
    { id: "extract", name: "音频提取", description: "从视频中提取音频轨道", status: "completed", duration: "0:12" },
    { id: "transcribe", name: "语音转写", description: "FasterWhisper 本地转写", status: "completed", duration: "2:34" },
    { id: "correct", name: "文本纠错", description: "LLM 智能纠错优化", status: "processing", progress: 67 },
  ]

  if (workflow === "notes") {
    return [
      ...baseSteps,
      { id: "notes", name: "笔记生成", description: "生成结构化笔记和思维导图", status: "pending" },
    ]
  }

  return [
    ...baseSteps,
    { id: "embed", name: "向量化入库", description: "文本嵌入存入 ChromaDB", status: "pending" },
    { id: "frames", name: "帧画面分析", description: "场景切分 + VLM 语义识别", status: "pending" },
    { id: "ready", name: "问答就绪", description: "支持自然语言问答检索", status: "pending" },
  ]
}

// 模拟转写结果
const mockTranscript: TranscriptSegment[] = [
  { id: "1", startTime: 0, endTime: 15, text: "大家好，欢迎来到今天的产品设计分享会。今天我们要讨论的主题是关于用户体验设计的核心原则。", speaker: "讲者" },
  { id: "2", startTime: 15, endTime: 35, text: "首先，我想强调的是，用户体验设计不仅仅是关于界面的美观，更重要的是关于用户如何与产品互动的整个过程。", speaker: "讲者" },
  { id: "3", startTime: 35, endTime: 55, text: "我们需要考虑用户的目标、期望、以及他们在使用产品时可能遇到的各种情境和挑战。", speaker: "讲者" },
  { id: "4", startTime: 55, endTime: 80, text: "接下来，让我们通过几个具体的案例来深入探讨这些原则是如何在实际产品中得到应用的。", speaker: "讲者" },
]

// 模拟笔记内容
const mockNotes = `# 产品设计分享会笔记

## 核心主题
用户体验设计的核心原则

## 主要观点

### 1. 用户体验设计的本质
- 不仅仅是界面美观
- 关注用户与产品互动的整个过程
- 需要理解用户目标和期望

### 2. 设计考量因素
- 用户目标
- 用户期望
- 使用情境
- 潜在挑战

### 3. 实践案例
- 通过具体案例深入探讨
- 理论与实践结合

## 关键词
用户体验、产品设计、用户目标、情境设计
`

const mockMindmap = `# 产品设计分享会

## 用户体验设计
### 核心原则
- 以用户为中心
- 关注整体体验
### 设计要素
- 界面美观
- 交互流畅
- 情境适配

## 设计流程
### 用户研究
- 目标分析
- 期望调研
### 原型设计
- 交互原型
- 视觉设计
### 测试验证
- 用户测试
- 迭代优化
`

export function TaskProcessingView({ workflow, videoName, onBack }: TaskProcessingViewProps) {
  const [steps, setSteps] = React.useState<ProcessingStep[]>(() => getInitialSteps(workflow))
  const [currentTime, setCurrentTime] = React.useState(35)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const [activeTranscriptId, setActiveTranscriptId] = React.useState("3")
  const [expandedLogs, setExpandedLogs] = React.useState<string[]>([])
  
  // VQA 相关状态
  const [question, setQuestion] = React.useState("")
  const [chatHistory, setChatHistory] = React.useState<Array<{ role: "user" | "assistant"; content: string; results?: VideoResult[] }>>([])
  const [isSearching, setIsSearching] = React.useState(false)

  const totalProgress = React.useMemo(() => {
    const completedSteps = steps.filter((s) => s.status === "completed").length
    const currentStep = steps.find((s) => s.status === "processing")
    const currentProgress = currentStep?.progress || 0
    return ((completedSteps + currentProgress / 100) / steps.length) * 100
  }, [steps])

  const jumpToTime = (time: number) => {
    setCurrentTime(time)
    // 找到对应的转写片段
    const segment = mockTranscript.find((s) => time >= s.startTime && time < s.endTime)
    if (segment) {
      setActiveTranscriptId(segment.id)
    }
  }

  const handleAskQuestion = () => {
    if (!question.trim()) return
    
    setIsSearching(true)
    setChatHistory((prev) => [...prev, { role: "user", content: question }])
    
    // 模拟搜索延迟
    setTimeout(() => {
      const mockResults: VideoResult[] = [
        { timestamp: 15, relevance: 0.95, context: "用户体验设计不仅仅是关于界面的美观..." },
        { timestamp: 35, relevance: 0.87, context: "我们需要考虑用户的目标、期望..." },
        { timestamp: 55, relevance: 0.72, context: "让我们通过几个具体的案例来深入探讨..." },
      ]
      
      setChatHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `根据您的问题"${question}"，我在视频中找到了以下相关片段：`,
          results: mockResults,
        },
      ])
      setIsSearching(false)
      setQuestion("")
    }, 1500)
  }

  const getStatusIcon = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-status-success" />
      case "processing":
        return <Loader2 className="h-4 w-4 text-status-processing animate-spin" />
      case "error":
        return <AlertCircle className="h-4 w-4 text-status-error" />
      default:
        return <Circle className="h-4 w-4 text-muted-foreground" />
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 顶部进度概览 */}
      <div className="shrink-0 border-b bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              返回
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <div>
              <h2 className="text-sm font-medium">{videoName}</h2>
              <p className="text-xs text-muted-foreground">
                {workflow === "notes" ? "笔记整理" : "视频问答"} 分析中
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={totalProgress === 100 ? "default" : "secondary"}>
              {totalProgress === 100 ? "已完成" : `${Math.round(totalProgress)}%`}
            </Badge>
          </div>
        </div>
        <Progress value={totalProgress} className="h-1.5" />
        
        {/* 步骤状态 */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <Collapsible
                open={expandedLogs.includes(step.id)}
                onOpenChange={(open) => {
                  setExpandedLogs((prev) =>
                    open ? [...prev, step.id] : prev.filter((id) => id !== step.id)
                  )
                }}
              >
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs hover:bg-muted transition-colors">
                    {getStatusIcon(step.status)}
                    <span className={cn(
                      step.status === "processing" && "text-primary font-medium",
                      step.status === "completed" && "text-muted-foreground"
                    )}>
                      {step.name}
                    </span>
                    {step.status === "processing" && step.progress !== undefined && (
                      <span className="text-muted-foreground">{step.progress}%</span>
                    )}
                    {step.duration && (
                      <span className="text-muted-foreground">{step.duration}</span>
                    )}
                  </button>
                </CollapsibleTrigger>
              </Collapsible>
              {index < steps.length - 1 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：视频播放器 + 转写 */}
        <div className="w-1/2 flex flex-col border-r">
          {/* 视频播放器 */}
          <div className="shrink-0 bg-black aspect-video relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-white/50 text-sm">视频预览区域</div>
            </div>
            {/* 播放控制栏 */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
              <div className="flex items-center gap-2 text-white">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                  <SkipForward className="h-4 w-4" />
                </Button>
                <div className="flex-1 mx-2">
                  <div className="h-1 bg-white/30 rounded-full">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${(currentTime / 120) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs tabular-nums">
                  {formatTime(currentTime)} / {formatTime(120)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => setIsMuted(!isMuted)}
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-white hover:bg-white/20">
                  <Maximize className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* 转写内容 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between p-3 border-b">
              <h3 className="text-sm font-medium">转写文本</h3>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  <Copy className="h-3 w-3 mr-1" />
                  复制
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  <Download className="h-3 w-3 mr-1" />
                  导出
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {mockTranscript.map((segment) => (
                  <button
                    key={segment.id}
                    className={cn(
                      "w-full text-left p-3 rounded-lg transition-colors",
                      activeTranscriptId === segment.id
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-muted"
                    )}
                    onClick={() => jumpToTime(segment.startTime)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs font-mono">
                        {formatTime(segment.startTime)}
                      </Badge>
                      {segment.speaker && (
                        <span className="text-xs text-muted-foreground">
                          {segment.speaker}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed">{segment.text}</p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* 右侧：结果/问答 */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          {workflow === "notes" ? (
            // 笔记模式
            <Tabs defaultValue="notes" className="flex-1 flex flex-col">
              <TabsList className="shrink-0 w-full justify-start rounded-none border-b bg-transparent p-0">
                <TabsTrigger
                  value="notes"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  结构化笔记
                </TabsTrigger>
                <TabsTrigger
                  value="mindmap"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
                >
                  思维导图
                </TabsTrigger>
              </TabsList>
              <TabsContent value="notes" className="flex-1 overflow-hidden m-0">
                <div className="h-full flex flex-col">
                  <div className="shrink-0 flex items-center justify-between p-3 border-b">
                    <span className="text-xs text-muted-foreground">
                      自动生成，可编辑
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        <Edit3 className="h-3 w-3 mr-1" />
                        编辑
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        <Download className="h-3 w-3 mr-1" />
                        导出 Markdown
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
                      <pre className="whitespace-pre-wrap font-sans text-sm">
                        {mockNotes}
                      </pre>
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
              <TabsContent value="mindmap" className="flex-1 overflow-hidden m-0">
                <div className="h-full flex flex-col">
                  <div className="shrink-0 flex items-center justify-between p-3 border-b">
                    <span className="text-xs text-muted-foreground">
                      基于笔记自动生成
                    </span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      <Download className="h-3 w-3 mr-1" />
                      导出图片
                    </Button>
                  </div>
                  <div className="flex-1 flex items-center justify-center bg-muted/30">
                    <div className="text-center text-muted-foreground">
                      <div className="text-sm">思维导图预览区域</div>
                      <div className="text-xs mt-1">使用 markmap 渲染</div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            // VQA 问答模式
            <div className="flex-1 flex flex-col">
              <div className="shrink-0 p-3 border-b">
                <h3 className="text-sm font-medium">视频问答</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  用自然语言提问，快速定位相关视频片段
                </p>
              </div>
              
              {/* 对话历史 */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  {chatHistory.length === 0 ? (
                    <div className="text-center py-12">
                      <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50" />
                      <p className="mt-4 text-sm text-muted-foreground">
                        开始提问，探索视频内容
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {["这个视频讲了什么？", "用户体验设计的核心是什么？", "有哪些具体案例？"].map((q) => (
                          <Button
                            key={q}
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => {
                              setQuestion(q)
                            }}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    chatHistory.map((msg, index) => (
                      <div
                        key={index}
                        className={cn(
                          "flex gap-3",
                          msg.role === "user" && "justify-end"
                        )}
                      >
                        {msg.role === "assistant" && (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Search className="h-4 w-4" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg p-3",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          <p className="text-sm">{msg.content}</p>
                          {msg.results && (
                            <div className="mt-3 space-y-2">
                              {msg.results.map((result, i) => (
                                <button
                                  key={i}
                                  className="w-full text-left p-2 rounded bg-background/50 hover:bg-background transition-colors"
                                  onClick={() => jumpToTime(result.timestamp)}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <MapPin className="h-3 w-3 text-primary" />
                                    <Badge variant="outline" className="text-xs font-mono">
                                      {formatTime(result.timestamp)}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      相关度 {Math.round(result.relevance * 100)}%
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground line-clamp-2">
                                    {result.context}
                                  </p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {isSearching && (
                    <div className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                      <div className="bg-muted rounded-lg p-3">
                        <p className="text-sm text-muted-foreground">
                          正在检索视频内容...
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* 输入框 */}
              <div className="shrink-0 p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="输入您的问题..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleAskQuestion()
                      }
                    }}
                  />
                  <Button onClick={handleAskQuestion} disabled={!question.trim() || isSearching}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
