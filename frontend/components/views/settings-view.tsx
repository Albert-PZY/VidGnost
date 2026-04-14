"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import {
  Cpu,
  FileCode,
  FolderOpen,
  Palette,
  Globe,
  Plus,
  Trash2,
  Edit2,
  Save,
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
import { SettingsModelConfigDialog } from "@/components/views/settings-model-config-dialog"
import { SettingsModelsSection } from "@/components/views/settings-models-section"
import {
  EMPTY_LLM_FORM,
  EMPTY_MODEL_FORM,
  EMPTY_OLLAMA_RUNTIME_FORM,
  clearModelConfigDraft,
  createLlmForm,
  createModelForm,
  getModelConfigPreset,
  modelTypeLabels,
  readModelConfigDraft,
  saveModelConfigDraft,
  type LLMConfigFormState,
  type ModelConfigFormState,
  type OllamaRuntimeFormState,
} from "@/components/views/settings-models-shared"
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

  const buildModelUpdatePayload = (model: ModelDescriptor, form: ModelConfigFormState) => {
    const preset = getModelConfigPreset(model)
    const payload: Parameters<typeof updateModel>[1] = {}
    const parsedBatchSize = Number.parseInt(form.max_batch_size, 10)
    const parsedRerankTopN = Number.parseInt(form.rerank_top_n, 10)
    const parsedFrameInterval = Number.parseInt(form.frame_interval_seconds, 10)
    const parsedTimeoutSeconds = Number.parseInt(form.api_timeout_seconds, 10)
    const parsedImageMaxBytes = Number.parseInt(form.api_image_max_bytes, 10)
    const parsedImageMaxEdge = Number.parseInt(form.api_image_max_edge, 10)

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
    if (preset.fields.includes("frame_interval_seconds")) {
      payload.frame_interval_seconds = Number.isFinite(parsedFrameInterval) ? parsedFrameInterval : 10
    }
    if (preset.fields.includes("enabled")) {
      payload.enabled = form.enabled
    }
    payload.api_base_url = form.api_base_url.trim()
    payload.api_key = form.api_key.trim()
    payload.api_model = form.api_model.trim()
    payload.api_timeout_seconds = Number.isFinite(parsedTimeoutSeconds) ? parsedTimeoutSeconds : 120
    payload.api_image_max_bytes = Number.isFinite(parsedImageMaxBytes) ? parsedImageMaxBytes : 524288
    payload.api_image_max_edge = Number.isFinite(parsedImageMaxEdge) ? parsedImageMaxEdge : 1280

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
    const nextModelForm = createModelForm(model)
    const nextLlmForm = createLlmForm(model, llmConfig)
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

  const handleBrowseOllamaDirectory = async (
    field: "install_dir" | "models_dir",
    title: string,
  ) => {
    if (!window.vidGnostDesktop?.pickDirectory) {
      toast("当前环境不支持目录选择，请直接手动填写路径。")
      return
    }
    const picked = await window.vidGnostDesktop.pickDirectory(title)
    if (picked.canceled || !picked.path) {
      return
    }
    setOllamaRuntimeDirty(true)
    setOllamaRuntimeForm((current) => ({
      ...current,
      [field]: picked.path || current[field],
    }))
  }

  const handleSaveOllamaRuntimeConfig = async () => {
    if (!ollamaRuntimeForm.install_dir.trim() || !ollamaRuntimeForm.models_dir.trim()) {
      toast.error("请先填写 Ollama 安装目录和模型目录")
      return
    }
    setIsUpdatingOllamaRuntime(true)
    try {
      const response = await updateOllamaRuntimeConfig({
        install_dir: ollamaRuntimeForm.install_dir.trim(),
        executable_path: ollamaRuntimeForm.executable_path.trim(),
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
      toast.success(ollamaResponse.service.message || "Ollama 服务已启动")
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

  const handleBrowseModelPath = async () => {
    if (!editingModel) {
      return
    }
    if (!window.vidGnostDesktop?.pickDirectory) {
      toast("当前环境不支持目录选择，请直接手动填写路径。")
      return
    }
    const preset = getModelConfigPreset(editingModel)
    const picked = await window.vidGnostDesktop.pickDirectory(`选择${preset.pathLabel || editingModel.name}目录`)
    if (picked.canceled || !picked.path) {
      return
    }
    setModelForm((current) => ({
      ...current,
      path: picked.path || current.path,
    }))
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
      toast.error("请先确认 Ollama 已安装并刷新检测到 GPU 运行库，再启用 Whisper GPU 加速。")
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

  const handleRefreshWhisperRuntimeStatus = async () => {
    try {
      const response = await getWhisperConfig()
      setWhisperConfig(response)
      toast.success("Whisper GPU 运行库状态已刷新")
    } catch (error) {
      toast.error(getApiErrorMessage(error, "刷新 Whisper GPU 运行库状态失败"))
    }
  }

  const localConfiguredModels = React.useMemo(
    () => models.filter((model) => model.provider === "local" || model.provider === "ollama"),
    [models],
  )
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
              <>
                <SettingsModelsSection
                  models={models}
                  isLoading={isLoading}
                  busyModelId={busyModelId}
                  ollamaConfig={ollamaConfig}
                  ollamaRuntimeForm={ollamaRuntimeForm}
                  localConfiguredModels={localConfiguredModels}
                  isRestartingOllamaService={isRestartingOllamaService}
                  onReloadModel={(modelId) => {
                    void handleReloadModel(modelId)
                  }}
                  onManagedModelAction={(model) => {
                    void handleManagedModelAction(model)
                  }}
                  onConfigureModel={handleConfigureModel}
                  onOpenOllamaConfig={() => setIsOllamaRuntimeDialogOpen(true)}
                  onOpenLocalMigration={() => setIsLocalMigrationDialogOpen(true)}
                  onRestartOllamaService={() => {
                    void handleRestartOllamaService()
                  }}
                />

                  <Dialog open={isOllamaRuntimeDialogOpen} onOpenChange={setIsOllamaRuntimeDialogOpen}>
                    <DialogContent className="sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Ollama 运行时配置</DialogTitle>
                        <DialogDescription>
                          配置 Ollama 安装目录、模型安装目录、可执行文件与服务地址，并自动同步 PATH 与 OLLAMA_MODELS。
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="ollama-install-dir">安装目录</Label>
                            <div className="flex gap-2">
                              <Input
                                id="ollama-install-dir"
                                className="bg-background/80"
                                value={ollamaRuntimeForm.install_dir}
                                onChange={(event) => {
                                  setOllamaRuntimeDirty(true)
                                  setOllamaRuntimeForm((current) => ({ ...current, install_dir: event.target.value }))
                                }}
                                placeholder="如 D:\\AI\\Ollama"
                              />
                              <Button
                                variant="outline"
                                className="shrink-0"
                                onClick={() => {
                                  void handleBrowseOllamaDirectory("install_dir", "选择 Ollama 安装目录")
                                }}
                              >
                                <FolderOpen className="mr-2 h-4 w-4" />
                                浏览
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="ollama-executable">可执行文件</Label>
                            <Input
                              id="ollama-executable"
                              className="bg-background/80"
                              value={ollamaRuntimeForm.executable_path}
                              onChange={(event) => {
                                setOllamaRuntimeDirty(true)
                                setOllamaRuntimeForm((current) => ({ ...current, executable_path: event.target.value }))
                              }}
                              placeholder="如 D:\\AI\\Ollama\\ollama.exe"
                            />
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
                                  void handleBrowseOllamaDirectory("models_dir", "选择 Ollama 模型目录")
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
                                    <Badge variant="outline">{modelTypeLabels[model.component]}</Badge>
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

                  <SettingsModelConfigDialog
                    open={isModelDialogOpen}
                    editingModel={editingModel}
                    modelForm={modelForm}
                    llmForm={llmForm}
                    whisperConfig={whisperConfig}
                    isSavingModel={isSavingModel}
                    isUpdatingWhisper={isUpdatingWhisper}
                    isLoading={isLoading}
                    onOpenChange={handleModelDialogChange}
                    onSave={() => {
                      void handleSaveModelConfig()
                    }}
                    onRefreshWhisperRuntimeStatus={() => {
                      void handleRefreshWhisperRuntimeStatus()
                    }}
                    onBrowseModelPath={() => {
                      void handleBrowseModelPath()
                    }}
                    onGpuToggle={(checked) => {
                      void handleGpuToggle(checked)
                    }}
                    setModelForm={setModelForm}
                    setLlmForm={setLlmForm}
                  />
              </>
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
                              {editingPrompt ? "编辑提示词模板" : "新建提示词模板"}
                            </DialogTitle>
                            <DialogDescription className="text-[11px] leading-normal">
                              配置用于特定任务的提示词模板
                            </DialogDescription>
                          </DialogHeader>
                          <div className="prompt-config-dialog-scroll themed-thin-scrollbar dialog-ultra-thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
                          </div>
                          <DialogFooter className="prompt-config-dialog-footer shrink-0 border-t px-6 py-3">
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
