"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  Cpu,
  FileCode,
  Palette,
  Globe,
  Plus,
  Trash2,
  Edit2,
  Save,
  RefreshCw,
  HardDrive,
  Zap,
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
import { cn } from "@/lib/utils"
import {
  createPromptTemplate,
  deletePromptTemplate,
  getApiErrorMessage,
  getModels,
  getPromptTemplates,
  getWhisperConfig,
  reloadModels,
  updateModel,
  updatePromptSelection,
  updatePromptTemplate,
  updateWhisperConfig,
} from "@/lib/api"
import { formatBytes } from "@/lib/format"
import type {
  ModelDescriptor,
  PromptTemplateBundleResponse,
  PromptTemplateChannel,
  PromptTemplateItem,
  UISettingsResponse,
  WhisperConfigResponse,
} from "@/lib/types"

interface SettingsViewProps {
  uiSettings: UISettingsResponse
  onUiSettingsChange: (patch: Partial<UISettingsResponse>) => Promise<UISettingsResponse>
}

const modelTypeLabels: Record<string, string> = {
  whisper: "语音转写",
  llm: "大语言模型",
  embedding: "嵌入模型",
  vlm: "视觉语言模型",
  rerank: "重排序模型",
}

const promptTypeLabels: Record<PromptTemplateChannel, string> = {
  correction: "文本纠错",
  notes: "笔记生成",
  mindmap: "思维导图",
  vqa: "问答检索",
}

const promptDescriptions: Record<PromptTemplateChannel, string> = {
  correction: "用于纠正语音转写中的错别字、标点和术语错误。",
  notes: "将转写内容整理为结构化笔记输出。",
  mindmap: "将内容组织为思维导图结构。",
  vqa: "用于视频问答与检索回答生成。",
}

const EMPTY_PROMPT_FORM = {
  channel: "correction" as PromptTemplateChannel,
  name: "",
  content: "",
}

export function SettingsView({ uiSettings, onUiSettingsChange }: SettingsViewProps) {
  const [activeSection, setActiveSection] = React.useState("models")
  const [fontSize, setFontSize] = React.useState([uiSettings.font_size])
  const [models, setModels] = React.useState<ModelDescriptor[]>([])
  const [promptBundle, setPromptBundle] = React.useState<PromptTemplateBundleResponse | null>(null)
  const [whisperConfig, setWhisperConfig] = React.useState<WhisperConfigResponse | null>(null)
  const [isPromptDialogOpen, setIsPromptDialogOpen] = React.useState(false)
  const [editingPrompt, setEditingPrompt] = React.useState<PromptTemplateItem | null>(null)
  const [promptForm, setPromptForm] = React.useState(EMPTY_PROMPT_FORM)
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyModelId, setBusyModelId] = React.useState("")
  const [isSavingPrompt, setIsSavingPrompt] = React.useState(false)
  const [isSavingUi, setIsSavingUi] = React.useState(false)
  const [isUpdatingWhisper, setIsUpdatingWhisper] = React.useState(false)

  React.useEffect(() => {
    setFontSize([uiSettings.font_size])
  }, [uiSettings.font_size])

  const loadSettings = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [modelsResponse, promptResponse, whisperResponse] = await Promise.all([
        getModels(),
        getPromptTemplates(),
        getWhisperConfig(),
      ])
      setModels(modelsResponse.items)
      setPromptBundle(promptResponse)
      setWhisperConfig(whisperResponse)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "加载设置数据失败"))
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const sections = [
    { id: "models", label: "模型配置", icon: Cpu },
    { id: "prompts", label: "提示词模板", icon: FileCode },
    { id: "appearance", label: "外观设置", icon: Palette },
    { id: "language", label: "语言设置", icon: Globe },
  ]

  const getStatusBadge = (status: ModelDescriptor["status"]) => {
    switch (status) {
      case "ready":
        return <Badge variant="default" className="bg-status-success text-white">就绪</Badge>
      case "loading":
        return <Badge variant="secondary" className="bg-status-processing text-white">加载中</Badge>
      case "error":
        return <Badge variant="destructive">错误</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const handleReloadModel = async (modelId?: string) => {
    setBusyModelId(modelId || "__all__")
    try {
      const response = await reloadModels(modelId)
      setModels(response.items)
      toast.success(modelId ? "模型已重载" : "模型列表已刷新")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "重载模型失败"))
    } finally {
      setBusyModelId("")
    }
  }

  const handleConfigureModel = async (model: ModelDescriptor) => {
    const nextPath = window.prompt("请输入模型本地路径：", model.path || "")
    if (nextPath === null) {
      return
    }

    setBusyModelId(model.id)
    try {
      const response = await updateModel(model.id, { path: nextPath.trim() })
      setModels(response.items)
      toast.success("模型路径已更新")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "更新模型配置失败"))
    } finally {
      setBusyModelId("")
    }
  }

  const handlePromptDialogChange = (open: boolean) => {
    setIsPromptDialogOpen(open)
    if (!open) {
      setEditingPrompt(null)
      setPromptForm(EMPTY_PROMPT_FORM)
    }
  }

  const handleCreatePromptClick = () => {
    setEditingPrompt(null)
    setPromptForm(EMPTY_PROMPT_FORM)
  }

  const handleEditPromptClick = (prompt: PromptTemplateItem) => {
    setEditingPrompt(prompt)
    setPromptForm({
      channel: prompt.channel,
      name: prompt.name,
      content: prompt.content,
    })
    setIsPromptDialogOpen(true)
  }

  const handleSavePrompt = async () => {
    if (!promptForm.name.trim() || !promptForm.content.trim()) {
      toast.error("模板名称和内容不能为空")
      return
    }

    setIsSavingPrompt(true)
    try {
      let nextBundle: PromptTemplateBundleResponse
      let targetTemplateId = editingPrompt?.id || ""

      if (editingPrompt) {
        nextBundle = await updatePromptTemplate(editingPrompt.id, {
          name: promptForm.name.trim(),
          content: promptForm.content.trim(),
        })
      } else {
        nextBundle = await createPromptTemplate({
          channel: promptForm.channel,
          name: promptForm.name.trim(),
          content: promptForm.content.trim(),
        })
        const createdTemplates = nextBundle.templates
          .filter(
            (item) =>
              item.channel === promptForm.channel &&
              item.name === promptForm.name.trim() &&
              item.content === promptForm.content.trim(),
          )
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        targetTemplateId = createdTemplates[0]?.id || ""
      }

      if (targetTemplateId) {
        nextBundle = await updatePromptSelection({ [promptForm.channel]: targetTemplateId })
      }

      setPromptBundle(nextBundle)
      handlePromptDialogChange(false)
      toast.success(editingPrompt ? "模板已更新" : "模板已创建")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "保存模板失败"))
    } finally {
      setIsSavingPrompt(false)
    }
  }

  const handleDeletePrompt = async (prompt: PromptTemplateItem) => {
    if (prompt.is_default) {
      return
    }

    try {
      const nextBundle = await deletePromptTemplate(prompt.id)
      setPromptBundle(nextBundle)
      toast.success("模板已删除")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "删除模板失败"))
    }
  }

  const handleUiSettingChange = async (patch: Partial<UISettingsResponse>, successMessage?: string) => {
    setIsSavingUi(true)
    try {
      await onUiSettingsChange(patch)
      if (successMessage) {
        toast.success(successMessage)
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "保存界面设置失败"))
      setFontSize([uiSettings.font_size])
    } finally {
      setIsSavingUi(false)
    }
  }

  const handleGpuToggle = async (checked: boolean) => {
    if (!whisperConfig) {
      return
    }

    setIsUpdatingWhisper(true)
    try {
      const saved = await updateWhisperConfig({
        model_default: whisperConfig.model_default,
        language: whisperConfig.language,
        device: checked ? "auto" : "cpu",
        compute_type: whisperConfig.compute_type,
        model_load_profile: whisperConfig.model_load_profile,
        beam_size: whisperConfig.beam_size,
        vad_filter: whisperConfig.vad_filter,
        chunk_seconds: whisperConfig.chunk_seconds,
        target_sample_rate: whisperConfig.target_sample_rate,
        target_channels: whisperConfig.target_channels,
      })
      setWhisperConfig(saved)
      toast.success(checked ? "已切换为自动 GPU 模式" : "已切换为 CPU 模式")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "更新 Whisper 配置失败"))
    } finally {
      setIsUpdatingWhisper(false)
    }
  }

  const gpuAcceleration = whisperConfig ? whisperConfig.device !== "cpu" : false

  return (
    <div className="flex-1 overflow-auto">
      <div className="container max-w-5xl mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">设置中心</h1>
          <p className="text-muted-foreground">
            配置模型、提示词模板和应用外观
          </p>
        </div>

        <div className="flex gap-6">
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
                      : "hover:bg-muted",
                  )}
                >
                  <section.icon className="h-4 w-4" />
                  {section.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex-1 space-y-6">
            {activeSection === "models" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">本地模型配置</CardTitle>
                  <CardDescription>
                    管理用于视频分析的各类本地 AI 模型
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Zap className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium">GPU 加速</div>
                        <div className="text-sm text-muted-foreground">
                          通过 Whisper 运行设备配置控制 GPU/CPU 推理
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={gpuAcceleration}
                      disabled={!whisperConfig || isUpdatingWhisper}
                      onCheckedChange={(checked) => {
                        void handleGpuToggle(checked)
                      }}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    {models.map((model) => (
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
                            <Badge variant="outline">{modelTypeLabels[model.component]}</Badge>
                            <span className="flex items-center gap-1">
                              <HardDrive className="h-3 w-3" />
                              {model.size_bytes > 0 ? formatBytes(model.size_bytes) : "未记录"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {model.path || model.model_id}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyModelId === model.id}
                            onClick={() => {
                              void handleReloadModel(model.id)
                            }}
                          >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            重载
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyModelId === model.id}
                            onClick={() => {
                              void handleConfigureModel(model)
                            }}
                          >
                            配置
                          </Button>
                        </div>
                      </div>
                    ))}
                    {models.length === 0 && !isLoading && (
                      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                        当前没有可展示的模型配置
                      </div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      toast.message("当前后端提供模型重载与路径更新，暂不支持新增模型条目。")
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    添加模型
                  </Button>
                </CardContent>
              </Card>
            )}

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
                    <Dialog open={isPromptDialogOpen} onOpenChange={handlePromptDialogChange}>
                      <DialogTrigger asChild>
                        <Button onClick={handleCreatePromptClick}>
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
                              <Input
                                placeholder="输入模板名称"
                                value={promptForm.name}
                                onChange={(event) =>
                                  setPromptForm((current) => ({ ...current, name: event.target.value }))
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>模板类型</Label>
                              <Select
                                value={promptForm.channel}
                                onValueChange={(value) =>
                                  setPromptForm((current) => ({
                                    ...current,
                                    channel: value as PromptTemplateChannel,
                                  }))
                                }
                                disabled={Boolean(editingPrompt)}
                              >
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
                            <Label>模板说明</Label>
                            <Input value={promptDescriptions[promptForm.channel]} readOnly />
                          </div>
                          <div className="space-y-2">
                            <Label>提示词内容</Label>
                            <Textarea
                              placeholder="输入提示词内容，使用 {text} 作为输入文本占位符"
                              className="min-h-[200px] font-mono text-sm"
                              value={promptForm.content}
                              onChange={(event) =>
                                setPromptForm((current) => ({ ...current, content: event.target.value }))
                              }
                            />
                            <p className="text-xs text-muted-foreground">
                              使用 {"{text}"} 表示输入文本，{"{context}"} 表示上下文信息
                            </p>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => handlePromptDialogChange(false)}>
                            取消
                          </Button>
                          <Button disabled={isSavingPrompt} onClick={() => void handleSavePrompt()}>
                            <Save className="h-4 w-4 mr-2" />
                            保存
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {promptBundle?.templates.map((prompt) => {
                    const isSelected = promptBundle.selection[prompt.channel] === prompt.id
                    return (
                      <div key={prompt.id} className="rounded-lg border p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{prompt.name}</span>
                              <Badge variant="outline">{promptTypeLabels[prompt.channel]}</Badge>
                              {isSelected && <Badge>当前生效</Badge>}
                              {prompt.is_default && <Badge variant="secondary">默认</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {promptDescriptions[prompt.channel]}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={prompt.is_default}
                              onClick={() => handleEditPromptClick(prompt)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              disabled={prompt.is_default}
                              onClick={() => {
                                void handleDeletePrompt(prompt)
                              }}
                            >
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
                    )
                  })}
                  {promptBundle?.templates.length === 0 && !isLoading && (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                      当前没有模板数据
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {activeSection === "appearance" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">外观设置</CardTitle>
                  <CardDescription>
                    自定义应用的视觉外观
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label>界面字体大小</Label>
                      <span className="text-sm text-muted-foreground">{fontSize[0]}px</span>
                    </div>
                    <Slider
                      value={fontSize}
                      onValueChange={setFontSize}
                      onValueCommit={(value) => {
                        void handleUiSettingChange({ font_size: value[0] }, "字体大小已保存")
                      }}
                      min={12}
                      max={20}
                      step={1}
                      className="w-full"
                      disabled={isSavingUi}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>小</span>
                      <span>默认</span>
                      <span>大</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>自动保存</Label>
                        <p className="text-sm text-muted-foreground">
                          自动保存编辑中的笔记和设置
                        </p>
                      </div>
                      <Switch
                        checked={uiSettings.auto_save}
                        disabled={isSavingUi}
                        onCheckedChange={(checked) => {
                          void handleUiSettingChange({ auto_save: checked }, "自动保存设置已更新")
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

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
                    <Select
                      value={uiSettings.language}
                      onValueChange={(value) => {
                        void handleUiSettingChange(
                          { language: value as UISettingsResponse["language"] },
                          "语言设置已保存",
                        )
                      }}
                      disabled={isSavingUi}
                    >
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
                      更改语言后会立即同步到本地 UI 设置
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
