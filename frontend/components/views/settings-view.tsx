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
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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

type ModelConfigFormState = {
  path: string
  load_profile: string
  quantization: string
  max_batch_size: string
  enabled: boolean
}

type ModelConfigField = keyof ModelConfigFormState

type ModelConfigPreset = {
  title: string
  description: string
  note?: string
  pathLabel?: string
  pathPlaceholder?: string
  quantizationLabel?: string
  quantizationPlaceholder?: string
  batchLabel?: string
  batchDescription?: string
  fields: ModelConfigField[]
}

const EMPTY_MODEL_FORM: ModelConfigFormState = {
  path: "",
  load_profile: "balanced",
  quantization: "",
  max_batch_size: "1",
  enabled: true,
}

const modelVisuals: Record<
  ModelDescriptor["component"],
  {
    icon: React.ElementType
    iconClassName: string
    surfaceClassName: string
  }
> = {
  whisper: {
    icon: Zap,
    iconClassName: "text-primary",
    surfaceClassName: "bg-primary/10",
  },
  llm: {
    icon: FileCode,
    iconClassName: "text-sky-500",
    surfaceClassName: "bg-sky-500/10",
  },
  embedding: {
    icon: Globe,
    iconClassName: "text-emerald-500",
    surfaceClassName: "bg-emerald-500/10",
  },
  vlm: {
    icon: Palette,
    iconClassName: "text-fuchsia-500",
    surfaceClassName: "bg-fuchsia-500/10",
  },
  rerank: {
    icon: RefreshCw,
    iconClassName: "text-amber-500",
    surfaceClassName: "bg-amber-500/10",
  },
}

const localLlmPreset: ModelConfigPreset = {
  title: "本地大模型配置",
  description: "管理本地 LLM 的缓存目录、加载策略和吞吐参数。",
  fields: ["path", "load_profile", "quantization", "max_batch_size", "enabled"],
  pathLabel: "模型目录",
  pathPlaceholder: "可选：指定本地 LLM 权重目录",
  quantizationLabel: "量化格式",
  quantizationPlaceholder: "如 4bit / 8bit / fp16",
  batchLabel: "最大并发批大小",
  batchDescription: "影响本地推理吞吐，数值越高占用越大。",
}

export function SettingsView({ uiSettings, onUiSettingsChange }: SettingsViewProps) {
  const [activeSection, setActiveSection] = React.useState("models")
  const [fontSize, setFontSize] = React.useState([uiSettings.font_size])
  const [models, setModels] = React.useState<ModelDescriptor[]>([])
  const [promptBundle, setPromptBundle] = React.useState<PromptTemplateBundleResponse | null>(null)
  const [whisperConfig, setWhisperConfig] = React.useState<WhisperConfigResponse | null>(null)
  const [isPromptDialogOpen, setIsPromptDialogOpen] = React.useState(false)
  const [isModelDialogOpen, setIsModelDialogOpen] = React.useState(false)
  const [editingPrompt, setEditingPrompt] = React.useState<PromptTemplateItem | null>(null)
  const [editingModel, setEditingModel] = React.useState<ModelDescriptor | null>(null)
  const [promptForm, setPromptForm] = React.useState(EMPTY_PROMPT_FORM)
  const [modelForm, setModelForm] = React.useState<ModelConfigFormState>(EMPTY_MODEL_FORM)
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyModelId, setBusyModelId] = React.useState("")
  const [isSavingPrompt, setIsSavingPrompt] = React.useState(false)
  const [isSavingModel, setIsSavingModel] = React.useState(false)
  const [isSavingUi, setIsSavingUi] = React.useState(false)
  const [isUpdatingWhisper, setIsUpdatingWhisper] = React.useState(false)
  const [pendingDeletePrompt, setPendingDeletePrompt] = React.useState<PromptTemplateItem | null>(null)

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

  const getModelVisual = (component: ModelDescriptor["component"]) => {
    return modelVisuals[component] || modelVisuals.llm
  }

  const getModelConfigPreset = (model: ModelDescriptor): ModelConfigPreset => {
    if (model.component === "whisper") {
      return {
        title: "语音转写模型配置",
        description: "调整 Faster-Whisper 模型目录与加载策略。GPU 开关在页面上方单独控制。",
        note: "建议优先保持量化格式与 GPU 设备策略一致，减少首次加载抖动。",
        fields: ["path", "load_profile", "quantization", "enabled"],
        pathLabel: "模型目录",
        pathPlaceholder: "可选：指定 Faster-Whisper 模型目录",
        quantizationLabel: "推理精度",
        quantizationPlaceholder: "如 int8 / float16 / float32",
      }
    }

    if (model.component === "llm") {
      if (model.provider === "openai_compatible") {
        return {
          title: "在线 LLM 调度配置",
          description: "当前 LLM 由兼容 OpenAI 的接口提供，这里只控制调度与启用状态。",
          note: "接口地址、模型名与 API Key 在后端 LLM 配置中维护，这里不重复编辑。",
          fields: ["load_profile", "max_batch_size", "enabled"],
          batchLabel: "请求批大小",
          batchDescription: "用于限制同一批次的请求规模，避免接口抖动。",
        }
      }
      return localLlmPreset
    }

    if (model.component === "embedding") {
      return {
        title: "向量嵌入模型配置",
        description: "控制向量化模型的缓存目录和批处理吞吐。",
        note: "嵌入模型更适合通过批大小调优吞吐，不建议频繁切换加载策略。",
        fields: ["path", "max_batch_size", "enabled"],
        pathLabel: "模型目录",
        pathPlaceholder: "可选：指定嵌入模型本地目录",
        batchLabel: "向量化批大小",
        batchDescription: "批大小越大，向量化吞吐越高，但会增加内存压力。",
      }
    }

    if (model.component === "vlm") {
      return {
        title: "视觉语言模型配置",
        description: "控制关键帧语义识别模型的本地目录、量化方式和加载策略。",
        note: "VLM 通常对显存最敏感，建议优先调低量化精度而不是提高并发。",
        fields: ["path", "load_profile", "quantization", "enabled"],
        pathLabel: "模型目录",
        pathPlaceholder: "可选：指定 VLM 模型目录",
        quantizationLabel: "权重量化",
        quantizationPlaceholder: "如 4bit / 8bit / fp16",
      }
    }

    return {
      title: "重排序模型配置",
      description: "控制 rerank 模型的本地目录和批处理规模。",
      note: "重排序阶段主要受批大小影响，适合按吞吐逐步调高。",
      fields: ["path", "max_batch_size", "enabled"],
      pathLabel: "模型目录",
      pathPlaceholder: "可选：指定 rerank 模型目录",
      batchLabel: "重排序批大小",
      batchDescription: "提升批大小可以提高吞吐，但会增加 CPU/GPU 占用。",
    }
  }

  const buildModelUpdatePayload = (model: ModelDescriptor, form: ModelConfigFormState) => {
    const preset = getModelConfigPreset(model)
    const payload: Parameters<typeof updateModel>[1] = {}

    if (preset.fields.includes("path")) {
      payload.path = form.path.trim()
    }
    if (preset.fields.includes("load_profile")) {
      payload.load_profile = form.load_profile.trim() || "balanced"
    }
    if (preset.fields.includes("quantization")) {
      payload.quantization = form.quantization.trim()
    }
    if (preset.fields.includes("max_batch_size")) {
      payload.max_batch_size = Number.parseInt(form.max_batch_size, 10) || 1
    }
    if (preset.fields.includes("enabled")) {
      payload.enabled = form.enabled
    }

    return payload
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

  const handleModelDialogChange = (open: boolean) => {
    setIsModelDialogOpen(open)
    if (!open) {
      setEditingModel(null)
      setModelForm(EMPTY_MODEL_FORM)
    }
  }

  const handleConfigureModel = (model: ModelDescriptor) => {
    setEditingModel(model)
    setModelForm({
      path: model.path || "",
      load_profile: model.load_profile || "balanced",
      quantization: model.quantization || "",
      max_batch_size: String(model.max_batch_size || 1),
      enabled: model.enabled,
    })
    setIsModelDialogOpen(true)
  }

  const handleSaveModelConfig = async () => {
    if (!editingModel) {
      return
    }

    setIsSavingModel(true)
    setBusyModelId(editingModel.id)
    try {
      const response = await updateModel(editingModel.id, buildModelUpdatePayload(editingModel, modelForm))
      setModels(response.items)
      handleModelDialogChange(false)
      toast.success("模型配置已更新")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "更新模型配置失败"))
    } finally {
      setIsSavingModel(false)
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

  const handleDeletePrompt = async () => {
    if (!pendingDeletePrompt || pendingDeletePrompt.is_default) {
      return
    }

    try {
      const nextBundle = await deletePromptTemplate(pendingDeletePrompt.id)
      setPromptBundle(nextBundle)
      setPendingDeletePrompt(null)
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
      if (saved.warnings.length > 0) {
        toast.message(saved.warnings.join(" "))
      }
      toast.success(checked ? "已切换为自动 GPU 模式" : "已切换为 CPU 模式")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "更新 Whisper 配置失败"))
    } finally {
      setIsUpdatingWhisper(false)
    }
  }

  const gpuAcceleration = whisperConfig ? whisperConfig.device !== "cpu" : false
  const activeModelPreset = editingModel ? getModelConfigPreset(editingModel) : null
  const modelDialogHasQuantization = Boolean(activeModelPreset?.fields.includes("quantization"))
  const modelDialogHasBatchSize = Boolean(activeModelPreset?.fields.includes("max_batch_size"))
  const modelDialogFieldPairCount = [modelDialogHasQuantization, modelDialogHasBatchSize].filter(Boolean).length

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
                        {whisperConfig ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            当前设备策略：{whisperConfig.device === "cpu" ? "CPU" : whisperConfig.device.toUpperCase()}
                          </div>
                        ) : null}
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
                      <div key={model.id} className="flex items-center gap-4 rounded-lg border p-4">
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                            getModelVisual(model.component).surfaceClassName,
                          )}
                        >
                          {React.createElement(getModelVisual(model.component).icon, {
                            className: cn("h-5 w-5", getModelVisual(model.component).iconClassName),
                          })}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{model.name}</span>
                            {getStatusBadge(model.status)}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <Badge variant="outline">{modelTypeLabels[model.component]}</Badge>
                            <Badge variant="secondary" className="capitalize">
                              {model.provider.replaceAll("_", " ")}
                            </Badge>
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
                              handleConfigureModel(model)
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

                  <Dialog open={isModelDialogOpen} onOpenChange={handleModelDialogChange}>
                    <DialogContent className="max-w-xl">
                      <DialogHeader>
                        <DialogTitle>{activeModelPreset?.title || "模型常用配置"}</DialogTitle>
                        <DialogDescription>
                          {activeModelPreset?.description || "更新模型配置。"}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        {editingModel ? (
                          <div className="rounded-xl border bg-muted/40 p-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={cn(
                                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                                  getModelVisual(editingModel.component).surfaceClassName,
                                )}
                              >
                                {React.createElement(getModelVisual(editingModel.component).icon, {
                                  className: cn("h-5 w-5", getModelVisual(editingModel.component).iconClassName),
                                })}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium">{editingModel.name}</div>
                                <div className="truncate text-xs text-muted-foreground">{editingModel.model_id}</div>
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                              <div className="rounded-lg border bg-background/80 px-3 py-2">
                                <div className="mb-1 text-[11px] uppercase tracking-[0.18em]">Provider</div>
                                <div className="text-sm text-foreground">{editingModel.provider.replaceAll("_", " ")}</div>
                              </div>
                              <div className="rounded-lg border bg-background/80 px-3 py-2">
                                <div className="mb-1 text-[11px] uppercase tracking-[0.18em]">Component</div>
                                <div className="text-sm text-foreground">{modelTypeLabels[editingModel.component]}</div>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {activeModelPreset?.note ? (
                          <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
                            {activeModelPreset.note}
                          </div>
                        ) : null}

                        {activeModelPreset?.fields.includes("path") ? (
                          <div className="space-y-2">
                            <Label htmlFor="model-path">{activeModelPreset.pathLabel || "本地路径"}</Label>
                            <Input
                              id="model-path"
                              placeholder={activeModelPreset.pathPlaceholder || "可选：指定模型缓存目录或本地模型目录"}
                              value={modelForm.path}
                              onChange={(event) =>
                                setModelForm((current) => ({ ...current, path: event.target.value }))
                              }
                            />
                          </div>
                        ) : null}

                        {activeModelPreset?.fields.includes("load_profile") ? (
                          <div className="space-y-2">
                            <Label>加载策略</Label>
                            <Select
                              value={modelForm.load_profile}
                              onValueChange={(value) =>
                                setModelForm((current) => ({ ...current, load_profile: value }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="balanced">balanced</SelectItem>
                                <SelectItem value="memory_first">memory_first</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        {modelDialogFieldPairCount > 0 ? (
                          <div className={cn("grid gap-4", modelDialogFieldPairCount > 1 ? "grid-cols-2" : "grid-cols-1")}>
                            {modelDialogHasQuantization ? (
                              <div className="space-y-2">
                                <Label htmlFor="model-quantization">
                                  {activeModelPreset?.quantizationLabel || "量化格式"}
                                </Label>
                                <Input
                                  id="model-quantization"
                                  placeholder={activeModelPreset?.quantizationPlaceholder || "如 int8 / 4bit / fp16"}
                                  value={modelForm.quantization}
                                  onChange={(event) =>
                                    setModelForm((current) => ({
                                      ...current,
                                      quantization: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                            ) : null}
                            {modelDialogHasBatchSize ? (
                              <div className="space-y-2">
                                <Label htmlFor="model-max-batch">
                                  {activeModelPreset?.batchLabel || "最大批大小"}
                                </Label>
                                <Input
                                  id="model-max-batch"
                                  type="number"
                                  min={1}
                                  max={64}
                                  value={modelForm.max_batch_size}
                                  onChange={(event) =>
                                    setModelForm((current) => ({
                                      ...current,
                                      max_batch_size: event.target.value,
                                    }))
                                  }
                                />
                                {activeModelPreset?.batchDescription ? (
                                  <p className="text-xs text-muted-foreground">{activeModelPreset.batchDescription}</p>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {activeModelPreset?.fields.includes("enabled") ? (
                          <div className="flex items-end justify-between rounded-lg border px-4 py-3">
                            <div>
                              <Label>启用状态</Label>
                              <p className="text-xs text-muted-foreground">关闭后模型不会参与运行链路。</p>
                            </div>
                            <Switch
                              checked={modelForm.enabled}
                              onCheckedChange={(checked) =>
                                setModelForm((current) => ({ ...current, enabled: checked }))
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => handleModelDialogChange(false)}>
                          取消
                        </Button>
                        <Button disabled={isSavingModel} onClick={() => void handleSaveModelConfig()}>
                          <Save className="mr-2 h-4 w-4" />
                          保存配置
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
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
                                setPendingDeletePrompt(prompt)
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
      <ConfirmDialog
        open={Boolean(pendingDeletePrompt)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeletePrompt(null)
          }
        }}
        title="确认删除提示词模板？"
        description={
          pendingDeletePrompt
            ? `删除后将移除模板“${pendingDeletePrompt.name}”，当前流程会改用其他可用模板。`
            : "删除后无法恢复。"
        }
        confirmLabel="确认删除"
        confirmVariant="destructive"
        onConfirm={() => {
          void handleDeletePrompt()
        }}
      />
    </div>
  )
}
