"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  MessageSquare,
  Send,
  MapPin,
  Search,
  Save,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  chatWithTask,
  downloadTaskArtifact,
  getApiErrorMessage,
  getTaskDetail,
  streamTaskEvents,
  updateTaskArtifacts,
} from "@/lib/api"
import { formatSecondsAsClock, toFileUrl } from "@/lib/format"
import type {
  TaskDetailResponse,
  TaskStepItem,
  VqaResultItem,
  WorkflowType,
} from "@/lib/types"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  results?: VqaResultItem[]
}

interface TaskProcessingViewProps {
  taskId: string
  workflow: WorkflowType
  taskTitle: string
  onBack: () => void
  onTaskChanged: () => void
  onTaskLoaded?: (task: TaskDetailResponse) => void
}

const WORKFLOW_STEP_LABELS: Record<WorkflowType, Array<{ id: string; name: string }>> = {
  notes: [
    { id: "extract", name: "音频提取" },
    { id: "transcribe", name: "语音转写" },
    { id: "correct", name: "文本纠错" },
    { id: "notes", name: "笔记生成" },
  ],
  vqa: [
    { id: "extract", name: "音频提取" },
    { id: "transcribe", name: "语音转写" },
    { id: "correct", name: "文本纠错" },
    { id: "embed", name: "向量化入库" },
    { id: "frames", name: "帧画面分析" },
    { id: "ready", name: "问答就绪" },
  ],
}

function buildFallbackSteps(workflow: WorkflowType): TaskStepItem[] {
  return WORKFLOW_STEP_LABELS[workflow].map((step) => ({
    id: step.id,
    name: step.name,
    status: "pending",
    progress: 0,
    duration: "",
    logs: [],
  }))
}

function findActiveTranscriptId(task: TaskDetailResponse | null, currentTime: number): string {
  if (!task) {
    return ""
  }
  const activeSegment = task.transcript_segments.find(
    (segment) => currentTime >= segment.start && currentTime < segment.end,
  )
  return activeSegment ? `${activeSegment.start}-${activeSegment.end}` : ""
}

export function TaskProcessingView({
  taskId,
  workflow,
  taskTitle,
  onBack,
  onTaskChanged,
  onTaskLoaded,
}: TaskProcessingViewProps) {
  const [task, setTask] = React.useState<TaskDetailResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [errorMessage, setErrorMessage] = React.useState("")
  const [currentTime, setCurrentTime] = React.useState(0)
  const [totalDuration, setTotalDuration] = React.useState(0)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [isMuted, setIsMuted] = React.useState(false)
  const [activeTranscriptId, setActiveTranscriptId] = React.useState("")
  const [question, setQuestion] = React.useState("")
  const [chatHistory, setChatHistory] = React.useState<ChatMessage[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [isEditingNotes, setIsEditingNotes] = React.useState(false)
  const [notesDraft, setNotesDraft] = React.useState("")
  const [isSavingNotes, setIsSavingNotes] = React.useState(false)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const refreshTimerRef = React.useRef<number | null>(null)

  const loadTask = React.useCallback(
    async (showToastOnError = true) => {
      setIsLoading(true)
      try {
        const detail = await getTaskDetail(taskId)
        setTask(detail)
        setErrorMessage("")
        onTaskLoaded?.(detail)
        if (!isEditingNotes) {
          setNotesDraft(detail.notes_markdown || "")
        }
      } catch (error) {
        const message = getApiErrorMessage(error, "加载任务详情失败")
        setErrorMessage(message)
        if (showToastOnError) {
          toast.error(message)
        }
      } finally {
        setIsLoading(false)
      }
    },
    [isEditingNotes, onTaskLoaded, taskId],
  )

  React.useEffect(() => {
    void loadTask()
  }, [loadTask])

  React.useEffect(() => {
    if (!task) {
      return
    }
    setActiveTranscriptId(findActiveTranscriptId(task, currentTime))
  }, [currentTime, task])

  React.useEffect(() => {
    if (!task) {
      return
    }
    void onTaskChanged()
  }, [onTaskChanged, task?.status, task?.updated_at])

  React.useEffect(() => {
    if (!task || !["queued", "running"].includes(task.status)) {
      return
    }

    const source = streamTaskEvents(task.id, () => {
      if (refreshTimerRef.current !== null) {
        return
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null
        void loadTask(false)
      }, 300)
    })

    source.onerror = () => {
      source.close()
    }

    return () => {
      source.close()
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [loadTask, task])

  const effectiveTask = task
  const effectiveTitle = effectiveTask?.title || effectiveTask?.source_input || taskTitle
  const steps = effectiveTask?.steps.length ? effectiveTask.steps : buildFallbackSteps(workflow)
  const totalProgress = effectiveTask?.overall_progress ?? 0
  const transcriptSegments = effectiveTask?.transcript_segments || []
  const videoUrl = toFileUrl(effectiveTask?.source_local_path)

  const jumpToTime = (time: number) => {
    setCurrentTime(time)
    if (videoRef.current) {
      videoRef.current.currentTime = time
    }
    setActiveTranscriptId(findActiveTranscriptId(effectiveTask, time))
  }

  const handleTogglePlay = async () => {
    if (!videoRef.current) {
      setIsPlaying((value) => !value)
      return
    }

    if (videoRef.current.paused) {
      await videoRef.current.play()
      setIsPlaying(true)
      return
    }

    videoRef.current.pause()
    setIsPlaying(false)
  }

  const handleSeek = (deltaSeconds: number) => {
    const nextTime = Math.max(0, currentTime + deltaSeconds)
    jumpToTime(nextTime)
  }

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(effectiveTask?.transcript_text || "")
      toast.success("转写文本已复制")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "复制转写文本失败"))
    }
  }

  const handleDownloadArtifact = async (
    kind: "transcript" | "notes" | "mindmap" | "srt" | "vtt" | "bundle",
  ) => {
    try {
      await downloadTaskArtifact(taskId, kind)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "导出产物失败"))
    }
  }

  const handleSaveNotes = async () => {
    setIsSavingNotes(true)
    try {
      const updated = await updateTaskArtifacts(taskId, {
        notes_markdown: notesDraft,
      })
      setTask(updated)
      setIsEditingNotes(false)
      toast.success("笔记已保存")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "保存笔记失败"))
    } finally {
      setIsSavingNotes(false)
    }
  }

  const handleAskQuestion = async () => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) {
      return
    }

    setIsSearching(true)
    setChatHistory((history) => [...history, { role: "user", content: trimmedQuestion }])

    try {
      const response = await chatWithTask({ task_id: taskId, question: trimmedQuestion })
      const answer = response.answer || response.error?.message || "未生成回答。"
      setChatHistory((history) => [
        ...history,
        {
          role: "assistant",
          content: answer,
          results: response.results || [],
        },
      ])
      setQuestion("")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "执行视频问答失败"))
    } finally {
      setIsSearching(false)
    }
  }

  const getStatusIcon = (status: TaskStepItem["status"]) => {
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
      <div className="shrink-0 border-b bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              返回
            </Button>
            <Separator orientation="vertical" className="h-4" />
            <div>
              <h2 className="text-sm font-medium">{effectiveTitle}</h2>
              <p className="text-xs text-muted-foreground">
                {workflow === "notes" ? "笔记整理" : "视频问答"} {effectiveTask?.status === "completed" ? "已完成" : "处理中"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {effectiveTask?.error_message && (
              <Badge variant="destructive" className="max-w-60 truncate">
                {effectiveTask.error_message}
              </Badge>
            )}
            <Badge variant={totalProgress === 100 ? "default" : "secondary"}>
              {totalProgress === 100 ? "已完成" : `${Math.round(totalProgress)}%`}
            </Badge>
          </div>
        </div>
        <Progress value={totalProgress} className="h-1.5" />

        <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">
                {getStatusIcon(step.status)}
                <span
                  className={cn(
                    step.status === "processing" && "text-primary font-medium",
                    step.status === "completed" && "text-muted-foreground",
                  )}
                >
                  {step.name}
                </span>
                {step.status === "processing" && step.progress > 0 && (
                  <span className="text-muted-foreground">{step.progress}%</span>
                )}
                {step.duration && <span className="text-muted-foreground">{step.duration}</span>}
              </div>
              {index < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-1/2 flex flex-col border-r">
          <div className="shrink-0 bg-black aspect-video relative">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="absolute inset-0 h-full w-full object-contain"
                onTimeUpdate={(event) => {
                  setCurrentTime(event.currentTarget.currentTime)
                }}
                onLoadedMetadata={(event) => {
                  setTotalDuration(event.currentTarget.duration || 0)
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-white/50 text-sm">当前任务没有可预览的本地视频文件</div>
              </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
              <div className="flex items-center gap-2 text-white">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => {
                    void handleTogglePlay()
                  }}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => handleSeek(-10)}
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => handleSeek(10)}
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
                <div className="flex-1 mx-2">
                  <div className="h-1 bg-white/30 rounded-full">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{
                        width: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-xs tabular-nums">
                  {formatSecondsAsClock(currentTime)} / {formatSecondsAsClock(totalDuration)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => {
                    if (!videoRef.current) {
                      setIsMuted((value) => !value)
                      return
                    }
                    videoRef.current.muted = !videoRef.current.muted
                    setIsMuted(videoRef.current.muted)
                  }}
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/20"
                  onClick={() => {
                    if (!document.fullscreenElement) {
                      void document.documentElement.requestFullscreen()
                      return
                    }
                    void document.exitFullscreen()
                  }}
                >
                  <Maximize className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between p-3 border-b">
              <h3 className="text-sm font-medium">转写文本</h3>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void handleCopyTranscript()}>
                  <Copy className="h-3 w-3 mr-1" />
                  复制
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    void handleDownloadArtifact("transcript")
                  }}
                >
                  <Download className="h-3 w-3 mr-1" />
                  导出
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {errorMessage && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {errorMessage}
                  </div>
                )}
                {isLoading && transcriptSegments.length === 0 && (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    正在加载任务详情...
                  </div>
                )}
                {!isLoading && transcriptSegments.length === 0 && (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    当前还没有可展示的转写结果
                  </div>
                )}
                {transcriptSegments.map((segment) => {
                  const segmentId = `${segment.start}-${segment.end}`
                  return (
                    <button
                      key={segmentId}
                      className={cn(
                        "w-full text-left p-3 rounded-lg transition-colors",
                        activeTranscriptId === segmentId
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-muted",
                      )}
                      onClick={() => jumpToTime(segment.start)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs font-mono">
                          {formatSecondsAsClock(segment.start)}
                        </Badge>
                        {segment.speaker && (
                          <span className="text-xs text-muted-foreground">{segment.speaker}</span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed">{segment.text}</p>
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <div className="w-1/2 flex flex-col overflow-hidden">
          {workflow === "notes" ? (
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
                    <span className="text-xs text-muted-foreground">自动生成，可编辑</span>
                    <div className="flex items-center gap-1">
                      {isEditingNotes ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={isSavingNotes}
                            onClick={() => {
                              setIsEditingNotes(false)
                              setNotesDraft(effectiveTask?.notes_markdown || "")
                            }}
                          >
                            <X className="h-3 w-3 mr-1" />
                            取消
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={isSavingNotes}
                            onClick={() => {
                              void handleSaveNotes()
                            }}
                          >
                            <Save className="h-3 w-3 mr-1" />
                            保存
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setIsEditingNotes(true)}
                        >
                          <Edit3 className="h-3 w-3 mr-1" />
                          编辑
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          void handleDownloadArtifact("notes")
                        }}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        导出 Markdown
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="p-4">
                      {isEditingNotes ? (
                        <Textarea
                          className="min-h-[420px] font-mono text-sm"
                          value={notesDraft}
                          onChange={(event) => setNotesDraft(event.target.value)}
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap font-sans text-sm leading-6">
                          {effectiveTask?.notes_markdown || "当前还没有生成笔记内容"}
                        </pre>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
              <TabsContent value="mindmap" className="flex-1 overflow-hidden m-0">
                <div className="h-full flex flex-col">
                  <div className="shrink-0 flex items-center justify-between p-3 border-b">
                    <span className="text-xs text-muted-foreground">基于笔记自动生成</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        void handleDownloadArtifact("mindmap")
                      }}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      导出 HTML
                    </Button>
                  </div>
                  <ScrollArea className="flex-1 bg-muted/30">
                    <div className="p-4">
                      <pre className="whitespace-pre-wrap text-sm text-muted-foreground leading-6">
                        {effectiveTask?.mindmap_markdown || "当前还没有生成思维导图内容"}
                      </pre>
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="shrink-0 p-3 border-b">
                <h3 className="text-sm font-medium">视频问答</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  用自然语言提问，快速定位相关视频片段
                </p>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  {chatHistory.length === 0 ? (
                    <div className="text-center py-12">
                      <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50" />
                      <p className="mt-4 text-sm text-muted-foreground">开始提问，探索视频内容</p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {["这个视频讲了什么？", "用户体验设计的核心是什么？", "有哪些具体案例？"].map((suggestion) => (
                          <Button
                            key={suggestion}
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => setQuestion(suggestion)}
                          >
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    chatHistory.map((message, index) => (
                      <div key={index} className={cn("flex gap-3", message.role === "user" && "justify-end")}>
                        {message.role === "assistant" && (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Search className="h-4 w-4" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg p-3",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted",
                          )}
                        >
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          {message.results && message.results.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {message.results.map((result, resultIndex) => (
                                <button
                                  key={`${result.timestamp}-${resultIndex}`}
                                  className="w-full text-left p-2 rounded bg-background/50 hover:bg-background transition-colors"
                                  onClick={() => jumpToTime(result.timestamp)}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <MapPin className="h-3 w-3 text-primary" />
                                    <Badge variant="outline" className="text-xs font-mono">
                                      {formatSecondsAsClock(result.timestamp)}
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
                        <p className="text-sm text-muted-foreground">正在检索视频内容...</p>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="shrink-0 p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="输入您的问题..."
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        void handleAskQuestion()
                      }
                    }}
                  />
                  <Button
                    onClick={() => {
                      void handleAskQuestion()
                    }}
                    disabled={!question.trim() || isSearching || !effectiveTask}
                  >
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
