"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import {
  BookOpen,
  CloudDownload,
  Cpu,
  FileCode,
  FolderOpen,
  Palette,
  Globe,
  Plus,
  Trash2,
  Edit2,
  Save,
  RefreshCw,
  HardDrive,
  Play,
  Sparkles,
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
import { PromptMarkdownEditor } from "@/components/editors/prompt-markdown-editor"
import { WebGLBlurCanvas } from "@/components/ui/webgl-blur-canvas"
import { CustomSkinDialog } from "@/components/views/custom-skin-dialog"
import { PromptLabPanel } from "@/components/views/prompt-lab-panel"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import {
  cancelModelDownload,
  createPromptTemplate,
  deletePromptTemplate,
  getApiErrorMessage,
  getLLMConfig,
  getModels,
  getOllamaRuntimeConfig,
  getPromptTemplates,
  getWhisperConfig,
  migrateLocalModels,
  reloadModels,
  restartOllamaService,
  startModelDownload,
  updateLLMConfig,
  updateModel,
  updateOllamaRuntimeConfig,
  updatePromptSelection,
  updatePromptTemplate,
  updateWhisperConfig,
} from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { getImageLayout } from "@/lib/ui-skin"
import type {
  LLMConfigResponse,
  LocalModelsMigrationResponse,
  ModelDescriptor,
  OllamaRuntimeConfigResponse,
  PromptTemplateBundleResponse,
  PromptTemplateChannel,
  PromptTemplateItem,
  UISettingsResponse,
  WhisperConfigResponse,
} from "@/lib/types"

interface SettingsViewProps {
  uiSettings: UISettingsResponse
  onUiSettingsChange: (patch: Partial<UISettingsResponse>) => Promise<UISettingsResponse>
  onUiSettingsPreviewChange: (patch: Partial<UISettingsResponse> | null) => void
}

const modelTypeLabels: Record<string, string> = {
  whisper: "语音转写",
  llm: "大语言模型",
  embedding: "嵌入模型",
  rerank: "重排序模型",
  vlm: "视觉模型",
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
  rerank: "border-amber-800/75 text-amber-700 dark:border-amber-400/55 dark:text-amber-300",
  vlm: "border-fuchsia-800/75 text-fuchsia-700 dark:border-fuchsia-400/55 dark:text-fuchsia-300",
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
const BACKGROUND_IMAGE_FILE_SIZE_LIMIT = 12 * 1024 * 1024

const EMPTY_PROMPT_FORM = {
  channel: "correction" as PromptTemplateChannel,
  name: "",
  content: "",
}

type PromptDialogMode = "create" | "edit" | "view"

type ModelConfigFormState = {
  provider: string
  model_id: string
  path: string
  load_profile: string
  quantization: string
  max_batch_size: string
  rerank_top_n: string
  enabled: boolean
  api_base_url: string
  api_key: string
  api_model: string
  api_timeout_seconds: string
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
  provider: "ollama",
  model_id: "",
  path: "",
  load_profile: "balanced",
  quantization: "",
  max_batch_size: "1",
  rerank_top_n: "8",
  enabled: true,
  api_base_url: "",
  api_key: "",
  api_model: "",
  api_timeout_seconds: "120",
}

type LLMConfigFormState = {
  correction_mode: LLMConfigResponse["correction_mode"]
  correction_batch_size: string
  correction_overlap: string
}

type OllamaRuntimeFormState = {
  install_dir: string
  executable_path: string
  models_dir: string
  base_url: string
}

const EMPTY_LLM_FORM: LLMConfigFormState = {
  correction_mode: "strict",
  correction_batch_size: "24",
  correction_overlap: "3",
}

const EMPTY_OLLAMA_RUNTIME_FORM: OllamaRuntimeFormState = {
  install_dir: "",
  executable_path: "",
  models_dir: "",
  base_url: "http://127.0.0.1:11434",
}

const MODEL_CONFIG_DRAFT_STORAGE_KEY = "vidgnost:model-config-draft:v1"

type ModelConfigDraftEntry = {
  model_id: string
  provider: string
  component: string
  model_form: ModelConfigFormState
  llm_form: LLMConfigFormState
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
  rerank: {
    icon: Cpu,
    iconClassName: "text-primary",
    surfaceClassName: "bg-primary/10",
  },
  vlm: {
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

const providerLabels: Record<string, string> = {
  local: "本地目录",
  ollama: "Ollama",
  openai_compatible: "在线 API",
}

const recommendedRemoteModels: Partial<Record<ModelDescriptor["component"], string[]>> = {
  llm: ["qwen3.5-plus"],
  embedding: ["text-embedding-v4"],
  rerank: ["gte-rerank-v2"],
  vlm: ["qwen2.5vl:3b", "granite3.2-vision:2b"],
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("读取图片失败"))
    }
    reader.onerror = () => {
      reject(reader.error || new Error("读取图片失败"))
    }
    reader.readAsDataURL(file)
  })
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function readModelConfigDraftMap(): Record<string, ModelConfigDraftEntry> {
  if (!canUseStorage()) {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(MODEL_CONFIG_DRAFT_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<string, ModelConfigDraftEntry>
  } catch {
    return {}
  }
}

function writeModelConfigDraftMap(nextMap: Record<string, ModelConfigDraftEntry>): void {
  if (!canUseStorage()) {
    return
  }
  try {
    if (Object.keys(nextMap).length === 0) {
      window.localStorage.removeItem(MODEL_CONFIG_DRAFT_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(MODEL_CONFIG_DRAFT_STORAGE_KEY, JSON.stringify(nextMap))
  } catch {
    return
  }
}

function readModelConfigDraft(modelId: string): ModelConfigDraftEntry | null {
  const draftMap = readModelConfigDraftMap()
  return draftMap[modelId] ?? null
}

function saveModelConfigDraft(entry: ModelConfigDraftEntry): void {
  const draftMap = readModelConfigDraftMap()
  draftMap[entry.model_id] = entry
  writeModelConfigDraftMap(draftMap)
}

function clearModelConfigDraft(modelId: string): void {
  const draftMap = readModelConfigDraftMap()
  if (!(modelId in draftMap)) {
    return
  }
  delete draftMap[modelId]
  writeModelConfigDraftMap(draftMap)
}

function getModelComponentLabel(component: ModelDescriptor["component"]): string {
  return modelTypeLabels[component] || component
}

function getModelComponentTagClassName(component: ModelDescriptor["component"]): string {
  return modelTypeTagClassNames[component] || "border-border/60 text-foreground/80"
}

type PickedSkinImage = {
  dataUrl: string
  fileName: string
  sizeBytes?: number
}

export function SettingsView({
  uiSettings,
  onUiSettingsChange,
  onUiSettingsPreviewChange,
}: SettingsViewProps) {
  const { resolvedTheme } = useTheme()
  const [activeSection, setActiveSection] = React.useState("models")
  const [fontSize, setFontSize] = React.useState([uiSettings.font_size])
  const [themeHue, setThemeHue] = React.useState([uiSettings.theme_hue])
  const [studyDefaultTranslationTarget, setStudyDefaultTranslationTarget] = React.useState(
    uiSettings.study_default_translation_target || "",
  )
  const [models, setModels] = React.useState<ModelDescriptor[]>([])
  const [promptBundle, setPromptBundle] = React.useState<PromptTemplateBundleResponse | null>(null)
  const [whisperConfig, setWhisperConfig] = React.useState<WhisperConfigResponse | null>(null)
  const [llmConfig, setLlmConfig] = React.useState<LLMConfigResponse | null>(null)
  const [ollamaConfig, setOllamaConfig] = React.useState<OllamaRuntimeConfigResponse | null>(null)
  const [isPromptDialogOpen, setIsPromptDialogOpen] = React.useState(false)
  const [isModelDialogOpen, setIsModelDialogOpen] = React.useState(false)
  const [isOllamaRuntimeDialogOpen, setIsOllamaRuntimeDialogOpen] = React.useState(false)
  const [isLocalMigrationDialogOpen, setIsLocalMigrationDialogOpen] = React.useState(false)
  const [isSkinDialogOpen, setIsSkinDialogOpen] = React.useState(false)
  const [pendingSkinImage, setPendingSkinImage] = React.useState<PickedSkinImage | null>(null)
  const [editingPrompt, setEditingPrompt] = React.useState<PromptTemplateItem | null>(null)
  const [promptDialogMode, setPromptDialogMode] = React.useState<PromptDialogMode>("create")
  const [editingModel, setEditingModel] = React.useState<ModelDescriptor | null>(null)
  const [promptForm, setPromptForm] = React.useState(EMPTY_PROMPT_FORM)
  const [modelForm, setModelForm] = React.useState<ModelConfigFormState>(EMPTY_MODEL_FORM)
  const [llmForm, setLlmForm] = React.useState<LLMConfigFormState>(EMPTY_LLM_FORM)
  const [ollamaRuntimeForm, setOllamaRuntimeForm] = React.useState<OllamaRuntimeFormState>(EMPTY_OLLAMA_RUNTIME_FORM)
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyModelId, setBusyModelId] = React.useState("")
  const [isSavingPrompt, setIsSavingPrompt] = React.useState(false)
  const [isSavingModel, setIsSavingModel] = React.useState(false)
  const [isSavingUi, setIsSavingUi] = React.useState(false)
  const [isUpdatingWhisper, setIsUpdatingWhisper] = React.useState(false)
  const [isUpdatingOllamaRuntime, setIsUpdatingOllamaRuntime] = React.useState(false)
  const [isRestartingOllamaService, setIsRestartingOllamaService] = React.useState(false)
  const [isMigratingLocalModels, setIsMigratingLocalModels] = React.useState(false)
  const [ollamaRuntimeDirty, setOllamaRuntimeDirty] = React.useState(false)
  const [localMigrationTarget, setLocalMigrationTarget] = React.useState("")
  const [pendingLocalMigrationConfirmation, setPendingLocalMigrationConfirmation] =
    React.useState<LocalModelsMigrationResponse | null>(null)
  const [pendingDeletePrompt, setPendingDeletePrompt] = React.useState<PromptTemplateItem | null>(null)
  const [isDeletingPrompt, setIsDeletingPrompt] = React.useState(false)
  const markdownColorMode = resolvedTheme === "dark" ? "dark" : "light"
  const isPromptReadOnly = promptDialogMode === "view"
  const backgroundFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const backgroundFileResolverRef = React.useRef<((image: PickedSkinImage | null) => void) | null>(null)
  const skinPreviewRef = React.useRef<HTMLDivElement | null>(null)
  const [skinPreviewSize, setSkinPreviewSize] = React.useState({ width: 0, height: 0 })
  const [skinPreviewImageSize, setSkinPreviewImageSize] = React.useState({ width: 0, height: 0 })
  const ollamaService = ollamaConfig?.service ?? null

  React.useEffect(() => {
    setFontSize([uiSettings.font_size])
  }, [uiSettings.font_size])

  React.useEffect(() => {
    setThemeHue([uiSettings.theme_hue])
  }, [uiSettings.theme_hue])

  React.useEffect(() => {
    setStudyDefaultTranslationTarget(uiSettings.study_default_translation_target || "")
  }, [uiSettings.study_default_translation_target])

  React.useEffect(() => {
    const activeHue = themeHue[0] ?? uiSettings.theme_hue
    document.documentElement.style.setProperty("--theme-hue", String(activeHue))
    return () => {
      document.documentElement.style.setProperty("--theme-hue", String(uiSettings.theme_hue))
    }
  }, [themeHue, uiSettings.theme_hue])

  React.useEffect(() => {
    return () => {
      onUiSettingsPreviewChange(null)
    }
  }, [onUiSettingsPreviewChange])

  React.useEffect(() => {
    if (activeSection !== "appearance" || !skinPreviewRef.current) {
      return
    }

    const updateSize = () => {
      const rect = skinPreviewRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      setSkinPreviewSize((current) => {
        if (current.width === rect.width && current.height === rect.height) {
          return current
        }
        return {
          width: rect.width,
          height: rect.height,
        }
      })
    }

    updateSize()
    const frameId = window.requestAnimationFrame(updateSize)

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.cancelAnimationFrame(frameId)
      }
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(skinPreviewRef.current)
    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [activeSection])

  React.useEffect(() => {
    if (!uiSettings.background_image) {
      setSkinPreviewImageSize({ width: 0, height: 0 })
      return
    }

    let cancelled = false
    const image = new Image()
    image.decoding = "async"
    image.src = uiSettings.background_image

    const updateSize = () => {
      if (cancelled) {
        return
      }
      setSkinPreviewImageSize((current) => {
        if (current.width === image.naturalWidth && current.height === image.naturalHeight) {
          return current
        }
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
        }
      })
    }

    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      updateSize()
      return () => {
        cancelled = true
      }
    }

    image.onload = updateSize
    return () => {
      cancelled = true
      image.onload = null
      image.onerror = null
    }
  }, [uiSettings.background_image])

  const applyOllamaRuntimeConfig = React.useCallback((response: OllamaRuntimeConfigResponse) => {
    setOllamaConfig(response)
    setOllamaRuntimeForm({
      install_dir: response.install_dir,
      executable_path: response.executable_path,
      models_dir: response.models_dir,
      base_url: response.base_url,
    })
    setOllamaRuntimeDirty(false)
    setLocalMigrationTarget((current) => current || response.models_dir)
  }, [])

  const loadSettings = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const [modelsResponse, promptResponse, whisperResponse, llmResponse, ollamaResponse] = await Promise.all([
        getModels(),
        getPromptTemplates(),
        getWhisperConfig(),
        getLLMConfig(),
        getOllamaRuntimeConfig(),
      ])
      setModels(modelsResponse.items)
      setPromptBundle(promptResponse)
      setWhisperConfig(whisperResponse)
      setLlmConfig(llmResponse)
      applyOllamaRuntimeConfig(ollamaResponse)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "加载设置数据失败"))
    } finally {
      setIsLoading(false)
    }
  }, [applyOllamaRuntimeConfig])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  React.useEffect(() => {
    if (!ollamaConfig || ollamaRuntimeDirty) {
      return
    }
    setOllamaRuntimeForm({
      install_dir: ollamaConfig.install_dir,
      executable_path: ollamaConfig.executable_path,
      models_dir: ollamaConfig.models_dir,
      base_url: ollamaConfig.base_url,
    })
    setLocalMigrationTarget((current) => current || ollamaConfig.models_dir)
  }, [ollamaConfig, ollamaRuntimeDirty])

  React.useEffect(() => {
    if (!isModelDialogOpen || !editingModel) {
      return
    }
    saveModelConfigDraft({
      model_id: editingModel.id,
      provider: editingModel.provider,
      component: editingModel.component,
      model_form: modelForm,
      llm_form: llmForm,
    })
  }, [editingModel, isModelDialogOpen, llmForm, modelForm])

  const hasDownloadingModels = React.useMemo(
    () => models.some((model) => model.download?.state === "downloading"),
    [models],
  )

  React.useEffect(() => {
    if (!hasDownloadingModels) {
      return
    }
    let cancelled = false
    const timer = window.setInterval(() => {
      void getModels()
        .then((response) => {
          if (!cancelled) {
            setModels(response.items)
          }
        })
        .catch(() => {
          // Download polling is best-effort; surface errors through explicit user actions instead.
        })
    }, 1200)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [hasDownloadingModels])

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

  const getModelProviderOptions = (model: ModelDescriptor) => {
    if (model.component === "whisper") {
      return [{ value: "local", label: providerLabels.local }]
    }
    return [
      { value: "ollama", label: providerLabels.ollama },
      { value: "openai_compatible", label: providerLabels.openai_compatible },
    ]
  }

  const getModelConfigPreset = (model: ModelDescriptor): ModelConfigPreset => {
    if (model.component === "whisper") {
      return {
        title: "语音转写模型配置",
        description: "调整 Whisper 模型目录与加载策略，并在当前弹窗内切换 GPU 加速。",
        note: "GPU 开关仅依据当前 Whisper 运行条件检测结果启用，不代表已验证可直接复用 Ollama 的 CUDA 运行库。",
        fields: ["path", "load_profile", "quantization", "enabled"],
        pathLabel: "模型目录",
        pathPlaceholder: "可选：指定 Whisper 模型目录",
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

    return {
      title: "重排序模型配置",
      description: "控制 rerank 模型的本地目录、批处理规模与最终返回条数。",
      note: "建议先调最终返回条数，再根据机器负载逐步提高重排序批大小。",
      fields: ["path", "max_batch_size", "rerank_top_n", "enabled"],
      pathLabel: "模型目录",
      pathPlaceholder: "可选：指定 rerank 模型目录",
      batchLabel: "重排序批大小",
      batchDescription: "提升批大小可以提高吞吐，但会增加 CPU/GPU 占用。",
    }
  }

  const buildModelUpdatePayload = (model: ModelDescriptor, form: ModelConfigFormState) => {
    const preset = getModelConfigPreset(model)
    const payload: Parameters<typeof updateModel>[1] = {}
    const parsedBatchSize = Number.parseInt(form.max_batch_size, 10)
    const parsedRerankTopN = Number.parseInt(form.rerank_top_n, 10)
    const parsedTimeoutSeconds = Number.parseInt(form.api_timeout_seconds, 10)

    payload.provider = form.provider
    payload.model_id = form.model_id.trim() || model.model_id
    if (preset.fields.includes("path")) {
      payload.path = form.provider === "openai_compatible" ? "" : form.path.trim()
    }
    if (preset.fields.includes("load_profile")) {
      payload.load_profile = form.load_profile.trim() || "balanced"
    }
    if (preset.fields.includes("quantization")) {
      payload.quantization = form.quantization.trim()
    }
    if (preset.fields.includes("max_batch_size")) {
      payload.max_batch_size = Number.isFinite(parsedBatchSize) ? parsedBatchSize : 1
    }
    if (preset.fields.includes("rerank_top_n")) {
      payload.rerank_top_n = Number.isFinite(parsedRerankTopN) ? parsedRerankTopN : 8
    }
    if (preset.fields.includes("enabled")) {
      payload.enabled = form.enabled
    }
    payload.api_base_url = form.api_base_url.trim()
    payload.api_key = form.api_key.trim()
    payload.api_model = form.api_model.trim()
    payload.api_timeout_seconds = Number.isFinite(parsedTimeoutSeconds) ? parsedTimeoutSeconds : 120

    return payload
  }

  const buildLlmUpdatePayload = (runtimeConfig: LLMConfigResponse): LLMConfigResponse => {
    const parsedBatchSize = Number.parseInt(llmForm.correction_batch_size, 10)
    const parsedOverlap = Number.parseInt(llmForm.correction_overlap, 10)
    return {
      ...runtimeConfig,
      correction_mode: llmForm.correction_mode,
      correction_batch_size: Number.isFinite(parsedBatchSize) ? parsedBatchSize : runtimeConfig.correction_batch_size,
      correction_overlap: Number.isFinite(parsedOverlap) ? parsedOverlap : runtimeConfig.correction_overlap,
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
      toast.error(getApiErrorMessage(error, "刷新模型检测状态失败"))
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
      const refreshed = response.items.find((item) => item.id === model.id)
      if (model.download?.state === "downloading") {
        toast.success("模型下载已取消")
      } else if (model.is_installed) {
        if (refreshed?.is_installed) {
          toast.success("已刷新模型检测状态，当前模型文件可直接使用")
        } else {
          toast("已刷新模型检测状态，当前目录未检测到完整模型文件")
        }
      } else {
        const message = refreshed?.download?.message?.trim()
        if (refreshed?.download?.state === "failed") {
          toast(message || "模型当前不可直接安装，请先处理 Ollama 服务状态")
        } else if (refreshed?.download?.state === "completed") {
          toast.success(message || "当前模型已经就绪，无需重复安装")
        } else {
          toast.success(
            message || (model.component === "whisper" ? "已开始下载 Whisper 模型" : "已开始通过 Ollama 安装模型"),
          )
        }
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
      if (editingModel) {
        clearModelConfigDraft(editingModel.id)
      }
      setEditingModel(null)
      setModelForm(EMPTY_MODEL_FORM)
      setLlmForm(EMPTY_LLM_FORM)
    }
  }

  const handleConfigureModel = (model: ModelDescriptor) => {
    const nextModelForm: ModelConfigFormState = {
      provider: model.provider,
      model_id: model.model_id,
      path: model.path || model.default_path || "",
      load_profile: model.load_profile || "balanced",
      quantization: model.quantization || "",
      max_batch_size: String(model.max_batch_size || 1),
      rerank_top_n: String(model.rerank_top_n || 8),
      enabled: model.enabled,
      api_base_url: model.api_base_url || "",
      api_key: model.api_key || "",
      api_model: model.api_model || "",
      api_timeout_seconds: String(model.api_timeout_seconds || 120),
    }
    const nextLlmForm: LLMConfigFormState =
      model.component === "llm" && llmConfig
        ? {
            correction_mode: llmConfig.correction_mode,
            correction_batch_size: String(llmConfig.correction_batch_size),
            correction_overlap: String(llmConfig.correction_overlap),
          }
        : EMPTY_LLM_FORM
    const draft = readModelConfigDraft(model.id)

    setEditingModel(model)
    if (draft && draft.provider === model.provider && draft.component === model.component) {
      setModelForm(draft.model_form)
      setLlmForm(draft.llm_form)
      toast("已恢复上次未保存的模型配置草稿")
    } else {
      setModelForm(nextModelForm)
      setLlmForm(nextLlmForm)
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
      const modelsResponse = await updateModel(editingModel.id, buildModelUpdatePayload(editingModel, modelForm))
      setModels(modelsResponse.items)
      if (editingModel.component === "llm") {
        const syncedRuntimeConfig = await getLLMConfig()
        const nextLlmPayload = buildLlmUpdatePayload(syncedRuntimeConfig)
        const llmResponse = await updateLLMConfig(nextLlmPayload)
        setLlmConfig(llmResponse)
      }
      clearModelConfigDraft(editingModel.id)
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
      setPromptDialogMode("create")
      setPromptForm(EMPTY_PROMPT_FORM)
    }
  }

  const handleCreatePromptClick = () => {
    setEditingPrompt(null)
    setPromptDialogMode("create")
    setPromptForm(EMPTY_PROMPT_FORM)
    setIsPromptDialogOpen(true)
  }

  const handleEditPromptClick = (prompt: PromptTemplateItem) => {
    if (prompt.is_default) {
      toast("系统默认模板为只读模板，请新建副本后再编辑")
      return
    }

    setEditingPrompt(prompt)
    setPromptDialogMode("edit")
    setPromptForm({
      channel: prompt.channel,
      name: prompt.name,
      content: prompt.content,
    })
    setIsPromptDialogOpen(true)
  }

  const handleViewPromptClick = (prompt: PromptTemplateItem) => {
    setEditingPrompt(prompt)
    setPromptDialogMode("view")
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
      onUiSettingsPreviewChange(null)
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

  const handleSaveStudyDefaultTranslationTarget = React.useCallback(() => {
    const normalizedValue = studyDefaultTranslationTarget.trim()
    void handleUiSettingChange({
      study_default_translation_target: normalizedValue || null,
    }, normalizedValue ? "Study 默认翻译目标已保存" : "Study 默认翻译目标已清除")
  }, [studyDefaultTranslationTarget])

  const resolvePickedSkinImage = React.useCallback(async (file: File): Promise<PickedSkinImage | null> => {
    if (!file.type.startsWith("image/")) {
      toast.error("仅支持上传图片文件")
      return null
    }

    if (file.size > BACKGROUND_IMAGE_FILE_SIZE_LIMIT) {
      toast.error("换肤图片不能超过 12 MB")
      return null
    }

    try {
      return {
        dataUrl: await readFileAsDataUrl(file),
        fileName: file.name,
        sizeBytes: file.size,
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "读取换肤图片失败"))
      return null
    }
  }, [])

  const handleBackgroundFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    const resolver = backgroundFileResolverRef.current
    backgroundFileResolverRef.current = null
    const pickedImage = file ? await resolvePickedSkinImage(file) : null
    resolver?.(pickedImage)
  }, [resolvePickedSkinImage])

  const requestSkinImage = React.useCallback(async (): Promise<PickedSkinImage | null> => {
    if (window.vidGnostDesktop?.pickImageFile) {
      const picked = await window.vidGnostDesktop.pickImageFile()
      if (picked.canceled) {
        return null
      }
      if (!picked.dataUrl) {
        toast.error(picked.message || "读取换肤图片失败")
        return null
      }
      if ((picked.sizeBytes || 0) > BACKGROUND_IMAGE_FILE_SIZE_LIMIT) {
        toast.error("换肤图片不能超过 12 MB")
        return null
      }
      return {
        dataUrl: picked.dataUrl,
        fileName: picked.fileName || "已选择图片",
        sizeBytes: picked.sizeBytes,
      }
    }

    return new Promise<PickedSkinImage | null>((resolve) => {
      backgroundFileResolverRef.current = resolve
      backgroundFileInputRef.current?.click()
    })
  }, [])

  const handleOpenSkinPicker = async () => {
    const pickedImage = await requestSkinImage()
    if (!pickedImage) {
      return
    }
    setPendingSkinImage(pickedImage)
    onUiSettingsPreviewChange({
      background_image: pickedImage.dataUrl,
      background_image_opacity: uiSettings.background_image_opacity,
      background_image_blur: uiSettings.background_image_blur,
      background_image_scale: 1,
      background_image_focus_x: 0.5,
      background_image_focus_y: 0.5,
      background_image_fill_mode: "cover",
    })
    setIsSkinDialogOpen(true)
  }

  const handleClearBackgroundImage = () => {
    setPendingSkinImage(null)
    onUiSettingsPreviewChange(null)
    void handleUiSettingChange(
      {
        background_image: null,
        background_image_scale: 1,
        background_image_focus_x: 0.5,
        background_image_focus_y: 0.5,
        background_image_fill_mode: "cover",
      },
      "自定义换肤已清除",
    )
  }

  const handleSkinDialogChange = (open: boolean) => {
    setIsSkinDialogOpen(open)
    if (!open) {
      setPendingSkinImage(null)
      onUiSettingsPreviewChange(null)
    }
  }

  const handleBrowseOllamaDirectory = async (title: string) => {
    if (!window.vidGnostDesktop?.pickDirectory) {
      toast("当前环境不支持目录选择，请直接手动填写路径。")
      return
    }
    const picked = await window.vidGnostDesktop.pickDirectory(title)
    if (picked.canceled || !picked.path) {
      return
    }
    setOllamaRuntimeDirty(true)
    setOllamaRuntimeForm((current) => ({ ...current, models_dir: picked.path || current.models_dir }))
    setLocalMigrationTarget(picked.path)
  }

  const handleSaveOllamaRuntimeConfig = async () => {
    if (!ollamaRuntimeForm.models_dir.trim()) {
      toast.error("请先填写 Ollama 模型目录")
      return
    }
    setIsUpdatingOllamaRuntime(true)
    try {
      const response = await updateOllamaRuntimeConfig({
        models_dir: ollamaRuntimeForm.models_dir.trim(),
        base_url: ollamaRuntimeForm.base_url.trim(),
      })
      const latestWhisperConfig = await getWhisperConfig()
      applyOllamaRuntimeConfig(response)
      setWhisperConfig(latestWhisperConfig)
      toast.success("Ollama 运行时配置已保存")
      if (response.service.restart_required || !response.service.reachable) {
        toast(response.service.message)
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "保存 Ollama 配置失败"))
    } finally {
      setIsUpdatingOllamaRuntime(false)
    }
  }

  const handleRestartOllamaService = async () => {
    setIsRestartingOllamaService(true)
    try {
      const ollamaResponse = await restartOllamaService()
      const [modelsResponse, latestWhisperConfig] = await Promise.all([getModels(), getWhisperConfig()])
      setModels(modelsResponse.items)
      setWhisperConfig(latestWhisperConfig)
      applyOllamaRuntimeConfig(ollamaResponse)
      if (ollamaResponse.service.reachable) {
        toast.success(ollamaResponse.service.message || "Ollama 服务已启动")
      } else {
        toast.error(ollamaResponse.service.message || "Ollama 服务仍未就绪")
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "重启 Ollama 服务失败"))
    } finally {
      setIsRestartingOllamaService(false)
    }
  }

  const handleBrowseLocalMigrationTarget = async () => {
    if (!window.vidGnostDesktop?.pickDirectory) {
      toast("当前环境不支持目录选择，请直接手动填写路径。")
      return
    }
    const picked = await window.vidGnostDesktop.pickDirectory("选择本地模型迁移目标根目录")
    if (picked.canceled || !picked.path) {
      return
    }
    setLocalMigrationTarget(picked.path)
  }

  const handleMigrateLocalModels = async (confirmRunningTasks = false) => {
    const targetRoot = localMigrationTarget.trim()
    if (!targetRoot) {
      toast.error("请先填写本地模型迁移目标根目录")
      return
    }
    setIsMigratingLocalModels(true)
    try {
      const response: LocalModelsMigrationResponse = await migrateLocalModels(targetRoot, confirmRunningTasks)
      if (response.requires_confirmation) {
        setPendingLocalMigrationConfirmation(response)
        return
      }
      const [modelsResponse, ollamaResponse] = await Promise.all([getModels(), getOllamaRuntimeConfig()])
      setModels(modelsResponse.items)
      applyOllamaRuntimeConfig(ollamaResponse)
      setPendingLocalMigrationConfirmation(null)
      if (response.warnings.length > 0) {
        toast(response.warnings.join(" "))
      }
      if (response.moved.length > 0) {
        toast.success(
          response.ollama_restarted
            ? `${response.message} Ollama 服务已自动重启。`
            : response.message || `已迁移 ${response.moved.length} 个本地模型到指定目录`,
        )
        setIsLocalMigrationDialogOpen(false)
      } else {
        toast(response.message || "没有需要迁移的本地模型")
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "迁移本地模型失败"))
    } finally {
      setIsMigratingLocalModels(false)
    }
  }

  const handleGpuToggle = async (checked: boolean) => {
    if (!whisperConfig) {
      return
    }

    if (checked && !whisperConfig.runtime_libraries.ready) {
      toast.error("当前仅在 Whisper CLI 与模型目录检测就绪后允许切换 GPU；这不表示 CUDA 运行库已完成验证。")
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

  const localConfiguredModels = React.useMemo(
    () => models.filter((model) => model.provider === "local" || model.provider === "ollama"),
    [models],
  )
  const isModelListLoading = isLoading && models.length === 0
  const activeModelPreset = editingModel ? getModelConfigPreset(editingModel) : null
  const modelDialogHasQuantization = Boolean(activeModelPreset?.fields.includes("quantization"))
  const modelDialogHasBatchSize = Boolean(activeModelPreset?.fields.includes("max_batch_size"))
  const modelDialogHasRerankTopN = Boolean(activeModelPreset?.fields.includes("rerank_top_n"))
  const modelProviderOptions = editingModel ? getModelProviderOptions(editingModel) : []
  const showRemoteApiFields = Boolean(modelForm.provider === "openai_compatible" && editingModel)
  const showLlmCorrectionFields = Boolean(editingModel?.component === "llm")
  const showModelPathField = Boolean(activeModelPreset?.fields.includes("path") && modelForm.provider !== "openai_compatible")
  const remoteModelRecommendations = editingModel ? recommendedRemoteModels[editingModel.component] || [] : []
  const isWhisperDialog = editingModel?.component === "whisper"
  const hasSkinImage = Boolean(uiSettings.background_image)
  const skinPreviewBlur = Math.max(0, uiSettings.background_image_blur / 2)
  const skinPreviewLayout = React.useMemo(() => {
    if (
      !hasSkinImage ||
      skinPreviewSize.width <= 0 ||
      skinPreviewSize.height <= 0 ||
      skinPreviewImageSize.width <= 0 ||
      skinPreviewImageSize.height <= 0
    ) {
      return null
    }

    return getImageLayout({
      viewportWidth: skinPreviewSize.width,
      viewportHeight: skinPreviewSize.height,
      imageWidth: skinPreviewImageSize.width,
      imageHeight: skinPreviewImageSize.height,
      scale: uiSettings.background_image_scale,
      focusX: uiSettings.background_image_focus_x,
      focusY: uiSettings.background_image_focus_y,
    })
  }, [
    hasSkinImage,
    uiSettings.background_image_focus_x,
    uiSettings.background_image_focus_y,
    uiSettings.background_image_scale,
    skinPreviewImageSize.height,
    skinPreviewImageSize.width,
    skinPreviewSize.height,
    skinPreviewSize.width,
  ])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <input
        ref={backgroundFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleBackgroundFileChange(event)
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">设置中心</h1>
              <p className="text-muted-foreground">配置模型、提示词模板和应用外观</p>
            </div>

            <div className="flex gap-6">
              <div className="w-48 shrink-0">
                <nav className="settings-section-nav sticky top-6 space-y-1">
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      data-active={activeSection === section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "settings-section-tab flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
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
                <CardContent className="settings-models-shell space-y-4">
                  <div className="settings-models-panel settings-model-row rounded-lg border p-4">
                    <div className="flex items-start gap-4">
                      <div className="settings-model-icon-shell flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Cpu className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Ollama 运行时</span>
                          <Badge variant={ollamaService?.reachable ? "default" : "secondary"}>
                            {ollamaService?.reachable ? "接口可达" : "接口不可达"}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={
                              ollamaService?.using_configured_models_dir
                                ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-300"
                                : "border-amber-500/60 text-amber-600 dark:text-amber-300"
                            }
                          >
                            {ollamaService?.using_configured_models_dir ? "模型目录已生效" : "模型目录待切换"}
                          </Badge>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          安装目录固定为系统默认路径，仅在配置弹窗中维护模型目录和服务地址；本地 ASR 会复用默认运行库。
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {ollamaService?.configured_models_dir || ollamaRuntimeForm.models_dir || "未配置模型目录"} · {ollamaRuntimeForm.base_url || "未配置服务地址"}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          {ollamaService?.message || "保存配置后，这里会显示当前 Ollama 实际使用的模型目录。"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRestartingOllamaService || !ollamaService?.can_self_restart}
                          onClick={() => {
                            void handleRestartOllamaService()
                          }}
                        >
                          <Play className="mr-1 h-4 w-4" />
                          启动/重启
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsOllamaRuntimeDialogOpen(true)}
                        >
                          配置
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="settings-models-panel settings-model-row rounded-lg border p-4">
                    <div className="flex items-start gap-4">
                      <div className="settings-model-icon-shell flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <HardDrive className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">本地模型批量迁移</span>
                          <Badge variant="secondary">{`${localConfiguredModels.length} 个本地模型`}</Badge>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          仅支持一次性迁移当前项目里全部本地模型，包含 Whisper 本地目录和 Ollama 管理目录，迁移完成后会自动回写绝对路径并重启 Ollama。
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {localConfiguredModels.length > 0
                            ? localConfiguredModels.map((model) => model.name).join("、")
                            : "当前还没有已配置的本地模型"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsLocalMigrationDialogOpen(true)}
                        >
                          配置
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    {isModelListLoading
                        ? Array.from({ length: 5 }).map((_, index) => (
                          <div
                            key={`model-skeleton-${index}`}
                            className="settings-models-panel rounded-lg border p-4"
                          >
                            <div className="flex items-start gap-4">
                              <div className="app-skeleton h-10 w-10 shrink-0 rounded-lg" />
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="app-skeleton h-4 w-48 rounded-md" />
                                <div className="app-skeleton h-3 w-72 rounded-md" />
                                <div className="app-skeleton h-3 w-full max-w-xl rounded-md" />
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="app-skeleton h-9 w-20 rounded-md" />
                                <div className="app-skeleton h-9 w-16 rounded-md" />
                              </div>
                            </div>
                          </div>
                        ))
                      : models.map((model) => {
                          const isDownloading = model.download?.state === "downloading"
                          const downloadPercent = Math.max(0, Math.min(100, model.download?.percent ?? 0))

                          return (
                            <div key={model.id} className="settings-models-panel settings-model-row rounded-lg border p-4">
                              <div className="flex items-start gap-4">
                                <div
                                  className={cn(
                                    "settings-model-icon-shell flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
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
                                    <Badge variant="outline" className={getModelComponentTagClassName(model.component)}>
                                      {getModelComponentLabel(model.component)}
                                    </Badge>
                                    <Badge variant="secondary" className="capitalize">
                                      {providerLabels[model.provider] || model.provider.replaceAll("_", " ")}
                                    </Badge>
                                    <span className="flex items-center gap-1">
                                      <HardDrive className="h-3 w-3" />
                                      {model.size_bytes > 0 ? formatBytes(model.size_bytes) : "未记录"}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1 truncate">
                                    {model.provider === "openai_compatible"
                                      ? `${model.api_model || model.model_id} · ${model.api_base_url || "未配置 API 地址"}`
                                      : model.is_installed
                                        ? model.path || model.default_path || model.model_id
                                        : "未就绪"}
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
                                        {model.is_installed ? "刷新检测" : model.component === "whisper" ? "下载" : "安装"}
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
                                      刷新检测
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
                                  <Progress
                                    value={downloadPercent}
                                    className="h-2 bg-primary/10"
                                    indicatorClassName="download-progress-indicator"
                                  />
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                    {models.length === 0 && !isLoading && (
                      <div className="settings-models-panel settings-model-empty rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                        当前没有可展示的模型配置
                      </div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      toast("当前后端提供模型刷新检测与路径更新，暂不支持新增模型条目。")
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    添加模型
                  </Button>

                  <Dialog open={isOllamaRuntimeDialogOpen} onOpenChange={setIsOllamaRuntimeDialogOpen}>
                    <DialogContent className="sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Ollama 运行时配置</DialogTitle>
                        <DialogDescription>
                          Ollama 安装目录固定为系统默认路径，模型目录可自定义；本地 ASR 会直接复用该安装目录下的运行库。
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="ollama-install-dir">安装目录</Label>
                            <Input
                              id="ollama-install-dir"
                              className="bg-muted/40 text-muted-foreground"
                              value={ollamaRuntimeForm.install_dir}
                              readOnly
                            />
                            <p className="text-xs text-muted-foreground">
                              跟随系统默认安装路径，不再提供项目内修改入口。
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ollama-executable">可执行文件</Label>
                            <Input
                              id="ollama-executable"
                              className="bg-muted/40 text-muted-foreground"
                              value={ollamaRuntimeForm.executable_path}
                              readOnly
                            />
                            <p className="text-xs text-muted-foreground">
                              服务重启与本地 ASR 运行库探测均复用这里的默认可执行文件所在目录。
                            </p>
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="ollama-models-dir">模型安装目录</Label>
                            <div className="flex gap-2">
                              <Input
                                id="ollama-models-dir"
                                className="bg-background/80"
                                value={ollamaRuntimeForm.models_dir}
                                onChange={(event) => {
                                  const nextValue = event.target.value
                                  setOllamaRuntimeDirty(true)
                                  setOllamaRuntimeForm((current) => ({ ...current, models_dir: nextValue }))
                                  setLocalMigrationTarget(nextValue)
                                }}
                                placeholder="如 D:\\AI\\OllamaModels"
                              />
                              <Button
                                variant="outline"
                                className="shrink-0"
                                onClick={() => {
                                  void handleBrowseOllamaDirectory("选择 Ollama 模型目录")
                                }}
                              >
                                <FolderOpen className="mr-2 h-4 w-4" />
                                浏览
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="ollama-base-url">服务地址</Label>
                            <Input
                              id="ollama-base-url"
                              className="bg-background/80"
                              value={ollamaRuntimeForm.base_url}
                              onChange={(event) => {
                                setOllamaRuntimeDirty(true)
                                setOllamaRuntimeForm((current) => ({ ...current, base_url: event.target.value }))
                              }}
                              placeholder="http://127.0.0.1:11434"
                            />
                            <p className="text-xs text-muted-foreground">
                              LLM 如果使用 Ollama 服务商，会自动基于这里的服务地址同步 OpenAI Compatible 入口。
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="rounded-xl border bg-muted/20 px-4 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">服务状态</p>
                            <p className="mt-2 text-sm font-medium">{ollamaService?.reachable ? "接口可达" : "接口不可达"}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {ollamaService?.process_detected ? "已检测到本地进程" : "未检测到本地进程"}
                            </p>
                          </div>
                          <div className="rounded-xl border bg-muted/20 px-4 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">配置目录</p>
                            <p className="mt-2 break-all text-sm leading-6 text-foreground/90">
                              {ollamaService?.configured_models_dir || ollamaRuntimeForm.models_dir || "未配置"}
                            </p>
                          </div>
                          <div className="rounded-xl border bg-muted/20 px-4 py-3">
                            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">当前说明</p>
                            <p className="mt-2 text-sm leading-6 text-foreground/90">
                              {ollamaService?.message || "保存配置后，这里会显示当前 Ollama 实际使用的模型目录。"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <DialogFooter className="gap-2 sm:justify-between">
                        <Button
                          variant="outline"
                          disabled={isUpdatingOllamaRuntime}
                          onClick={() => {
                            void handleSaveOllamaRuntimeConfig()
                          }}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          保存配置
                        </Button>
                        <Button
                          variant="outline"
                          disabled={isRestartingOllamaService || !ollamaService?.can_self_restart}
                          onClick={() => {
                            void handleRestartOllamaService()
                          }}
                        >
                          <Play className="mr-2 h-4 w-4" />
                          启动/重启
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog
                    open={isLocalMigrationDialogOpen}
                    onOpenChange={(open) => {
                      setIsLocalMigrationDialogOpen(open)
                      if (!open) {
                        setPendingLocalMigrationConfirmation(null)
                      }
                    }}
                  >
                    <DialogContent className="sm:max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>本地模型批量迁移</DialogTitle>
                        <DialogDescription>
                          当前仅支持一次性迁移全部本地模型，覆盖 Whisper 本地目录与 Ollama 管理目录，不支持选择性迁移。
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-5">
                        <div className="space-y-2">
                          <Label htmlFor="local-model-migration-target">迁移目标目录</Label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                              id="local-model-migration-target"
                              className="bg-background/80"
                              value={localMigrationTarget}
                              onChange={(event) => setLocalMigrationTarget(event.target.value)}
                              placeholder="如 E:\\AI\\VidGnost\\model-hub"
                            />
                            <Button
                              variant="outline"
                              className="shrink-0"
                              onClick={() => {
                                void handleBrowseLocalMigrationTarget()
                              }}
                            >
                              <FolderOpen className="mr-2 h-4 w-4" />
                              浏览
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="text-sm font-medium">当前项目已配置的本地模型条目</div>
                          {localConfiguredModels.length > 0 ? (
                            <div className="space-y-2">
                              {localConfiguredModels.map((model) => (
                                <div key={`migration-${model.id}`} className="rounded-xl border bg-muted/20 px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="font-medium">{model.name}</div>
                                      <div className="mt-1 truncate text-xs text-muted-foreground">
                                        {model.path || model.default_path || "未配置路径"}
                                      </div>
                                    </div>
                                    <Badge variant="outline">{getModelComponentLabel(model.component)}</Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                              当前没有可迁移的本地模型。
                            </div>
                          )}
                        </div>

                        {pendingLocalMigrationConfirmation ? (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
                            <p className="text-sm font-medium">检测到进行中的任务</p>
                            <p className="mt-1 text-xs leading-6 text-muted-foreground">
                              继续迁移前请再次确认，避免正在执行的分析任务因模型路径切换而异常。
                            </p>
                            <div className="mt-2 space-y-1 text-xs text-foreground/90">
                              {pendingLocalMigrationConfirmation.running_tasks.map((task) => (
                                <div key={`running-task-${task.id}`}>
                                  {task.title || task.id} · {task.workflow} · {task.status}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <DialogFooter>
                        <Button
                          disabled={isMigratingLocalModels || localConfiguredModels.length === 0}
                          onClick={() => {
                            void handleMigrateLocalModels()
                          }}
                        >
                          <HardDrive className="mr-2 h-4 w-4" />
                          批量迁移
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={isModelDialogOpen} onOpenChange={handleModelDialogChange}>
                    <DialogContent className="model-config-dialog flex w-[min(96vw,85rem)] max-h-[90vh] max-w-[85rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-[85rem]">
                      <DialogHeader className="model-config-dialog-header shrink-0 border-b bg-card px-6 py-2.5 pr-10">
                        <DialogTitle className="text-base font-semibold leading-tight">
                          {activeModelPreset?.title || "模型常用配置"}
                        </DialogTitle>
                        <DialogDescription className="text-[11px] leading-normal text-muted-foreground">
                          {activeModelPreset?.description || "更新模型配置。"}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="model-config-dialog-scroll themed-thin-scrollbar dialog-ultra-thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                        <div className="grid gap-6 px-6 py-6 xl:grid-cols-[minmax(25rem,29rem)_minmax(0,1fr)]">
                          {/* 左侧概览：集中展示当前模型身份、状态与关键指标 */}
                          <div className="space-y-5">
                            {editingModel ? (
                              <div className="model-config-dialog-panel rounded-xl border bg-card p-6">
                                <div className="space-y-5">
                                  <div className="flex items-start gap-4">
                                      <div
                                        className={cn(
                                          "settings-model-icon-shell flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40",
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
                                            getModelComponentTagClassName(editingModel.component),
                                          )}
                                        >
                                          {getModelComponentLabel(editingModel.component)}
                                        </Badge>
                                      </div>
                                      <div className="break-all text-xs leading-relaxed text-muted-foreground">
                                        {modelForm.model_id || editingModel.model_id}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="rounded-md border bg-background/80 text-foreground/90">
                                      {`服务商 · ${(providerLabels[modelForm.provider] || modelForm.provider).replaceAll("_", " ")}`}
                                    </Badge>
                                    <Badge variant="outline" className="rounded-md border bg-background/80 text-foreground/90">
                                      {`Component · ${getModelComponentLabel(editingModel.component)}`}
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
                                        {modelForm.provider === "openai_compatible" ? "在线入口" : "默认目录"}
                                      </div>
                                      <div className="break-all text-xs leading-relaxed text-foreground/90">
                                        {modelForm.provider === "openai_compatible"
                                          ? modelForm.api_base_url || "未配置"
                                          : editingModel.default_path || "未就绪"}
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
                                        {modelForm.enabled ? "参与链路" : "不参与链路"}
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
                                        平衡常驻与响应
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
                                        影响显存与吞吐
                                      </p>
                                    </div>
                                    <div className="rounded-xl border bg-muted/30 p-4">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                        {modelDialogHasRerankTopN ? "返回条数 / 批大小" : "批大小"}
                                      </div>
                                      <div className="mt-2 text-base font-semibold leading-tight text-foreground">
                                        {modelDialogHasRerankTopN
                                          ? `${modelForm.rerank_top_n || "8"} 条 / 批 ${modelForm.max_batch_size || "1"}`
                                          : modelDialogHasBatchSize
                                            ? modelForm.max_batch_size || "1"
                                            : "默认"}
                                      </div>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {modelDialogHasRerankTopN ? "控制最终候选数量与重排吞吐" : "越高越吃资源"}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="rounded-xl border bg-muted/30 p-4">
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                        {modelForm.provider === "openai_compatible" ? "当前模型 / 协议" : "当前路径"}
                                      </div>
                                      <div className="break-all text-xs leading-relaxed text-foreground/90">
                                        {modelForm.provider === "openai_compatible"
                                          ? modelForm.api_model || "未设置模型名"
                                          : modelForm.path || editingModel.path || editingModel.default_path || "使用默认托管目录"}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="rounded-xl border bg-muted/30 p-4">
                                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                      运行说明
                                    </div>
                                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                      {activeModelPreset?.note ||
                                        "调整常用运行参数，保存后同步后端配置。"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {/* 右侧配置：按运行参数与在线接口参数分组 */}
                          <div className="space-y-6 xl:max-w-[46rem]">
                            <div className="model-config-dialog-panel rounded-xl border bg-card p-5 md:p-6">
                              <div className="space-y-1">
                                <div className="text-base font-semibold leading-tight">常用运行参数</div>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                  仅展示当前模型实际可调整的核心参数，避免无关配置干扰。
                                </p>
                              </div>

                              <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                                <div className="space-y-2">
                                  <Label>服务商</Label>
                                  {modelProviderOptions.length === 1 ? (
                                    <Input
                                      className="bg-background/80"
                                      readOnly
                                      value={modelProviderOptions[0]?.label || providerLabels[modelForm.provider] || modelForm.provider}
                                    />
                                  ) : (
                                    <Select
                                      value={modelForm.provider}
                                      onValueChange={(value) =>
                                        setModelForm((current) => ({
                                          ...current,
                                          provider: value,
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="model-config-dialog-select-trigger bg-background/80">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="model-config-select-content">
                                        {modelProviderOptions.map((option) => (
                                          <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  <p className="text-xs text-muted-foreground">
                                    为当前组件选择本地目录、Ollama 或在线 API 路由。
                                  </p>
                                </div>

                                <div className="space-y-2">
                                  <Label htmlFor="model-identifier">模型标识</Label>
                                  <Input
                                    id="model-identifier"
                                    className="bg-background/80"
                                    value={modelForm.model_id}
                                    readOnly={isWhisperDialog}
                                    onChange={(event) =>
                                      setModelForm((current) => ({ ...current, model_id: event.target.value }))
                                    }
                                    placeholder={modelForm.provider === "ollama" ? "如 qwen2.5:3b / moondream" : "逻辑模型标识"}
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    {modelForm.provider === "ollama"
                                      ? "这里填写 Ollama 中实际安装和调用的模型名。"
                                      : "用于当前模型条目的逻辑标识，本地与在线配置会共享这个基准值。"}
                                  </p>
                                </div>

                                {showModelPathField ? (
                                  <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="model-path">{activeModelPreset?.pathLabel || "本地路径"}</Label>
                                    <Input
                                      id="model-path"
                                      className="bg-background/80"
                                      placeholder={
                                        isWhisperDialog
                                          ? "未就绪"
                                          : activeModelPreset?.pathPlaceholder || "可选：指定模型缓存目录或本地模型目录"
                                      }
                                      value={modelForm.path}
                                      readOnly={isWhisperDialog}
                                      onChange={(event) =>
                                        setModelForm((current) => ({ ...current, path: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      {isWhisperDialog
                                        ? "可选填写 Whisper 模型目录；下载或重置按钮不会替你自动回写默认目录。"
                                        : "未填写时优先使用当前已检测到的模型目录或默认托管目录。"}
                                    </p>
                                  </div>
                                ) : null}

                                {isWhisperDialog ? (
                                  <div className="space-y-4 rounded-xl border bg-muted/20 p-4 md:col-span-2">
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="space-y-1">
                                        <Label className="leading-tight">Whisper GPU 加速</Label>
                                        <p className="text-xs text-muted-foreground">
                                          本地转写当前通过 faster-whisper 执行；GPU 开关仅表示优先请求 CUDA，并不代表所有依赖都已完成实际验证。
                                        </p>
                                      </div>
                                      <Switch
                                        checked={Boolean(whisperConfig && whisperConfig.device !== "cpu")}
                                        disabled={!whisperConfig || isUpdatingWhisper}
                                        onCheckedChange={(checked) => {
                                          void handleGpuToggle(checked)
                                        }}
                                      />
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-3">
                                      <div className="rounded-xl border bg-background/70 px-4 py-3">
                                        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                          检测状态
                                        </p>
                                        <p className="mt-2 text-sm font-medium">
                                          {whisperConfig?.runtime_libraries.ready ? "Whisper 运行条件已就绪" : "Whisper 运行条件未就绪"}
                                        </p>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                          {whisperConfig?.runtime_libraries.message || "等待检测"}
                                        </p>
                                      </div>
                                      <div className="rounded-xl border bg-background/70 px-4 py-3">
                                        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                          生效目录
                                        </p>
                                        <p className="mt-2 break-all text-sm leading-6 text-foreground/90">
                                          {whisperConfig?.runtime_libraries.install_dir || whisperConfig?.runtime_libraries.bin_dir || "未返回相关目录信息"}
                                        </p>
                                      </div>
                                      <div className="rounded-xl border bg-background/70 px-4 py-3">
                                        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                          环境同步
                                        </p>
                                        <p className="mt-2 text-sm font-medium">
                                          {whisperConfig?.runtime_libraries.path_configured ? "当前进程已同步" : "当前进程未同步"}
                                        </p>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                          {whisperConfig?.runtime_libraries.version_label || "等待检测"}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed bg-background/70 px-4 py-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium">刷新检测</p>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                          重新读取 Whisper 运行条件检测结果，并同步当前页面显示。
                                        </p>
                                      </div>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={isUpdatingWhisper || isLoading}
                                        onClick={() => {
                                          void getWhisperConfig()
                                            .then((response) => {
                                              setWhisperConfig(response)
                                              toast.success("Whisper 运行条件状态已刷新")
                                            })
                                            .catch((error) => {
                                              toast.error(getApiErrorMessage(error, "刷新 Whisper 运行条件状态失败"))
                                            })
                                        }}
                                      >
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                        刷新检测
                                      </Button>
                                    </div>
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
                                      <SelectTrigger className="model-config-dialog-select-trigger bg-background/80">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="model-config-select-content">
                                        <SelectItem value="balanced">balanced</SelectItem>
                                        <SelectItem value="memory_first">memory_first</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      根据模型体积与硬件资源选择常驻或平衡模式。
                                    </p>
                                  </div>
                                ) : null}

                                {modelDialogHasQuantization && modelForm.provider !== "openai_compatible" ? (
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

                                {modelDialogHasRerankTopN ? (
                                  <div
                                    className={cn(
                                      "space-y-2",
                                      !activeModelPreset?.fields.includes("load_profile") && !modelDialogHasQuantization
                                        ? "md:col-span-2"
                                        : "",
                                    )}
                                  >
                                    <Label htmlFor="model-rerank-top-n">最终返回条数</Label>
                                    <Input
                                      id="model-rerank-top-n"
                                      className="bg-background/80"
                                      type="number"
                                      min={1}
                                      max={20}
                                      value={modelForm.rerank_top_n}
                                      onChange={(event) =>
                                        setModelForm((current) => ({
                                          ...current,
                                          rerank_top_n: event.target.value,
                                        }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      控制最终排序后交给问答模型的候选数量，前端问答界面会直接使用这里的默认值。
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

                            {showRemoteApiFields ? (
                              <div className="model-config-dialog-panel rounded-xl border bg-card p-5 md:p-6">
                                <div className="space-y-1">
                                  <div className="text-base font-semibold leading-tight">在线 API 配置</div>
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    为当前组件单独配置 Base URL、模型名与鉴权信息。后端会根据服务地址和模型类型自动选择兼容适配方式。
                                  </p>
                                </div>

                                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                                  <div className="space-y-2 md:col-span-2">
                                    <Label htmlFor="remote-base-url">Base URL</Label>
                                    <Input
                                      id="remote-base-url"
                                      className="bg-background/80"
                                      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                                      value={modelForm.api_base_url}
                                      onChange={(event) =>
                                        setModelForm((current) => ({ ...current, api_base_url: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      使用兼容 OpenAI 的服务入口地址，通常以 `/v1` 结尾。
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="remote-model">调用模型名</Label>
                                    <Input
                                      id="remote-model"
                                      className="bg-background/80"
                                      placeholder={remoteModelRecommendations.join(" / ") || "填写远端模型名"}
                                      value={modelForm.api_model}
                                      onChange={(event) =>
                                        setModelForm((current) => ({ ...current, api_model: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      与提供商控制台中的可调用模型名保持一致。
                                      {remoteModelRecommendations.length > 0 ? ` 推荐：${remoteModelRecommendations.join("、")}` : ""}
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="remote-api-key">API Key</Label>
                                    <Input
                                      id="remote-api-key"
                                      className="bg-background/80"
                                      type="password"
                                      placeholder="输入模型提供商的 API Key"
                                      value={modelForm.api_key}
                                      onChange={(event) =>
                                        setModelForm((current) => ({ ...current, api_key: event.target.value }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      仅当前组件会读取这里的密钥配置。
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <Label htmlFor="remote-timeout">超时（秒）</Label>
                                    <Input
                                      id="remote-timeout"
                                      className="bg-background/80"
                                      type="number"
                                      min={10}
                                      max={600}
                                      value={modelForm.api_timeout_seconds}
                                      onChange={(event) =>
                                        setModelForm((current) => ({
                                          ...current,
                                          api_timeout_seconds: event.target.value,
                                        }))
                                      }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      控制当前组件请求远端接口的超时窗口。
                                    </p>
                                  </div>

                                </div>
                              </div>
                            ) : null}

                            {showLlmCorrectionFields ? (
                              <div className="model-config-dialog-panel rounded-xl border bg-card p-5 md:p-6">
                                <div className="space-y-1">
                                  <div className="text-base font-semibold leading-tight">文本纠错设置</div>
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    这部分会同步到摘要与纠错链路，恢复转写文本优化阶段的可调参数。
                                  </p>
                                </div>

                                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
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
                                      <SelectTrigger className="model-config-dialog-select-trigger bg-background/80">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="model-config-select-content">
                                        <SelectItem value="off">off</SelectItem>
                                        <SelectItem value="strict">strict</SelectItem>
                                        <SelectItem value="rewrite">rewrite</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                      控制转写纠错阶段对原文的保守程度。
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

                      <DialogFooter className="model-config-dialog-footer shrink-0 border-t bg-card px-6 py-3">
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
              <>
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
                        <DialogContent className="prompt-config-dialog flex w-[min(96vw,88rem)] max-h-[min(90vh,60rem)] max-w-[88rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-[88rem]">
                          <DialogHeader className="prompt-config-dialog-header shrink-0 border-b px-6 py-2.5 pr-10">
                            <DialogTitle className="text-base font-semibold leading-tight">
                              {promptDialogMode === "view"
                                ? editingPrompt?.name || "查看提示词模板"
                                : editingPrompt
                                  ? "编辑提示词模板"
                                  : "新建提示词模板"}
                            </DialogTitle>
                            {isPromptReadOnly ? null : (
                              <DialogDescription className="text-[11px] leading-normal">
                                配置用于特定任务的提示词模板
                              </DialogDescription>
                            )}
                          </DialogHeader>
                          <div className="prompt-config-dialog-scroll themed-thin-scrollbar dialog-ultra-thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
                            {isPromptReadOnly ? (
                              <section className="space-y-3">
                                <div className="prompt-config-dialog-panel rounded-xl border bg-card p-4">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={cn("shrink-0", promptTagClassNames[promptForm.channel])}
                                    >
                                      {promptTypeLabels[promptForm.channel]}
                                    </Badge>
                                    {editingPrompt?.is_default ? <Badge variant="secondary">默认</Badge> : null}
                                    {editingPrompt && promptBundle?.selection[editingPrompt.channel] === editingPrompt.id ? (
                                      <Badge>当前生效</Badge>
                                    ) : null}
                                  </div>
                                  <div className="mt-4">
                                    <PromptMarkdownEditor
                                      value={promptForm.content}
                                      colorMode={markdownColorMode}
                                      height={520}
                                      readOnly
                                      onChange={() => {}}
                                    />
                                  </div>
                                </div>
                              </section>
                            ) : (
                              <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                                <section className="space-y-4">
                                  <div className="prompt-config-dialog-panel rounded-xl border bg-card p-4">
                                    <div className="space-y-4">
                                      <div className="grid gap-4">
                                        <div className="space-y-2">
                                          <Label>模板名称</Label>
                                          <Input
                                            placeholder="输入模板名称"
                                            value={promptForm.name}
                                            onChange={(event) =>
                                              setPromptForm((current) => ({
                                                ...current,
                                                name: event.target.value,
                                              }))
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
                                            <SelectTrigger className="prompt-config-dialog-select-trigger">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="prompt-config-select-content">
                                              <SelectItem value="correction">文本纠错</SelectItem>
                                              <SelectItem value="notes">笔记生成</SelectItem>
                                              <SelectItem value="mindmap">思维导图</SelectItem>
                                              <SelectItem value="vqa">问答检索</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                      <div className="rounded-xl border bg-muted/35 px-4 py-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                          <Badge
                                            variant="outline"
                                            className={cn("shrink-0", promptTagClassNames[promptForm.channel])}
                                          >
                                            {promptTypeLabels[promptForm.channel]}
                                          </Badge>
                                          <p className="text-sm leading-relaxed text-muted-foreground">
                                            {promptDescriptions[promptForm.channel]}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </section>

                                <section className="space-y-3">
                                  <div className="prompt-config-dialog-panel rounded-xl border bg-card p-4">
                                    <div className="space-y-1">
                                      <Label className="text-sm font-medium">提示词内容</Label>
                                      <p className="text-xs text-muted-foreground">
                                        左侧编辑，右侧预览；支持 {"{text}"} 和 {"{context}"} 占位符。
                                      </p>
                                    </div>
                                    <div className="mt-4">
                                      <PromptMarkdownEditor
                                        value={promptForm.content}
                                        colorMode={markdownColorMode}
                                        height={520}
                                        placeholder="输入提示词内容，使用 {text} 作为输入文本占位符"
                                        onChange={(value) =>
                                          setPromptForm((current) => ({
                                            ...current,
                                            content: value,
                                          }))
                                        }
                                      />
                                    </div>
                                  </div>
                                </section>
                              </div>
                            )}
                          </div>
                          <DialogFooter className="prompt-config-dialog-footer shrink-0 border-t px-6 py-3">
                            <Button variant="outline" onClick={() => handlePromptDialogChange(false)}>
                              {isPromptReadOnly ? "关闭" : "取消"}
                            </Button>
                            {isPromptReadOnly ? null : (
                              <Button disabled={isSavingPrompt} onClick={() => void handleSavePrompt()}>
                                <Save className="h-4 w-4 mr-2" />
                                保存
                              </Button>
                            )}
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {promptBundle?.templates.map((prompt) => {
                      const isSelected = promptBundle.selection[prompt.channel] === prompt.id
                      return (
                        <div key={prompt.id} className="prompt-template-card rounded-lg border p-4">
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
                              {prompt.is_default ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label="查看模板"
                                  onClick={() => handleViewPromptClick(prompt)}
                                >
                                  <BookOpen className="h-4 w-4" />
                                </Button>
                              ) : (
                                <>
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
                                      setPendingDeletePrompt(prompt)
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="prompt-template-preview-shell mt-3 rounded bg-muted p-3">
                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">
                              {prompt.content}
                            </pre>
                          </div>
                        </div>
                      )
                    })}
                    {promptBundle?.templates.length === 0 && !isLoading && (
                      <div className="prompt-template-empty rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                        当前没有模板数据
                      </div>
                    )}
                  </CardContent>
                </Card>
                <PromptLabPanel promptBundle={promptBundle} />
              </>
            )}

            {activeSection === "appearance" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">外观设置</CardTitle>
                  <CardDescription>自定义应用的视觉外观</CardDescription>
                </CardHeader>
                <CardContent className="settings-appearance-shell space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>主题色调</Label>
                  </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground">{themeHue[0]}°</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="appearance-action-button"
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
                            data-active={isActive}
                            className={cn(
                              "appearance-theme-chip rounded-xl border px-3 py-3 text-left transition-all",
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
                      <span>暖色</span>
                    </div>
                  </div>

                  <Separator className="settings-models-divider" />

                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2.5">
                          <Sparkles className="h-4 w-4 text-primary drop-shadow-[0_0_10px_color-mix(in_oklch,var(--primary)_48%,transparent)]" />
                          <h3 className="text-base font-medium">自定义换肤</h3>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          className="appearance-action-button"
                          disabled={isSavingUi}
                          onClick={() => {
                            void handleOpenSkinPicker()
                          }}
                        >
                          选择换肤图片
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="appearance-action-button"
                          disabled={isSavingUi || !hasSkinImage}
                          onClick={() => {
                            setPendingSkinImage(null)
                            setIsSkinDialogOpen(true)
                          }}
                        >
                          调整当前换肤
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="appearance-action-button"
                          disabled={isSavingUi || !hasSkinImage}
                          onClick={handleClearBackgroundImage}
                        >
                          清除
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 rounded-xl border bg-card p-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(18rem,0.75fr)]">
                      <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
                        <div ref={skinPreviewRef} className="relative h-52 overflow-hidden">
                          {hasSkinImage ? (
                            <>
                            <WebGLBlurCanvas
                              src={uiSettings.background_image}
                              width={skinPreviewSize.width}
                              height={skinPreviewSize.height}
                              imageRect={skinPreviewLayout}
                              blur={skinPreviewBlur}
                              opacity={uiSettings.background_image_opacity / 100}
                              className="pointer-events-none absolute inset-0 h-full w-full"
                              pixelRatioCap={1.5}
                              quality="performance"
                            />
                            <div className="absolute inset-0 bg-background/24" />
                            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between border-t border-white/8 bg-background/56 px-4 py-2.5 backdrop-blur-sm">
                              <div>
                                <p className="text-sm font-medium">当前换肤已启用</p>
                                <p className="text-xs text-muted-foreground">
                                  全局背景、侧栏和顶部栏正在使用同一套换肤图层。
                                </p>
                              </div>
                              <div className="text-right text-xs text-muted-foreground">
                                <p>{uiSettings.background_image_opacity}% 透明度</p>
                                <p>{uiSettings.background_image_blur}px 模糊度</p>
                              </div>
                            </div>
                            </>
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                              <Sparkles className="h-5 w-5 text-primary/70" />
                              <p className="text-sm font-medium">当前未设置换肤图片</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-4 rounded-xl border border-border/70 bg-muted/10 p-4">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">换肤状态</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border bg-card px-3 py-3">
                            <p className="text-xs text-muted-foreground">状态</p>
                            <p className="mt-1 text-sm font-medium">{hasSkinImage ? "已启用" : "未设置"}</p>
                          </div>
                          <div className="rounded-lg border bg-card px-3 py-3">
                            <p className="text-xs text-muted-foreground">缩放倍率</p>
                            <p className="mt-1 text-sm font-medium">{Math.round(uiSettings.background_image_scale * 100)}%</p>
                          </div>
                          <div className="rounded-lg border bg-card px-3 py-3">
                            <p className="text-xs text-muted-foreground">焦点位置</p>
                            <p className="mt-1 text-sm font-medium">
                              {Math.round(uiSettings.background_image_focus_x * 100)}% / {Math.round(uiSettings.background_image_focus_y * 100)}%
                            </p>
                          </div>
                          <div className="rounded-lg border bg-card px-3 py-3">
                            <p className="text-xs text-muted-foreground">模糊 / 透明</p>
                            <p className="mt-1 text-sm font-medium">
                              {uiSettings.background_image_blur}px / {uiSettings.background_image_opacity}%
                            </p>
                          </div>
                        </div>
                      </div>
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

                  <Separator />
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
                  <Separator />
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="study-default-translation-target">Study 默认翻译目标</Label>
                      <p className="text-sm text-muted-foreground">
                        当在线视频没有可直接复用的翻译字幕轨时，Study 工作台会优先用这里的目标语言匹配可用翻译结果。
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        id="study-default-translation-target"
                        value={studyDefaultTranslationTarget}
                        onChange={(event) => setStudyDefaultTranslationTarget(event.target.value)}
                        onBlur={handleSaveStudyDefaultTranslationTarget}
                        placeholder="例如 en / ja / zh-Hans"
                        className="w-full max-w-sm"
                        disabled={isSavingUi}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSavingUi}
                        onClick={handleSaveStudyDefaultTranslationTarget}
                      >
                        保存
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isSavingUi || !studyDefaultTranslationTarget.trim()}
                        onClick={() => {
                          setStudyDefaultTranslationTarget("")
                          void handleUiSettingChange({ study_default_translation_target: null }, "Study 默认翻译目标已清除")
                        }}
                      >
                        清除
                      </Button>
                    </div>
                  </div>
                  <Separator />
                </CardContent>
              </Card>
            )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <CustomSkinDialog
        open={isSkinDialogOpen}
        uiSettings={uiSettings}
        pickedImage={pendingSkinImage}
        isSaving={isSavingUi}
        onOpenChange={handleSkinDialogChange}
        onPreviewChange={onUiSettingsPreviewChange}
        onRequestPickImage={requestSkinImage}
        onSave={async (patch) => {
          await handleUiSettingChange(patch, patch.background_image ? "自定义换肤已更新" : "自定义换肤已清除")
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingLocalMigrationConfirmation)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingLocalMigrationConfirmation(null)
          }
        }}
        title="确认继续批量迁移本地模型？"
        description={
          pendingLocalMigrationConfirmation
            ? `检测到 ${pendingLocalMigrationConfirmation.running_tasks.length} 个进行中的任务，继续迁移会在完成后自动重启 Ollama 服务，可能影响当前分析任务。`
            : "继续迁移会在完成后自动重启 Ollama 服务。"
        }
        confirmLabel="继续迁移"
        isPending={isMigratingLocalModels}
        onConfirm={() => {
          void handleMigrateLocalModels(true)
        }}
      />
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
