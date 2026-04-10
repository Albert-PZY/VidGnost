"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import {
  CloudDownload,
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
import { Progress } from "@/components/ui/progress"
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
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  cancelModelDownload,
  createPromptTemplate,
  deletePromptTemplate,
  getApiErrorMessage,
  getLLMConfig,
  getModels,
  getPromptTemplates,
  getWhisperConfig,
  reloadModels,
  startModelDownload,
  updateLLMConfig,
  updateModel,
  updatePromptSelection,
  updatePromptTemplate,
  updateWhisperConfig,
} from "@/lib/api"
import { formatBytes } from "@/lib/format"
import type {
  LLMConfigResponse,
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

const modelTypeTagClassNames: Record<string, string> = {
  whisper: "border-indigo-800/75 text-indigo-700 dark:border-indigo-400/55 dark:text-indigo-300",
  llm: "border-cyan-800/75 text-cyan-700 dark:border-cyan-400/55 dark:text-cyan-300",
  embedding: "border-emerald-800/75 text-emerald-700 dark:border-emerald-400/55 dark:text-emerald-300",
  vlm: "border-rose-800/75 text-rose-700 dark:border-rose-400/55 dark:text-rose-300",
  rerank: "border-amber-800/75 text-amber-700 dark:border-amber-400/55 dark:text-amber-300",
}

const promptTagClassNames: Record<PromptTemplateChannel, string> = {
  correction: "border-rose-800/75 text-rose-700 dark:border-rose-400/55 dark:text-rose-300",
  notes: "border-amber-800/75 text-amber-700 dark:border-amber-400/55 dark:text-amber-300",
  mindmap: "border-violet-800/75 text-violet-700 dark:border-violet-400/55 dark:text-violet-300",
  vqa: "border-teal-800/75 text-teal-700 dark:border-teal-400/55 dark:text-teal-300",
}

const themeHuePresets = [
  { label: "青蓝", value: 220 },
  { label: "冰川", value: 200 },
  { label: "青绿", value: 170 },
  { label: "琥珀", value: 95 },
  { label: "珊瑚", value: 30 },
  { label: "靛蓝", value: 260 },
] as const
const DEFAULT_THEME_HUE = themeHuePresets[0].value

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

type LLMConfigFormState = {
  base_url: string
  api_key: string
  model: string
  correction_mode: LLMConfigResponse["correction_mode"]
  correction_batch_size: string
  correction_overlap: string
}

const EMPTY_LLM_FORM: LLMConfigFormState = {
  base_url: "",
  api_key: "",
  model: "",
  correction_mode: "strict",
  correction_batch_size: "24",
  correction_overlap: "3",
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
    icon: Cpu,
    iconClassName: "text-primary",
    surfaceClassName: "bg-primary/10",
  },
  llm: {
    icon: Cpu,
    iconClassName: "text-primary",
    surfaceClassName: "bg-primary/10",
  },
  embedding: {
    icon: Cpu,
    iconClassName: "text-primary",
    surfaceClassName: "bg-primary/10",
  },
  vlm: {
    icon: Cpu,
    iconClassName: "text-primary",
    surfaceClassName: "bg-primary/10",
  },
  rerank: {
    icon: Cpu,
    iconClassName: "text-primary",
    surfaceClassName: "bg-primary/10",
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
  const [themeHue, setThemeHue] = React.useState([uiSettings.theme_hue])
  const [models, setModels] = React.useState<ModelDescriptor[]>([])
  const [promptBundle, setPromptBundle] = React.useState<PromptTemplateBundleResponse | null>(null)
  const [whisperConfig, setWhisperConfig] = React.useState<WhisperConfigResponse | null>(null)
  const [llmConfig, setLlmConfig] = React.useState<LLMConfigResponse | null>(null)
  const [isPromptDialogOpen, setIsPromptDialogOpen] = React.useState(false)
  const [isModelDialogOpen, setIsModelDialogOpen] = React.useState(false)
  const [editingPrompt, setEditingPrompt] = React.useState<PromptTemplateItem | null>(null)
  const [editingModel, setEditingModel] = React.useState<ModelDescriptor | null>(null)
  const [promptForm, setPromptForm] = React.useState(EMPTY_PROMPT_FORM)
  const [modelForm, setModelForm] = React.useState<ModelConfigFormState>(EMPTY_MODEL_FORM)
  const [llmForm, setLlmForm] = React.useState<LLMConfigFormState>(EMPTY_LLM_FORM)
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyModelId, setBusyModelId] = React.useState("")
  const [isSavingPrompt, setIsSavingPrompt] = React.useState(false)
  const [isSavingModel, setIsSavingModel] = React.useState(false)
  const [isSavingUi, setIsSavingUi] = React.useState(false)
  const [isUpdatingWhisper, setIsUpdatingWhisper] = React.useState(false)
  const [pendingDeletePrompt, setPendingDeletePrompt] = React.useState<PromptTemplateItem | null>(null)
  const [isDeletingPrompt, setIsDeletingPrompt] = React.useState(false)

  React.useEffect(() => {
    setFontSize([uiSettings.font_size])
  }, [uiSettings.font_size])

  React.useEffect(() => {
    setThemeHue([uiSettings.theme_hue])
  }, [uiSettings.theme_hue])

  React.useEffect(() => {
    const activeHue = themeHue[0] ?? uiSettings.theme_hue
    document.documentElement.style.setProperty("--theme-hue", String(activeHue))
    return () => {
      document.documentElement.style.setProperty("--theme-hue", String(uiSettings.theme_hue))
    }
  }, [themeHue, uiSettings.theme_hue])

  const loadSettings = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [modelsResponse, promptResponse, whisperResponse, llmResponse] = await Promise.all([
        getModels(),
        getPromptTemplates(),
        getWhisperConfig(),
        getLLMConfig(),
      ])
      setModels(modelsResponse.items)
      setPromptBundle(promptResponse)
      setWhisperConfig(whisperResponse)
      setLlmConfig(llmResponse)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "加载设置数据失败"))
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  React.useEffect(() => {
    if (!models.some((model) => model.download?.state === "downloading")) {
      return
    }
    const timer = window.setInterval(() => {
      void getModels()
        .then((response) => {
          setModels(response.items)
        })
        .catch(() => {
          // Download polling is best-effort; surface errors through explicit user actions instead.
        })
    }, 1200)
    return () => {
      window.clearInterval(timer)
    }
  }, [models])

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
      case "not_ready":
        return <Badge variant="outline">未就绪</Badge>
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
          description: "在线模型通过兼容 OpenAI 的接口调用，这里可同时维护接口参数与运行调度。",
          note: "保存时会同时更新在线接口配置与该模型条目的启用状态、调度策略。",
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

  const buildLlmUpdatePayload = (): LLMConfigResponse | null => {
    if (!llmConfig) {
      return null
    }
    const parsedBatchSize = Number.parseInt(llmForm.correction_batch_size, 10)
    const parsedOverlap = Number.parseInt(llmForm.correction_overlap, 10)
    return {
      ...llmConfig,
      base_url: llmForm.base_url.trim(),
      api_key: llmForm.api_key.trim(),
      model: llmForm.model.trim(),
      correction_mode: llmForm.correction_mode,
      correction_batch_size: Number.isFinite(parsedBatchSize) ? parsedBatchSize : llmConfig.correction_batch_size,
      correction_overlap: Number.isFinite(parsedOverlap) ? parsedOverlap : llmConfig.correction_overlap,
      load_profile: modelForm.load_profile === "memory_first" ? "memory_first" : "balanced",
    }
  }

  const handleReloadModel = async (modelId?: string) => {
    setBusyModelId(modelId || "__all__")
    try {
      const response = await reloadModels(modelId)
      setModels(response.items)
      toast.success(modelId ? "模型检测状态已刷新" : "模型列表已刷新")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "重载模型失败"))
    } finally {
      setBusyModelId("")
    }
  }

  const handleManagedModelAction = async (model: ModelDescriptor) => {
    setBusyModelId(model.id)
    try {
      let response
      if (model.download?.state === "downloading") {
        response = await cancelModelDownload(model.id)
      } else if (model.is_installed) {
        response = await reloadModels(model.id)
      } else {
        response = await startModelDownload(model.id)
      }
      setModels(response.items)
      if (model.download?.state === "downloading") {
        toast.success("模型下载已取消")
      } else if (model.is_installed) {
        const refreshed = response.items.find((item) => item.id === model.id)
        if (refreshed?.is_installed) {
          toast.success("已刷新模型检测状态，当前模型文件可直接使用")
        } else {
          toast("已刷新模型检测状态，当前目录未检测到完整模型文件")
        }
      } else {
        toast.success("已开始下载模型到默认目录")
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "模型操作失败"))
    } finally {
      setBusyModelId("")
    }
  }

  const handleModelDialogChange = (open: boolean) => {
    setIsModelDialogOpen(open)
    if (!open) {
      setEditingModel(null)
      setModelForm(EMPTY_MODEL_FORM)
      setLlmForm(EMPTY_LLM_FORM)
    }
  }

  const handleConfigureModel = (model: ModelDescriptor) => {
    setEditingModel(model)
    setModelForm({
      path: model.default_path || model.path || "",
      load_profile: model.load_profile || "balanced",
      quantization: model.quantization || "",
      max_batch_size: String(model.max_batch_size || 1),
      enabled: model.enabled,
    })
    if (model.provider === "openai_compatible" && llmConfig) {
      setLlmForm({
        base_url: llmConfig.base_url,
        api_key: llmConfig.api_key,
        model: llmConfig.model,
        correction_mode: llmConfig.correction_mode,
        correction_batch_size: String(llmConfig.correction_batch_size),
        correction_overlap: String(llmConfig.correction_overlap),
      })
    } else {
      setLlmForm(EMPTY_LLM_FORM)
    }
    setIsModelDialogOpen(true)
  }

  const handleSaveModelConfig = async () => {
    if (!editingModel) {
      return
    }

    setIsSavingModel(true)
    setBusyModelId(editingModel.id)
    try {
      if (editingModel.provider === "openai_compatible") {
        const nextLlmPayload = buildLlmUpdatePayload()
        if (!nextLlmPayload) {
          throw new Error("在线 LLM 配置尚未加载完成")
        }
        const [modelsResponse, llmResponse] = await Promise.all([
          updateModel(editingModel.id, buildModelUpdatePayload(editingModel, modelForm)),
          updateLLMConfig(nextLlmPayload),
        ])
        setModels(modelsResponse.items)
        setLlmConfig(llmResponse)
      } else {
        const response = await updateModel(editingModel.id, buildModelUpdatePayload(editingModel, modelForm))
        setModels(response.items)
      }
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
    setIsPromptDialogOpen(true)
  }

  const handleEditPromptClick = (prompt: PromptTemplateItem) => {
    if (prompt.is_default) {
      toast("系统默认模板为只读模板，请新建副本后再编辑")
      return
    }

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
    if (!pendingDeletePrompt) {
      return
    }
    if (pendingDeletePrompt.is_default) {
      toast("系统默认模板不可删除")
      setPendingDeletePrompt(null)
      return
    }

    setIsDeletingPrompt(true)
    try {
      const nextBundle = await deletePromptTemplate(pendingDeletePrompt.id)
      setPromptBundle(nextBundle)
      setPendingDeletePrompt(null)
      toast.success("模板已删除")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "删除模板失败"))
    } finally {
      setIsDeletingPrompt(false)
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
      setThemeHue([uiSettings.theme_hue])
    } finally {
      setIsSavingUi(false)
    }
  }

  const handleThemeHueCommit = (nextHue: number) => {
    void handleUiSettingChange({ theme_hue: nextHue }, "主题色调已保存")
  }

  const handleThemeHueReset = () => {
    setThemeHue([DEFAULT_THEME_HUE])
    void handleUiSettingChange({ theme_hue: DEFAULT_THEME_HUE }, "主题色调已重置")
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
        toast(saved.warnings.join(" "))
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
  const showOnlineLlmFields = Boolean(editingModel?.provider === "openai_compatible")
  const isWhisperDialog = editingModel?.component === "whisper"

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">设置中心</h1>
              <p className="text-muted-foreground">配置模型、提示词模板和应用外观</p>
            </div>

            <div className="flex gap-6">
              <div className="w-48 shrink-0">
                <nav className="sticky top-6 space-y-1">
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
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

              <div className="min-w-0 flex-1 space-y-6">
            {activeSection === "models" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">模型配置</CardTitle>
                  <CardDescription>
                    管理默认模型目录、在线 LLM 接口与各类运行参数
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
                    {models.map((model) => {
                      const isDownloading = model.download?.state === "downloading"
                      const downloadPercent = Math.max(0, Math.min(100, model.download?.percent ?? 0))

                      return (
                      <div key={model.id} className="rounded-lg border p-4">
                        <div className="flex items-start gap-4">
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
                            <Badge variant="outline" className={modelTypeTagClassNames[model.component]}>{modelTypeLabels[model.component]}</Badge>
                            <Badge variant="secondary" className="capitalize">
                              {model.provider.replaceAll("_", " ")}
                            </Badge>
                            <span className="flex items-center gap-1">
                              <HardDrive className="h-3 w-3" />
                              {model.size_bytes > 0 ? formatBytes(model.size_bytes) : "未记录"}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            {model.is_installed ? model.path || model.default_path || model.model_id : "未就绪"}
                          </div>
                          {model.download?.message && !isDownloading ? (
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">
                              {model.download.message}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          {model.supports_managed_download ? (
                            isDownloading ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busyModelId === model.id}
                                onClick={() => {
                                  void handleManagedModelAction(model)
                                }}
                              >
                                取消下载
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busyModelId === model.id}
                                onClick={() => {
                                  void handleManagedModelAction(model)
                                }}
                              >
                                {model.is_installed ? (
                                  <RefreshCw className="mr-1 h-4 w-4" />
                                ) : (
                                  <CloudDownload className="mr-1 h-4 w-4" />
                                )}
                                {model.is_installed ? "刷新检测" : "下载"}
                              </Button>
                            )
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busyModelId === model.id}
                              onClick={() => {
                                void handleReloadModel(model.id)
                              }}
                            >
                              <RefreshCw className="mr-1 h-4 w-4" />
                              重载
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyModelId === model.id || isDownloading}
                            onClick={() => {
                              handleConfigureModel(model)
                            }}
                          >
                            配置
                          </Button>
                        </div>
                        </div>
                        {isDownloading ? (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                              <span className="min-w-0 truncate">
                                下载中 {Math.round(downloadPercent)}% · {model.download?.message || "正在下载模型文件..."}
                              </span>
                              <span className="shrink-0">{Math.round(downloadPercent)}%</span>
                            </div>
                            <Progress value={downloadPercent} className="h-2 bg-primary/10" indicatorClassName="download-progress-indicator" />
                          </div>
                        ) : null}
                      </div>
                    )})}
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
                      toast("当前后端提供模型重载与路径更新，暂不支持新增模型条目。")
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    添加模型
                  </Button>

                  <Dialog open={isModelDialogOpen} onOpenChange={handleModelDialogChange}>
                    <DialogContent className="flex w-[min(96vw,72rem)] max-h-[90vh] max-w-[72rem] flex-col gap-0 overflow-hidden p-0">
                      <DialogHeader className="shrink-0 border-b bg-card px-6 py-5 pr-14">
                        <DialogTitle className="text-lg font-medium leading-tight">
                          {activeModelPreset?.title || "模型常用配置"}
                        </DialogTitle>
                        <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
                          {activeModelPreset?.description || "更新模型配置。"}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="themed-thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                        <div className="grid gap-6 px-6 py-6 xl:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
                          {/* 左侧概览：集中展示当前模型身份、状态与关键指标 */}
                          <div className="space-y-5">
                            {editingModel ? (
                              <div className="rounded-xl border bg-card p-6">
                                <div className="space-y-5">
                                  <div className="flex items-start gap-4">
                                    <div
                                      className={cn(
                                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40",
                                        getModelVisual(editingModel.component).surfaceClassName,
                                      )}
                                    >
                                      {React.createElement(getModelVisual(editingModel.component).icon, {
                                        className: cn("h-5 w-5", getModelVisual(editingModel.component).iconClassName),
                                      })}
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="min-w-0 text-lg font-medium leading-tight text-foreground">
                                          {editingModel.name}
                                        </div>
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "rounded-md border bg-background/80",
                                            modelTypeTagClassNames[editingModel.component],
                                          )}
                                        >
                                          {modelTypeLabels[editingModel.component]}
                                        </Badge>
                                      </div>
                                      <div className="break-all text-xs leading-relaxed text-muted-foreground">
                                        {editingModel.model_id}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="rounded-md border bg-background/80 text-foreground/90">
                                      {`Provider · ${editingModel.provider.replaceAll("_", " ")}`}
                                    </Badge>
                                    <Badge variant="outline" className="rounded-md border bg-background/80 text-foreground/90">
                                      {`Component · ${modelTypeLabels[editingModel.component]}`}
                                    </Badge>
                                    {getStatusBadge(editingModel.status)}
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "rounded-md border bg-background/80",
                                        editingModel.is_installed
                                          ? "border-status-success/35 text-status-success"
                                          : "text-muted-foreground",
                                      )}
                                    >
                                      {editingModel.is_installed ? "已安装" : "未安装"}
                                    </Badge>
                                  </div>

                                  <div className="rounded-xl border bg-muted/30 p-4">
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                        默认目录
                                      </div>
                                      <div className="break-all text-xs leading-relaxed text-foreground/90">
                                        {editingModel.default_path || "未就绪"}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                                    <div className="rounded-xl border bg-muted/30 p-4">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                        当前启用
                                      </div>
                                      <div className="mt-2 text-base font-semibold leading-tight text-foreground">
                                        {modelForm.enabled ? "已启用" : "已停用"}
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {modelForm.enabled ? "参与运行链路" : "不会参与任务执行"}
                                      </p>
                                    </div>
                                    <div className="rounded-xl border bg-muted/30 p-4">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                        加载策略
                                      </div>
                                      <div className="mt-2 text-base font-semibold leading-tight text-foreground">
                                        {modelForm.load_profile || "balanced"}
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        决定常驻内存与响应速度的取舍
                                      </p>
                                    </div>
                                    <div className="rounded-xl border bg-muted/30 p-4">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                        量化格式
                                      </div>
                                      <div className="mt-2 text-base font-semibold leading-tight text-foreground">
                                        {modelDialogHasQuantization ? modelForm.quantization || "未设置" : "不适用"}
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        影响显存占用与推理吞吐
                                      </p>
                                    </div>
                                    <div className="rounded-xl border bg-muted/30 p-4">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                        批大小
                                      </div>
                                      <div className="mt-2 text-base font-semibold leading-tight text-foreground">
                                        {modelDialogHasBatchSize ? modelForm.max_batch_size || "1" : "默认"}
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        过高可能提升吞吐但增加资源占用
                                      </p>
                                    </div>
                                  </div>

                                  <div className="rounded-xl border bg-muted/30 p-4">
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                        当前路径
                                      </div>
                                      <div className="break-all text-xs leading-relaxed text-foreground/90">
                                        {modelForm.path || editingModel.path || editingModel.default_path || "使用默认托管目录"}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="rounded-xl border bg-muted/30 p-4">
                                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                      运行说明
                                    </div>
                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                      {activeModelPreset?.note ||
                                        "根据当前模型类型调整常用运行参数，保存后会同步到桌面端后端配置。"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* 右侧配置：按运行参数与在线接口参数分组 */}
                          <div className="space-y-6">
                            <div className="rounded-xl border bg-card p-5 md:p-6">
                              <div className="space-y-1">
                                <div className="text-base font-semibold leading-tight">常用运行参数</div>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  仅展示当前模型实际可调整的核心参数，避免无关配置干扰。
                                </p>
                              </div>

                              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                                {activeModelPreset?.fields.includes("path") ? (
                                  <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="model-path">{activeModelPreset.pathLabel || "本地路径"}</Label>
                                    <Input
                                      id="model-path"
                                      className="bg-background/80"
                                      placeholder={
                                        isWhisperDialog
                                          ? "未就绪"
                                          : activeModelPreset.pathPlaceholder || "可选：指定模型缓存目录或本地模型目录"
                                      }
                                      value={modelForm.path}
                                      readOnly={isWhisperDialog}
                                      onChange={(event) =>
                                        setModelForm((current) => ({ ...current, path: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      {isWhisperDialog
                                        ? "Whisper 模型目录由桌面端托管，点击上方“下载 / 重置”会自动写入默认目录。"
                                        : "未填写时优先使用当前已检测到的模型目录或默认托管目录。"}
                                    </p>
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
                                      <SelectTrigger className="bg-background/80">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="balanced">balanced</SelectItem>
                                        <SelectItem value="memory_first">memory_first</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      根据模型体积与硬件资源选择常驻或平衡模式。
                                    </p>
                                  </div>
                                ) : null}

                                {modelDialogHasQuantization ? (
                                  <div className="space-y-2">
                                    <Label htmlFor="model-quantization">
                                      {activeModelPreset?.quantizationLabel || "量化格式"}
                                    </Label>
                                    <Input
                                      id="model-quantization"
                                      className="bg-background/80"
                                      placeholder={activeModelPreset?.quantizationPlaceholder || "如 int8 / 4bit / fp16"}
                                      value={modelForm.quantization}
                                      onChange={(event) =>
                                        setModelForm((current) => ({
                                          ...current,
                                          quantization: event.target.value,
                                        }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      推荐与当前模型文件实际格式保持一致，避免加载异常。
                                    </p>
                                  </div>
                                ) : null}

                                {modelDialogHasBatchSize ? (
                                  <div
                                    className={cn(
                                      "space-y-2",
                                      !activeModelPreset?.fields.includes("load_profile") && !modelDialogHasQuantization
                                        ? "md:col-span-2"
                                        : "",
                                    )}
                                  >
                                    <Label htmlFor="model-max-batch">
                                      {activeModelPreset?.batchLabel || "最大批大小"}
                                    </Label>
                                    <Input
                                      id="model-max-batch"
                                      className="bg-background/80"
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
                                    <p className="text-xs text-muted-foreground">
                                      {activeModelPreset?.batchDescription || "影响同批次吞吐与资源占用。"}
                                    </p>
                                  </div>
                                ) : null}

                                {activeModelPreset?.fields.includes("enabled") ? (
                                  <div className="md:col-span-2">
                                    <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3.5">
                                      <div className="min-w-0 space-y-1">
                                        <Label className="leading-tight">启用状态</Label>
                                        <p className="text-xs leading-relaxed text-muted-foreground">
                                          关闭后模型不会参与当前运行链路，但会保留已保存的目录与参数。
                                        </p>
                                      </div>
                                      <Switch
                                        checked={modelForm.enabled}
                                        onCheckedChange={(checked) =>
                                          setModelForm((current) => ({ ...current, enabled: checked }))
                                        }
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {showOnlineLlmFields ? (
                              <div className="rounded-xl border bg-card p-5 md:p-6">
                                <div className="space-y-1">
                                  <div className="text-base font-semibold leading-tight">OpenAI 兼容接口配置</div>
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    保存后会同步写入后端在线 LLM 配置，用于实际请求 Base URL、模型名与 API Key。
                                  </p>
                                </div>

                                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                                  <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="llm-base-url">Base URL</Label>
                                    <Input
                                      id="llm-base-url"
                                      className="bg-background/80"
                                      placeholder="https://provider.example.com/v1"
                                      value={llmForm.base_url}
                                      onChange={(event) =>
                                        setLlmForm((current) => ({ ...current, base_url: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      使用兼容 OpenAI 的服务入口地址，通常以 `/v1` 结尾。
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="llm-model">模型名称</Label>
                                    <Input
                                      id="llm-model"
                                      className="bg-background/80"
                                      placeholder="如 qwen3.5-flash / gpt-4.1-mini"
                                      value={llmForm.model}
                                      onChange={(event) =>
                                        setLlmForm((current) => ({ ...current, model: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      与提供商控制台中的可调用模型名保持一致。
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="llm-api-key">API Key</Label>
                                    <Input
                                      id="llm-api-key"
                                      className="bg-background/80"
                                      type="password"
                                      placeholder="输入模型提供商的 API Key"
                                      value={llmForm.api_key}
                                      onChange={(event) =>
                                        setLlmForm((current) => ({ ...current, api_key: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      保存后将同步到后端在线模型配置文件。
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label>文本纠错模式</Label>
                                    <Select
                                      value={llmForm.correction_mode}
                                      onValueChange={(value) =>
                                        setLlmForm((current) => ({
                                          ...current,
                                          correction_mode: value as LLMConfigResponse["correction_mode"],
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="bg-background/80">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="off">off</SelectItem>
                                        <SelectItem value="strict">strict</SelectItem>
                                        <SelectItem value="rewrite">rewrite</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      控制在线纠错阶段对原文的保守程度。
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="llm-correction-batch">纠错批大小</Label>
                                    <Input
                                      id="llm-correction-batch"
                                      className="bg-background/80"
                                      type="number"
                                      min={6}
                                      max={80}
                                      value={llmForm.correction_batch_size}
                                      onChange={(event) =>
                                        setLlmForm((current) => ({
                                          ...current,
                                          correction_batch_size: event.target.value,
                                        }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      批次越大吞吐越高，但失败重试成本也会增加。
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="llm-correction-overlap">纠错重叠</Label>
                                    <Input
                                      id="llm-correction-overlap"
                                      className="bg-background/80"
                                      type="number"
                                      min={0}
                                      max={20}
                                      value={llmForm.correction_overlap}
                                      onChange={(event) =>
                                        setLlmForm((current) => ({
                                          ...current,
                                          correction_overlap: event.target.value,
                                        }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      保留相邻片段重叠上下文，减少断句边界误差。
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <DialogFooter className="shrink-0 border-t bg-card px-6 py-4">
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
                      <Button onClick={handleCreatePromptClick}>
                        <Plus className="h-4 w-4 mr-2" />
                        新建模板
                      </Button>
                      <DialogContent className="flex w-[min(92vw,56rem)] max-h-[min(88vh,54rem)] max-w-[56rem] flex-col gap-0 overflow-hidden p-0">
                        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
                          <DialogTitle>
                            {editingPrompt ? "编辑提示词模板" : "新建提示词模板"}
                          </DialogTitle>
                          <DialogDescription>
                            配置用于特定任务的提示词模板
                          </DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                          <div className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
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
                          <div className="flex items-start gap-3 rounded-xl border bg-muted/35 px-4 py-3">
                            <Badge
                              variant="outline"
                              className={cn("shrink-0", promptTagClassNames[promptForm.channel])}
                            >
                              {promptTypeLabels[promptForm.channel]}
                            </Badge>
                            <p className="text-sm text-muted-foreground">
                              {promptDescriptions[promptForm.channel]}
                            </p>
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
                        </div>
                        <DialogFooter className="shrink-0 border-t px-6 py-4">
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
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{prompt.name}</span>
                              <Badge variant="outline" className={promptTagClassNames[prompt.channel]}>
                                {promptTypeLabels[prompt.channel]}
                              </Badge>
                              {isSelected && <Badge>当前生效</Badge>}
                              {prompt.is_default && <Badge variant="secondary">默认</Badge>}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {promptDescriptions[prompt.channel]}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEditPromptClick(prompt)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => {
                                if (prompt.is_default) {
                                  toast("系统默认模板不可删除")
                                  return
                                }
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
                      <div>
                        <Label>主题色调</Label>
                        <p className="text-sm text-muted-foreground">
                          统一控制标题栏、侧栏与强调色的主色方向
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">{themeHue[0]}°</span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isSavingUi || themeHue[0] === DEFAULT_THEME_HUE}
                          onClick={handleThemeHueReset}
                        >
                          重置
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
                      {themeHuePresets.map((preset) => {
                        const isActive = Math.abs(themeHue[0] - preset.value) <= 2
                        return (
                          <button
                            key={preset.value}
                            type="button"
                            className={cn(
                              "rounded-xl border px-3 py-3 text-left transition-all",
                              isActive
                                ? "border-primary bg-primary/10 shadow-sm"
                                : "hover:border-primary/40 hover:bg-muted/60",
                            )}
                            disabled={isSavingUi}
                            onClick={() => {
                              setThemeHue([preset.value])
                              handleThemeHueCommit(preset.value)
                            }}
                          >
                            <span
                              className="mb-2 block h-8 rounded-lg border border-white/30 shadow-sm"
                              style={{
                                background: `linear-gradient(135deg, oklch(0.72 0.14 ${preset.value}) 0%, oklch(0.54 0.18 ${preset.value}) 100%)`,
                              }}
                            />
                            <span className="text-sm font-medium">{preset.label}</span>
                          </button>
                        )
                      })}
                    </div>
                    <Slider
                      value={themeHue}
                      onValueChange={setThemeHue}
                      onValueCommit={(value) => {
                        handleThemeHueCommit(value[0])
                      }}
                      min={0}
                      max={360}
                      step={1}
                      className="w-full"
                      disabled={isSavingUi}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>冷色</span>
                      <span>当前前端风格基线</span>
                      <span>暖色</span>
                    </div>
                  </div>

                  <Separator />

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
        isPending={isDeletingPrompt}
        onConfirm={() => {
          void handleDeletePrompt()
        }}
      />
    </div>
  )
}
