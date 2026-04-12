"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import {
  ArrowRight,
  Clock,
  FileText,
  FileVideo,
  HardDrive,
  Link2,
  MessageSquareText,
  Sparkles,
  Upload,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { formatBytes, formatDurationSeconds } from "@/lib/format"
import { getApiErrorMessage } from "@/lib/api"
import type { WorkflowType } from "@/lib/types"

type TaskSourceMode = "upload" | "url" | "path"

interface VideoFile {
  id: string
  name: string
  size: number
  duration: string
  file: File
}

type NewTaskStartInput =
  | {
      source: "upload"
      files: File[]
      workflow: WorkflowType
      onProgress: (progress: number) => void
    }
  | {
      source: "url"
      url: string
      workflow: WorkflowType
    }
  | {
      source: "path"
      localPath: string
      workflow: WorkflowType
    }

interface NewTaskViewProps {
  selectedWorkflow: WorkflowType
  onStartTask: (input: NewTaskStartInput) => Promise<void>
}

const workflowSteps = {
  notes: [
    { id: 1, name: "音频提取", description: "从视频中提取音频轨道" },
    { id: 2, name: "语音转写", description: "通过 FasterWhisper 本地转写" },
    { id: 3, name: "文本纠错", description: "LLM 智能纠错优化" },
    { id: 4, name: "笔记生成", description: "生成结构化笔记和思维导图" },
  ],
  vqa: [
    { id: 1, name: "音频提取", description: "从视频中提取音频轨道" },
    { id: 2, name: "语音转写", description: "通过 FasterWhisper 本地转写" },
    { id: 3, name: "文本纠错", description: "LLM 智能纠错优化" },
    { id: 4, name: "向量化入库", description: "文本嵌入并存入 ChromaDB" },
    { id: 5, name: "帧画面分析", description: "场景切分 + VLM 语义识别" },
    { id: 6, name: "问答就绪", description: "支持自然语言问答检索" },
  ],
}

const MODE_COPY: Record<
  TaskSourceMode,
  {
    title: string
    description: string
    helper: string
  }
> = {
  upload: {
    title: "上传文件",
    description: "适合直接把本地视频拖进工作台，支持批量导入。",
    helper: "支持 MP4、MOV、AVI、MKV 等常见视频格式。",
  },
  url: {
    title: "网络地址",
    description: "适合从 B 站等在线视频链接直接创建任务。",
    helper: "后端会自动完成下载、抽音和后续分析。",
  },
  path: {
    title: "本地路径",
    description: "适合你已经知道完整视频绝对路径的场景。",
    helper: "输入 Windows 本地路径后即可直接发起分析。",
  },
}

async function readVideoDurationLabel(file: File): Promise<string> {
  if (typeof document === "undefined") {
    return "--:--"
  }

  return new Promise((resolve) => {
    const video = document.createElement("video")
    const objectUrl = URL.createObjectURL(file)
    let settled = false

    const finalize = (value: string) => {
      if (settled) {
        return
      }
      settled = true
      video.onloadedmetadata = null
      video.onerror = null
      video.pause()
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(objectUrl)
      resolve(value)
    }

    video.preload = "metadata"
    video.muted = true
    video.playsInline = true

    video.onloadedmetadata = () => {
      finalize(formatDurationSeconds(video.duration))
    }

    video.onerror = () => {
      finalize("--:--")
    }

    video.src = objectUrl
  })
}

export function NewTaskView({ selectedWorkflow, onStartTask }: NewTaskViewProps) {
  const [sourceMode, setSourceMode] = React.useState<TaskSourceMode>("upload")
  const [isDragging, setIsDragging] = React.useState(false)
  const [uploadedFiles, setUploadedFiles] = React.useState<VideoFile[]>([])
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [urlInput, setUrlInput] = React.useState("")
  const [pathInput, setPathInput] = React.useState("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const isMountedRef = React.useRef(true)

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const appendFiles = React.useCallback((files: File[]) => {
    const nextFiles = files.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      name: file.name,
      size: file.size,
      duration: "--:--",
      file,
    }))

    setUploadedFiles((prev) => {
      const seen = new Set(prev.map((item) => item.id))
      return [...prev, ...nextFiles.filter((item) => !seen.has(item.id))]
    })

    nextFiles.forEach((item) => {
      void readVideoDurationLabel(item.file).then((duration) => {
        if (!isMountedRef.current) {
          return
        }

        setUploadedFiles((prev) =>
          prev.map((current) =>
            current.id === item.id && current.duration !== duration ? { ...current, duration } : current,
          ),
        )
      })
    })
  }, [])

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("video/"))
    if (files.length > 0) {
      appendFiles(files)
    }
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (files.length > 0) {
      appendFiles(files)
    }
    event.target.value = ""
  }

  const handleStartAnalysis = async () => {
    setIsSubmitting(true)
    setUploadProgress(0)

    try {
      if (sourceMode === "upload") {
        if (uploadedFiles.length === 0) {
          toast.error("请先选择至少一个视频文件")
          return
        }
        await onStartTask({
          source: "upload",
          files: uploadedFiles.map((item) => item.file),
          workflow: selectedWorkflow,
          onProgress: setUploadProgress,
        })
        setUploadedFiles([])
        return
      }

      if (sourceMode === "url") {
        const value = urlInput.trim()
        if (!value) {
          toast.error("请输入视频链接")
          return
        }
        await onStartTask({
          source: "url",
          url: value,
          workflow: selectedWorkflow,
        })
        setUrlInput("")
        return
      }

      const value = pathInput.trim()
      if (!value) {
        toast.error("请输入本地视频路径")
        return
      }
      await onStartTask({
        source: "path",
        localPath: value,
        workflow: selectedWorkflow,
      })
      setPathInput("")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "创建任务失败"))
    } finally {
      setIsSubmitting(false)
      setUploadProgress(0)
    }
  }

  const removeFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== fileId))
  }

  const steps = workflowSteps[selectedWorkflow]
  const modeCopy = MODE_COPY[sourceMode]
  const canSubmit =
    (sourceMode === "upload" && uploadedFiles.length > 0) ||
    (sourceMode === "url" && urlInput.trim().length > 0) ||
    (sourceMode === "path" && pathInput.trim().length > 0)

  return (
    <div className="flex-1 overflow-auto">
      <div className="container mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">新建分析任务</h1>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.9fr)]">
          <Card className="border-border/70">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                {selectedWorkflow === "notes" ? (
                  <FileText className="h-5 w-5 text-primary" />
                ) : (
                  <MessageSquareText className="h-5 w-5 text-primary" />
                )}
                <CardTitle className="text-base">
                  {selectedWorkflow === "notes" ? "笔记整理" : "视频问答"} 工作流
                </CardTitle>
                <Badge variant="secondary" className="ml-auto">
                  {steps.length} 个步骤
                </Badge>
              </div>
              <CardDescription>
                {selectedWorkflow === "notes"
                  ? "自动转写视频内容，生成结构化笔记和思维导图。"
                  : "构建语义索引和关键帧证据，支持自然语言检索视频内容。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2">
                {steps.map((step) => (
                  <div
                    key={step.id}
                    className="workflow-step-card workflow-step-card--compact flex min-w-[11rem] flex-1 items-start gap-2.5 rounded-lg border border-border/50 bg-transparent px-3 py-2"
                  >
                    <div className="workflow-step-chip flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                      {step.id}
                    </div>
                    <div className="min-w-0 text-sm leading-5">
                      <div className="font-medium leading-5">{step.name}</div>
                      <div className="mt-px text-[10px] leading-[1.05rem] text-muted-foreground">{step.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle className="text-base">价值预期</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 pt-1">
              <div className="value-expectation-panel border-b border-border/55 pb-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {selectedWorkflow === "notes" ? "笔记整理结果" : "视频问答结果"}
                </p>
                <p className="mt-2 max-w-[46ch] text-sm leading-6">
                  {selectedWorkflow === "notes"
                    ? "你会得到可继续编辑的 Markdown 摘要、结构化笔记和思维导图，同时支持从时间戳回跳视频。"
                    : "你会得到实时生成的回答、对应的视频证据片段、可直接跳转的时间点，以及方便排查依据的过程记录。"}
                </p>
              </div>
              <div className="divide-y divide-border/50 border-b border-border/55">
                <div className="value-expectation-row flex items-start justify-between gap-4 px-0 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">证据联动</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      时间轴、转写片段和问答证据会在任务页联动展示。
                    </p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    回溯更快
                  </span>
                </div>
                <div className="value-expectation-row flex items-start justify-between gap-4 px-0 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">本地优先</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      支持直接引用本地绝对路径，适合桌面端批量复盘视频素材。
                    </p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    连接更少
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">任务输入入口</CardTitle>
            <CardDescription>{modeCopy.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Tabs value={sourceMode} onValueChange={(value) => setSourceMode(value as TaskSourceMode)} className="gap-4">
              <TabsList className="new-task-source-tabs grid h-auto w-full grid-cols-3 gap-2 rounded-2xl bg-muted/20 p-1.5">
                <TabsTrigger className="new-task-source-trigger rounded-xl" value="upload">上传文件</TabsTrigger>
                <TabsTrigger className="new-task-source-trigger rounded-xl" value="url">网络链接</TabsTrigger>
                <TabsTrigger className="new-task-source-trigger rounded-xl" value="path">本地路径</TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="space-y-4">
                <div
                  className={cn(
                    "new-task-source-panel new-task-source-dropzone relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-colors",
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50",
                  )}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <div className="upload-dropzone-icon-shell flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="mt-4 text-center">
                    <p className="text-sm font-medium">
                      拖拽视频文件到此处，或
                      <Button
                        variant="link"
                        className="px-1 text-primary"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        点击选择文件
                      </Button>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground dark:text-foreground/72">{modeCopy.helper}</p>
                  </div>

                  {isSubmitting && sourceMode === "upload" ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/80 backdrop-blur-sm">
                      <div className="w-64 space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span>正在导入...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <Progress value={uploadProgress} />
                      </div>
                    </div>
                  ) : null}
                </div>

                {uploadedFiles.length > 0 ? (
                  <div className="space-y-2">
                    <Separator />
                    <div className="text-sm font-medium">已选择 {uploadedFiles.length} 个文件</div>
                    <div className="space-y-2">
                      {uploadedFiles.map((file) => (
                        <div key={file.id} className="selected-video-file-item flex items-center gap-3 rounded-lg border bg-card p-3">
                          <div className="selected-video-file-icon-shell flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                            <FileVideo className="selected-video-file-icon h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{file.name}</div>
                            <div className="selected-video-file-meta flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <HardDrive className="h-3 w-3" />
                                {formatBytes(file.size)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {file.duration}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            disabled={isSubmitting}
                            onClick={() => removeFile(file.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="url" className="space-y-4">
                <div className="new-task-source-panel rounded-2xl border border-border/70 bg-muted/20 p-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Link2 className="h-4 w-4 text-primary" />
                    粘贴在线视频链接
                  </div>
                  <Input
                    className="mt-4"
                    placeholder="例如：https://www.bilibili.com/video/BV..."
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                  />
                  <p className="mt-3 text-xs leading-6 text-muted-foreground dark:text-foreground/72">{modeCopy.helper}</p>
                </div>
              </TabsContent>

              <TabsContent value="path" className="space-y-4">
                <div className="new-task-source-panel rounded-2xl border border-border/70 bg-muted/20 p-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <HardDrive className="h-4 w-4 text-primary" />
                    输入本地视频绝对路径
                  </div>
                  <Input
                    className="mt-4"
                    placeholder="例如：F:\\Videos\\meeting-demo.mp4"
                    value={pathInput}
                    onChange={(event) => setPathInput(event.target.value)}
                  />
                  <p className="mt-3 text-xs leading-6 text-muted-foreground dark:text-foreground/72">{modeCopy.helper}</p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            {canSubmit ? (
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {sourceMode === "upload"
                  ? "输入素材已准备好，可以直接创建任务。"
                  : sourceMode === "url"
                    ? "链接已填写完成，创建后会自动下载并分析。"
                    : "本地路径已就绪，创建后会直接进入处理流程。"}
              </span>
            ) : (
              `请先完成“${modeCopy.title}”输入`
            )}
          </div>
          <Button
            size="lg"
            disabled={!canSubmit || isSubmitting}
            onClick={() => {
              void handleStartAnalysis()
            }}
            className="gap-2"
          >
            开始分析
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
