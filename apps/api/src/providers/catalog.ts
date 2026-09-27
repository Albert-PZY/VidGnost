import type {
  ModelCatalogEntry,
  ModelRole,
  ModelRoute,
  ProviderConfig,
  ProviderProtocol,
  ProviderProtocolInfo,
} from "@vidgnost/contracts"

/** 阿里云百炼（DashScope）在本次基线中可用的免费模型集合。 */
export const DASHSCOPE_CATALOG: ModelCatalogEntry[] = [
  {
    id: "qwen3.8-flash",
    provider: "dashscope",
    kind: "chat",
    label: "Qwen3.8 Flash",
    description: "低延迟通用模型，适合分段、查询改写与批量小任务。",
    tags: ["快速", "通用"],
    contextWindow: 131_072,
    free: true,
    recommendedFor: ["llm.fast"],
  },
  {
    id: "qwen3.8-27b",
    provider: "dashscope",
    kind: "chat",
    label: "Qwen3.8 27B",
    description: "均衡档，章节切分与结构化输出的默认选择。",
    tags: ["均衡", "结构化"],
    contextWindow: 131_072,
    free: true,
    recommendedFor: ["llm.balanced"],
  },
  {
    id: "qwen3.8-max-0902",
    provider: "dashscope",
    kind: "chat",
    label: "Qwen3.8 Max",
    description: "高质量档，用于全局归并与最终报告润色。",
    tags: ["高质量", "长文"],
    contextWindow: 262_144,
    free: true,
    recommendedFor: ["llm.quality"],
  },
  {
    id: "qwen3.8-2.4t-a95b",
    provider: "dashscope",
    kind: "chat",
    label: "Qwen3.8 2.4T A95B",
    description: "超长上下文，适合把多章摘要一次性归并。",
    tags: ["超长上下文", "归并"],
    contextWindow: 1_000_000,
    free: true,
    recommendedFor: ["llm.bulk"],
  },
  {
    id: "deepseek-v4-flash-0731",
    provider: "dashscope",
    kind: "chat",
    label: "DeepSeek V4 Flash",
    description: "成本友好的兜底模型，任一角色失败时接管。",
    tags: ["兜底", "快速"],
    contextWindow: 131_072,
    free: true,
    recommendedFor: ["llm.fallback"],
  },
  {
    id: "deepseek-v4-pro-0813",
    provider: "dashscope",
    kind: "chat",
    label: "DeepSeek V4 Pro",
    description: "强推理模型，深度思考链，token 预算需放大。",
    tags: ["推理", "深度"],
    contextWindow: 163_840,
    free: true,
    recommendedFor: ["llm.reasoning"],
  },
  {
    id: "glm-5.3",
    provider: "dashscope",
    kind: "chat",
    label: "GLM-5.3",
    description: "智谱模型，中文写作与要点提炼表现稳定。",
    tags: ["中文", "写作"],
    contextWindow: 131_072,
    free: true,
    recommendedFor: ["llm.balanced"],
  },
  {
    id: "qwen3.8-omni-flash",
    provider: "dashscope",
    kind: "vision",
    label: "Qwen3.8 Omni Flash",
    description: "多模态理解，用于关键帧图注与屏上文字提取。",
    tags: ["多模态", "视觉"],
    contextWindow: 131_072,
    free: true,
    recommendedFor: ["vision.primary"],
  },
  {
    id: "qwen3.8-omni-flash-realtime",
    provider: "dashscope",
    kind: "vision",
    label: "Qwen3.8 Omni Flash Realtime",
    description: "实时多模态通道，当前基线未启用。",
    tags: ["实时", "多模态"],
    free: true,
  },
  {
    id: "qwen-mt-uni",
    provider: "dashscope",
    kind: "translation",
    label: "Qwen MT Uni",
    description: "批量翻译，单次可提交多段文本（`input.source_texts`）。",
    tags: ["翻译", "批量"],
    free: true,
    recommendedFor: ["translate"],
  },
  {
    id: "qwen-audio-3.1-asr-flash-filetrans",
    provider: "dashscope",
    kind: "asr",
    label: "Qwen Audio 3.1 ASR Filetrans",
    description: "文件级异步转写，返回句级与词级时间戳。",
    tags: ["ASR", "时间戳", "异步"],
    free: true,
    recommendedFor: ["asr.online"],
  },
  {
    id: "qwen3.7-text-embedding-flash",
    provider: "dashscope",
    kind: "embedding",
    label: "Qwen3.7 Text Embedding Flash",
    description: "512 维轻量向量，检索默认档。",
    tags: ["向量", "轻量"],
    free: true,
    recommendedFor: ["embedding"],
  },
  {
    id: "qwen3.7-text-embedding",
    provider: "dashscope",
    kind: "embedding",
    label: "Qwen3.7 Text Embedding",
    description: "1024 维高精度向量，用于精度优先场景。",
    tags: ["向量", "高精度"],
    free: true,
  },
]

export const OPENROUTER_CATALOG: ModelCatalogEntry[] = [
  {
    id: "nvidia/llama-nemotron-rerank-vl-1b-v2:free",
    provider: "openrouter",
    kind: "rerank",
    label: "Nemotron Rerank VL 1B v2",
    description: "免费交叉编码器重排序，支持文图混合文档。",
    tags: ["重排", "免费"],
    free: true,
    recommendedFor: ["rerank"],
  },
]

export const LOCAL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "faster-whisper",
    provider: "local",
    kind: "asr",
    label: "Faster Whisper",
    description: "本地 CTranslate2 推理，离线兜底转写。",
    tags: ["本地", "离线"],
    free: true,
    recommendedFor: ["asr.local"],
  },
]

export const MODEL_CATALOG: ModelCatalogEntry[] = [...DASHSCOPE_CATALOG, ...OPENROUTER_CATALOG, ...LOCAL_CATALOG]

export const MODEL_ROLES: Array<{ role: ModelRole; label: string; purpose: string; kind: "chat" | "vision" | "asr" | "embedding" | "rerank" | "translation" }> = [
  { role: "llm.fast", label: "快速模型", purpose: "语义分段、上下文前缀、查询改写等高频小任务", kind: "chat" },
  { role: "llm.balanced", label: "均衡模型", purpose: "章节切分、思维导图、知识抽取", kind: "chat" },
  { role: "llm.reasoning", label: "推理模型", purpose: "深度预设下的复杂归纳与追问", kind: "chat" },
  { role: "llm.quality", label: "高质量模型", purpose: "全局归并、最终报告润色", kind: "chat" },
  { role: "llm.bulk", label: "长文模型", purpose: "超长上下文批量归并", kind: "chat" },
  { role: "llm.fallback", label: "兜底模型", purpose: "任一在线角色失败时接管", kind: "chat" },
  { role: "vision.primary", label: "视觉模型", purpose: "关键帧图注与屏上文字提取", kind: "vision" },
  { role: "asr.online", label: "在线转写", purpose: "文件级异步语音转写", kind: "asr" },
  { role: "asr.local", label: "本地转写", purpose: "离线兜底转写", kind: "asr" },
  { role: "embedding", label: "向量模型", purpose: "检索切块向量化", kind: "embedding" },
  { role: "rerank", label: "重排模型", purpose: "混合召回结果重排序", kind: "rerank" },
  { role: "translate", label: "翻译模型", purpose: "字幕与段落批量翻译", kind: "translation" },
]

export const DEFAULT_ROUTES: ModelRoute[] = [
  { role: "llm.fast", provider: "dashscope", model: "qwen3.8-flash", label: "快速模型", allowFallback: true, temperature: 0.2, maxTokens: 6000 },
  { role: "llm.balanced", provider: "dashscope", model: "qwen3.8-27b", label: "均衡模型", allowFallback: true, temperature: 0.3, maxTokens: 12000 },
  { role: "llm.reasoning", provider: "dashscope", model: "deepseek-v4-pro-0813", label: "推理模型", allowFallback: true, temperature: 0.4, maxTokens: 24000 },
  { role: "llm.quality", provider: "dashscope", model: "qwen3.8-max-0902", label: "高质量模型", allowFallback: true, temperature: 0.35, maxTokens: 16000 },
  { role: "llm.bulk", provider: "dashscope", model: "qwen3.8-2.4t-a95b", label: "长文模型", allowFallback: true, temperature: 0.3, maxTokens: 16000 },
  { role: "llm.fallback", provider: "dashscope", model: "deepseek-v4-flash-0731", label: "兜底模型", allowFallback: false, temperature: 0.2, maxTokens: 16000 },
  { role: "vision.primary", provider: "dashscope", model: "qwen3.8-omni-flash", label: "视觉模型", allowFallback: true, temperature: 0.2, maxTokens: 2000 },
  { role: "asr.online", provider: "dashscope", model: "qwen-audio-3.1-asr-flash-filetrans", label: "在线转写", allowFallback: false },
  { role: "asr.local", provider: "local", model: "faster-whisper", label: "本地转写", allowFallback: false },
  { role: "embedding", provider: "dashscope", model: "qwen3.7-text-embedding-flash", label: "向量模型", allowFallback: false },
  { role: "rerank", provider: "openrouter", model: "nvidia/llama-nemotron-rerank-vl-1b-v2:free", label: "重排模型", allowFallback: false },
  { role: "translate", provider: "dashscope", model: "qwen-mt-uni", label: "翻译模型", allowFallback: false },
]

/** 内置提供方。id 与协议固定，Base URL 与密钥仍可由用户修改。 */
export interface BuiltinProviderSpec {
  baseUrl: string
  enabled: boolean
  envVar: string
  id: string
  label: string
  note: string
  protocol: ProviderProtocol
}

export const BUILTIN_PROVIDERS: BuiltinProviderSpec[] = [
  {
    id: "dashscope",
    label: "阿里云百炼",
    protocol: "dashscope",
    baseUrl: "https://dashscope.aliyuncs.com",
    envVar: "DASHSCOPE_API_KEY",
    enabled: true,
    note: "提供对话、多模态、文件级转写、向量与翻译能力。",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    enabled: true,
    note: "对话与重排；重排走原生 /rerank 端点。",
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    enabled: false,
    note: "任意 OpenAI 兼容端点，例如 vLLM、Ollama、LM Studio 或公司内网网关。",
  },
  {
    id: "local",
    label: "本地运行时（faster-whisper）",
    protocol: "local",
    baseUrl: "",
    envVar: "",
    enabled: true,
    note: "使用本机 Python 与 CTranslate2 模型目录推理，不消耗在线额度。",
  },
]

/** 协议能力表：界面据此禁用不受支持的能力类型，接口据此拒绝无效登记。 */
export const PROTOCOL_INFO: ProviderProtocolInfo[] = [
  {
    protocol: "openai",
    label: "OpenAI 兼容",
    kinds: ["chat", "vision", "embedding", "rerank", "asr", "translation"],
    streaming: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    note: "覆盖 OpenAI、DeepSeek、智谱、Groq、SiliconFlow 以及 vLLM、Ollama、LM Studio 等自建端点。",
  },
  {
    protocol: "anthropic",
    label: "Anthropic Messages",
    kinds: ["chat", "vision", "translation"],
    streaming: true,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    note: "Claude 系列；不提供向量化、重排与语音转写。",
  },
  {
    protocol: "gemini",
    label: "Google Gemini",
    kinds: ["chat", "vision", "embedding", "translation"],
    streaming: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    note: "Gemini 对话、多模态与向量化；不提供重排与语音转写。",
  },
  {
    protocol: "dashscope",
    label: "DashScope 原生",
    kinds: ["chat", "vision", "embedding", "asr", "translation"],
    streaming: true,
    defaultBaseUrl: "https://dashscope.aliyuncs.com",
    note: "对话走兼容模式，文件级转写与批量翻译走原生端点。",
  },
  {
    protocol: "openrouter",
    label: "OpenRouter",
    kinds: ["chat", "vision", "embedding", "rerank", "translation"],
    streaming: true,
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    note: "对话走 OpenAI 兼容端点，重排走原生 /rerank 端点。",
  },
  {
    protocol: "local",
    label: "本地运行时",
    kinds: ["asr"],
    streaming: false,
    defaultBaseUrl: "",
    note: "本机 faster-whisper worker，只提供离线转写。",
  },
]

export function protocolInfo(protocol: ProviderProtocol): ProviderProtocolInfo | undefined {
  return PROTOCOL_INFO.find((item) => item.protocol === protocol)
}

/** 把用户登记的模型转成目录条目，与内置模型共用一套下游逻辑。 */
export function customModelsToCatalog(
  provider: Pick<ProviderConfig, "id" | "models">,
): ModelCatalogEntry[] {
  return provider.models.map((model) => ({
    id: model.id,
    provider: provider.id,
    kind: model.kind,
    label: model.label,
    description: model.description || "用户登记的模型。",
    tags: model.tags ?? [],
    contextWindow: model.contextWindow,
    dimensions: model.dimensions,
    custom: true,
  }))
}

export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  "qwen3.7-text-embedding-flash": 512,
  "qwen3.7-text-embedding": 1024,
}
