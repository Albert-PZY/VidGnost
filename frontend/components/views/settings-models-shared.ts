"use client"

import type { ElementType } from "react"
import { Cpu, Sparkles } from "lucide-react"

import type { LLMConfigResponse, ModelDescriptor } from "@/lib/types"

export const modelTypeLabels: Record<string, string> = {
  whisper: "语音转写",
  llm: "大语言模型",
  embedding: "嵌入模型",
  vlm: "视觉语言模型",
  rerank: "重排序模型",
  mllm: "全模态模型",
}

export const modelTypeTagClassNames: Record<string, string> = {
  whisper: "border-indigo-800/75 text-indigo-700 dark:border-indigo-400/55 dark:text-indigo-300",
  llm: "border-cyan-800/75 text-cyan-700 dark:border-cyan-400/55 dark:text-cyan-300",
  embedding: "border-emerald-800/75 text-emerald-700 dark:border-emerald-400/55 dark:text-emerald-300",
  vlm: "border-rose-800/75 text-rose-700 dark:border-rose-400/55 dark:text-rose-300",
  rerank: "border-amber-800/75 text-amber-700 dark:border-amber-400/55 dark:text-amber-300",
  mllm: "border-fuchsia-800/75 text-fuchsia-700 dark:border-fuchsia-400/55 dark:text-fuchsia-300",
}

export const providerLabels: Record<string, string> = {
  local: "本地目录",
  ollama: "Ollama",
  openai_compatible: "在线 API",
}

export function getModelStatusMeta(status: ModelDescriptor["status"]) {
  switch (status) {
    case "ready":
      return {
        label: "就绪",
        variant: "default" as const,
        className: "bg-status-success text-white",
      }
    case "loading":
      return {
        label: "加载中",
        variant: "secondary" as const,
        className: "bg-status-processing text-white",
      }
    case "not_ready":
      return {
        label: "未就绪",
        variant: "outline" as const,
        className: "",
      }
    case "error":
      return {
        label: "错误",
        variant: "destructive" as const,
        className: "",
      }
    default:
      return {
        label: status,
        variant: "outline" as const,
        className: "",
      }
  }
}

export const recommendedRemoteModels: Partial<Record<ModelDescriptor["component"], string[]>> = {
  llm: ["qwen3.5-plus"],
  vlm: ["qwen-image-2.0"],
  embedding: ["qwen3-vl-embedding"],
  rerank: ["qwen3-vl-rerank"],
  mllm: ["qwen3.5-omni-flash"],
}

export const modelRouteGuides: Record<
  ModelDescriptor["component"],
  {
    summary: string
    impact: string
    setupHint: string
  }
> = {
  whisper: {
    summary: "负责把原始语音转成可搜索、可整理的文本，是全部链路的起点。",
    impact: "会直接影响转写质量、时间轴切分和后续摘要输入。",
    setupHint: "优先确认模型目录与 GPU 模式，再微调精度和加载策略。",
  },
  llm: {
    summary: "负责文本纠错、摘要、笔记、思维导图和问答生成，是主输出核心。",
    impact: "会影响最终文本风格、推理质量和响应速度。",
    setupHint: "先选接入方式，再决定是否启用文本纠错以及批处理策略。",
  },
  embedding: {
    summary: "负责把文本或图文线索编码成向量，用于召回相关证据。",
    impact: "主要影响问答时能否召回足够准确的候选内容。",
    setupHint: "优先保证稳定可用，再根据机器负载提高批大小。",
  },
  vlm: {
    summary: "负责理解关键帧中的画面信息，补足纯文本无法表达的视觉证据。",
    impact: "会影响问答时的画面证据密度和语义覆盖范围。",
    setupHint: "先确认模型可用，再调抽帧间隔和量化方式。",
  },
  rerank: {
    summary: "负责对候选证据做二次排序，决定最终交给问答模型的上下文质量。",
    impact: "会影响问答证据的精确度，以及最终回答引用的可信度。",
    setupHint: "一般先调最终返回条数，再视情况增加批大小。",
  },
  mllm: {
    summary: "负责图文联合理解和回答，是全模态检索路线的核心开关。",
    impact: "配置就绪后，系统可以直接走图文联合处理而不是图文分离路线。",
    setupHint: "优先确认在线接口配置，再根据远端吞吐限制控制并发上限。",
  },
}

export const modelGroupDefinitions: Array<{
  id: string
  title: string
  description: string
  components: ModelDescriptor["component"][]
}> = [
  {
    id: "transcription",
    title: "输入与转写",
    description: "先把音视频转成稳定文本，再进入摘要、问答和检索链路。",
    components: ["whisper", "llm"],
  },
  {
    id: "retrieval",
    title: "检索与证据排序",
    description: "控制证据召回范围和重排质量，决定问答上下文够不够准。",
    components: ["embedding", "rerank"],
  },
  {
    id: "vision",
    title: "画面理解与全模态路线",
    description: "决定关键帧理解、图文联合检索和全模态回答能力是否启用。",
    components: ["vlm", "mllm"],
  },
]

export type ModelConfigFormState = {
  provider: string
  model_id: string
  path: string
  load_profile: string
  quantization: string
  max_batch_size: string
  rerank_top_n: string
  frame_interval_seconds: string
  enabled: boolean
  api_base_url: string
  api_key: string
  api_model: string
  api_timeout_seconds: string
  api_image_max_bytes: string
  api_image_max_edge: string
}

export type ModelConfigField = keyof ModelConfigFormState

export type ModelConfigPreset = {
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

export type LLMConfigFormState = {
  correction_mode: LLMConfigResponse["correction_mode"]
  correction_batch_size: string
  correction_overlap: string
}

export type OllamaRuntimeFormState = {
  install_dir: string
  executable_path: string
  models_dir: string
  base_url: string
}

export const EMPTY_MODEL_FORM: ModelConfigFormState = {
  provider: "ollama",
  model_id: "",
  path: "",
  load_profile: "balanced",
  quantization: "",
  max_batch_size: "1",
  rerank_top_n: "8",
  frame_interval_seconds: "10",
  enabled: true,
  api_base_url: "",
  api_key: "",
  api_model: "",
  api_timeout_seconds: "120",
  api_image_max_bytes: "524288",
  api_image_max_edge: "1280",
}

export const EMPTY_LLM_FORM: LLMConfigFormState = {
  correction_mode: "strict",
  correction_batch_size: "24",
  correction_overlap: "3",
}

export const EMPTY_OLLAMA_RUNTIME_FORM: OllamaRuntimeFormState = {
  install_dir: "",
  executable_path: "",
  models_dir: "",
  base_url: "http://127.0.0.1:11434",
}

export type ModelConfigDraftEntry = {
  model_id: string
  provider: string
  component: string
  model_form: ModelConfigFormState
  llm_form: LLMConfigFormState
}

export const modelVisuals: Record<
  ModelDescriptor["component"],
  {
    icon: ElementType
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
  mllm: {
    icon: Sparkles,
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

const MODEL_CONFIG_DRAFT_STORAGE_KEY = "vidgnost:model-config-draft:v1"

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

export function readModelConfigDraft(modelId: string): ModelConfigDraftEntry | null {
  const draftMap = readModelConfigDraftMap()
  return draftMap[modelId] ?? null
}

export function saveModelConfigDraft(entry: ModelConfigDraftEntry): void {
  const draftMap = readModelConfigDraftMap()
  draftMap[entry.model_id] = entry
  writeModelConfigDraftMap(draftMap)
}

export function clearModelConfigDraft(modelId: string): void {
  const draftMap = readModelConfigDraftMap()
  if (!(modelId in draftMap)) {
    return
  }
  delete draftMap[modelId]
  writeModelConfigDraftMap(draftMap)
}

export function getModelProviderOptions(model: ModelDescriptor) {
  if (model.component === "whisper") {
    return [{ value: "local", label: providerLabels.local }]
  }
  if (model.component === "mllm") {
    return [{ value: "openai_compatible", label: providerLabels.openai_compatible }]
  }
  return [
    { value: "ollama", label: providerLabels.ollama },
    { value: "openai_compatible", label: providerLabels.openai_compatible },
  ]
}

export function getModelConfigPreset(model: Pick<ModelDescriptor, "component" | "provider">): ModelConfigPreset {
  if (model.component === "whisper") {
    return {
      title: "语音转写模型配置",
      description: "调整 Faster-Whisper 模型目录与加载策略，并在当前弹窗内切换 GPU 加速。",
      note: "Whisper GPU 模式会自动复用 Ollama 自带的 CUDA 运行库，无需单独安装额外运行库。",
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
      description: "控制关键帧语义识别模型的本地目录、量化方式和抽帧节奏。",
      note: "抽帧间隔会直接影响检索时附带的画面证据密度，数值越小越细，但生成和存储开销也越高。",
      fields: ["path", "load_profile", "quantization", "frame_interval_seconds", "enabled"],
      pathLabel: "模型目录",
      pathPlaceholder: "可选：指定 VLM 模型目录",
      quantizationLabel: "权重量化",
      quantizationPlaceholder: "如 4bit / 8bit / fp16",
      batchLabel: "抽帧间隔（秒）",
      batchDescription: "用于控制问答证据图的抽帧频率，默认每 10 秒抽取一张。",
    }
  }

  if (model.component === "mllm") {
    return {
      title: "全模态模型配置",
      description: "控制图文联合问答模型的路由启用与在线接口参数。",
      note: "当全模态模型与多模态 Embedding 同时就绪时，RAG 会切换到图文联合检索路线。",
      fields: ["load_profile", "max_batch_size", "enabled"],
      batchLabel: "并发请求上限",
      batchDescription: "控制图文联合请求的并发规模，避免远端接口抖动。",
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

export function createModelForm(model: ModelDescriptor): ModelConfigFormState {
  return {
    provider: model.provider,
    model_id: model.model_id,
    path: model.path || model.default_path || "",
    load_profile: model.load_profile || "balanced",
    quantization: model.quantization || "",
    max_batch_size: String(model.max_batch_size || 1),
    rerank_top_n: String(model.rerank_top_n || 8),
    frame_interval_seconds: String(model.frame_interval_seconds || 10),
    enabled: model.enabled,
    api_base_url: model.api_base_url || "",
    api_key: model.api_key || "",
    api_model: model.api_model || "",
    api_timeout_seconds: String(model.api_timeout_seconds || 120),
    api_image_max_bytes: String(model.api_image_max_bytes || 524288),
    api_image_max_edge: String(model.api_image_max_edge || 1280),
  }
}

export function createLlmForm(
  model: ModelDescriptor,
  llmConfig: LLMConfigResponse | null,
): LLMConfigFormState {
  if (model.component !== "llm" || !llmConfig) {
    return EMPTY_LLM_FORM
  }
  return {
    correction_mode: llmConfig.correction_mode,
    correction_batch_size: String(llmConfig.correction_batch_size),
    correction_overlap: String(llmConfig.correction_overlap),
  }
}
