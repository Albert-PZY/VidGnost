"use client"

import * as React from "react"
import {
  Cpu,
  FileCode,
  Palette,
  Globe,
  ChevronRight,
  Check,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  RefreshCw,
  HardDrive,
  Zap,
  AlertCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { cn } from "@/lib/utils"

interface ModelConfig {
  id: string
  name: string
  type: "whisper" | "llm" | "embedding" | "vlm" | "rerank"
  path: string
  status: "ready" | "loading" | "error"
  size?: string
}

interface PromptTemplate {
  id: string
  name: string
  description: string
  content: string
  type: "correction" | "notes" | "mindmap" | "vqa"
}

const mockModels: ModelConfig[] = [
  { id: "1", name: "FasterWhisper Large-v3", type: "whisper", path: "/models/whisper-large-v3", status: "ready", size: "2.87 GB" },
  { id: "2", name: "Qwen2.5-7B-Instruct", type: "llm", path: "/models/qwen2.5-7b", status: "ready", size: "14.2 GB" },
  { id: "3", name: "BGE-M3", type: "embedding", path: "/models/bge-m3", status: "ready", size: "1.24 GB" },
  { id: "4", name: "Qwen2-VL-7B", type: "vlm", path: "/models/qwen2-vl-7b", status: "loading", size: "15.8 GB" },
  { id: "5", name: "BGE-Reranker-v2-m3", type: "rerank", path: "/models/bge-reranker", status: "ready", size: "568 MB" },
]

const mockPrompts: PromptTemplate[] = [
  {
    id: "1",
    name: "转写纠错",
    description: "用于纠正语音转写中的错误",
    content: "你是一个专业的文本纠错助手。请检查以下转写文本，纠正其中的错别字、语法错误和标点符号问题，保持原意不变。\n\n转写文本：\n{text}",
    type: "correction",
  },
  {
    id: "2",
    name: "笔记生成",
    description: "将转写内容整理为结构化笔记",
    content: "请将以下视频转写内容整理为结构化笔记，包含：\n1. 核心主题\n2. 主要观点（分点列出）\n3. 关键词\n4. 总结\n\n转写内容：\n{text}",
    type: "notes",
  },
  {
    id: "3",
    name: "思维导图",
    description: "生成 Markdown 格式的思维导图",
    content: "请将以下内容整理为 Markdown 格式的思维导图结构，使用标题层级表示节点关系。\n\n内容：\n{text}",
    type: "mindmap",
  },
]

const modelTypeLabels: Record<string, string> = {
  whisper: "语音转写",
  llm: "大语言模型",
  embedding: "嵌入模型",
  vlm: "视觉语言模型",
  rerank: "重排序模型",
}

const promptTypeLabels: Record<string, string> = {
  correction: "文本纠错",
  notes: "笔记生成",
  mindmap: "思维导图",
  vqa: "问答检索",
}

export function SettingsView() {
  const [activeSection, setActiveSection] = React.useState("models")
  const [fontSize, setFontSize] = React.useState([14])
  const [language, setLanguage] = React.useState("zh")
  const [autoSave, setAutoSave] = React.useState(true)
  const [gpuAcceleration, setGpuAcceleration] = React.useState(true)
  
  // 提示词模板编辑状态
  const [editingPrompt, setEditingPrompt] = React.useState<PromptTemplate | null>(null)
  const [isPromptDialogOpen, setIsPromptDialogOpen] = React.useState(false)

  const sections = [
    { id: "models", label: "模型配置", icon: Cpu },
    { id: "prompts", label: "提示词模板", icon: FileCode },
    { id: "appearance", label: "外观设置", icon: Palette },
    { id: "language", label: "语言设置", icon: Globe },
  ]

  const getStatusBadge = (status: ModelConfig["status"]) => {
    switch (status) {
      case "ready":
        return <Badge variant="default" className="bg-status-success text-white">就绪</Badge>
      case "loading":
        return <Badge variant="secondary" className="bg-status-processing text-white">加载中</Badge>
      case "error":
        return <Badge variant="destructive">错误</Badge>
    }
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-5xl mx-auto p-6 space-y-6">
        {/* 页面标题 */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">设置中心</h1>
          <p className="text-muted-foreground">
            配置模型、提示词模板和应用外观
          </p>
        </div>

        <div className="flex gap-6">
          {/* 侧边导航 */}
          <div className="w-48 shrink-0">
            <nav className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                    activeSection === section.id
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  )}
                >
                  <section.icon className="h-4 w-4" />
                  {section.label}
                </button>
              ))}
            </nav>
          </div>

          {/* 内容区 */}
          <div className="flex-1 space-y-6">
            {/* 模型配置 */}
            {activeSection === "models" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">本地模型配置</CardTitle>
                  <CardDescription>
                    管理用于视频分析的各类本地 AI 模型
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* GPU 加速开关 */}
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Zap className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">GPU 加速</div>
                        <div className="text-sm text-muted-foreground">
                          使用 CUDA 加速模型推理
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={gpuAcceleration}
                      onCheckedChange={setGpuAcceleration}
                    />
                  </div>

                  <Separator />

                  {/* 模型列表 */}
                  <div className="space-y-3">
                    {mockModels.map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center gap-4 rounded-lg border p-4"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Cpu className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{model.name}</span>
                            {getStatusBadge(model.status)}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <Badge variant="outline">{modelTypeLabels[model.type]}</Badge>
                            <span className="flex items-center gap-1">
                              <HardDrive className="h-3 w-3" />
                              {model.size}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {model.path}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm">
                            <RefreshCw className="h-4 w-4 mr-1" />
                            重载
                          </Button>
                          <Button variant="outline" size="sm">
                            配置
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button variant="outline" className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    添加模型
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* 提示词模板 */}
            {activeSection === "prompts" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">提示词模板</CardTitle>
                      <CardDescription>
                        自定义 LLM 处理各环节的提示词
                      </CardDescription>
                    </div>
                    <Dialog open={isPromptDialogOpen} onOpenChange={setIsPromptDialogOpen}>
                      <DialogTrigger asChild>
                        <Button onClick={() => setEditingPrompt(null)}>
                          <Plus className="h-4 w-4 mr-2" />
                          新建模板
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>
                            {editingPrompt ? "编辑提示词模板" : "新建提示词模板"}
                          </DialogTitle>
                          <DialogDescription>
                            配置用于特定任务的提示词模板
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>模板名称</Label>
                              <Input placeholder="输入模板名称" defaultValue={editingPrompt?.name} />
                            </div>
                            <div className="space-y-2">
                              <Label>模板类型</Label>
                              <Select defaultValue={editingPrompt?.type || "correction"}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="correction">文本纠错</SelectItem>
                                  <SelectItem value="notes">笔记生成</SelectItem>
                                  <SelectItem value="mindmap">思维导图</SelectItem>
                                  <SelectItem value="vqa">问答检索</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>模板描述</Label>
                            <Input placeholder="简要描述模板用途" defaultValue={editingPrompt?.description} />
                          </div>
                          <div className="space-y-2">
                            <Label>提示词内容</Label>
                            <Textarea
                              placeholder="输入提示词内容，使用 {text} 作为输入文本占位符"
                              className="min-h-[200px] font-mono text-sm"
                              defaultValue={editingPrompt?.content}
                            />
                            <p className="text-xs text-muted-foreground">
                              使用 {"{text}"} 表示输入文本，{"{context}"} 表示上下文信息
                            </p>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsPromptDialogOpen(false)}>
                            取消
                          </Button>
                          <Button onClick={() => setIsPromptDialogOpen(false)}>
                            <Save className="h-4 w-4 mr-2" />
                            保存
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mockPrompts.map((prompt) => (
                    <div
                      key={prompt.id}
                      className="rounded-lg border p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{prompt.name}</span>
                            <Badge variant="outline">{promptTypeLabels[prompt.type]}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {prompt.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setEditingPrompt(prompt)
                              setIsPromptDialogOpen(true)
                            }}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 rounded bg-muted p-3">
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                          {prompt.content}
                        </pre>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* 外观设置 */}
            {activeSection === "appearance" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">外观设置</CardTitle>
                  <CardDescription>
                    自定义应用的视觉外观
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* 字体大小 */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label>界面字体大小</Label>
                      <span className="text-sm text-muted-foreground">{fontSize[0]}px</span>
                    </div>
                    <Slider
                      value={fontSize}
                      onValueChange={setFontSize}
                      min={12}
                      max={20}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>小</span>
                      <span>默认</span>
                      <span>大</span>
                    </div>
                  </div>

                  <Separator />

                  {/* 其他设置 */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>自动保存</Label>
                        <p className="text-sm text-muted-foreground">
                          自动保存编辑中的笔记和设置
                        </p>
                      </div>
                      <Switch checked={autoSave} onCheckedChange={setAutoSave} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 语言设置 */}
            {activeSection === "language" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">语言设置</CardTitle>
                  <CardDescription>
                    选择界面显示语言
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>界面语言</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger className="w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zh">
                          <div className="flex items-center gap-2">
                            <span>中文 (简体)</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="en">
                          <div className="flex items-center gap-2">
                            <span>English</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      更改语言后需要重启应用生效
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
