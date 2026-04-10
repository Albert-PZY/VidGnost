"use client"

import * as React from "react"
import {
  Upload,
  Video,
  FileVideo,
  Play,
  Clock,
  HardDrive,
  Sparkles,
  ArrowRight,
  FileText,
  MessageSquareText,
  ChevronRight,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

type WorkflowType = "notes" | "vqa"

interface VideoFile {
  id: string
  name: string
  size: number
  duration: string
  thumbnail?: string
}

interface NewTaskViewProps {
  selectedWorkflow: WorkflowType
  onStartTask: (files: VideoFile[], workflow: WorkflowType) => void
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
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

export function NewTaskView({ selectedWorkflow, onStartTask }: NewTaskViewProps) {
  const [isDragging, setIsDragging] = React.useState(false)
  const [uploadedFiles, setUploadedFiles] = React.useState<VideoFile[]>([])
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const [isUploading, setIsUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("video/")
    )
    if (files.length > 0) {
      simulateUpload(files)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      simulateUpload(files)
    }
  }

  const simulateUpload = (files: File[]) => {
    setIsUploading(true)
    setUploadProgress(0)

    // 模拟上传进度
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          setIsUploading(false)
          // 添加文件到列表
          const newFiles: VideoFile[] = files.map((f, index) => ({
            id: `file-${Date.now()}-${index}`,
            name: f.name,
            size: f.size,
            duration: "12:34", // 模拟时长
          }))
          setUploadedFiles((prev) => [...prev, ...newFiles])
          return 0
        }
        return prev + 10
      })
    }, 100)
  }

  const removeFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  const steps = workflowSteps[selectedWorkflow]

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-5xl mx-auto p-6 space-y-8">
        {/* 页面标题 */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">新建分析任务</h1>
          <p className="text-muted-foreground">
            导入视频文件，开始{selectedWorkflow === "notes" ? "笔记整理" : "视频问答"}分析流程
          </p>
        </div>

        {/* 工作流概览 */}
        <Card>
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
                ? "自动转写视频内容，生成结构化笔记和思维导图"
                : "构建语义索引，支持自然语言检索视频片段"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {steps.map((step, index) => (
                <React.Fragment key={step.id}>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {step.id}
                    </div>
                    <div className="text-sm">
                      <div className="font-medium">{step.name}</div>
                      <div className="text-xs text-muted-foreground hidden sm:block">
                        {step.description}
                      </div>
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </React.Fragment>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 文件上传区域 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">导入视频文件</CardTitle>
            <CardDescription>
              支持 MP4、MOV、AVI、MKV 等常见视频格式
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 拖拽上传区域 */}
            <div
              className={cn(
                "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
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
              
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
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
                <p className="mt-1 text-xs text-muted-foreground">
                  支持批量导入，单个文件最大 10GB
                </p>
              </div>

              {/* 上传进度 */}
              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
                  <div className="w-64 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>正在导入...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} />
                  </div>
                </div>
              )}
            </div>

            {/* 已上传文件列表 */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <Separator />
                <div className="text-sm font-medium">
                  已选择 {uploadedFiles.length} 个文件
                </div>
                <div className="space-y-2">
                  {uploadedFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 rounded-lg border bg-card p-3"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <FileVideo className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {file.name}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <HardDrive className="h-3 w-3" />
                            {formatFileSize(file.size)}
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
                        onClick={() => removeFile(file.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 开始按钮 */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {uploadedFiles.length > 0 ? (
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                准备就绪，点击开始分析
              </span>
            ) : (
              "请先导入视频文件"
            )}
          </div>
          <Button
            size="lg"
            disabled={uploadedFiles.length === 0}
            onClick={() => onStartTask(uploadedFiles, selectedWorkflow)}
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
