import type {
  ApiErrorPayload,
  HealthResponse,
  LLMConfigResponse,
  ModelListResponse,
  PromptTemplateBundleResponse,
  RuntimePathsResponse,
  RuntimeMetricsResponse,
  SelfCheckReportResponse,
  SelfCheckStartResponse,
  SelfCheckStreamEvent,
  TaskBatchCreateResponse,
  TaskCreateResponse,
  TaskSourceCreatePayload,
  TaskDetailResponse,
  TaskListResponse,
  TaskRecentResponse,
  TaskStatsResponse,
  TaskStreamEvent,
  UISettingsResponse,
  VqaChatStreamEvent,
  VqaTraceResponse,
  WhisperConfigResponse,
  WorkflowType,
} from "@/lib/types"

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000/api"

export class ApiError extends Error {
  status: number
  code: string
  hint: string
  retryable: boolean
  detail: unknown

  constructor(status: number, payload: Partial<ApiErrorPayload> & { message?: string }) {
    super(payload.message || "Request failed")
    this.name = "ApiError"
    this.status = status
    this.code = payload.code || "REQUEST_FAILED"
    this.hint = payload.hint || ""
    this.retryable = Boolean(payload.retryable)
    this.detail = payload.detail
  }
}

function getApiBaseUrl(): string {
  const envValue = import.meta.env.VITE_API_BASE_URL
  return (envValue || DEFAULT_API_BASE_URL).replace(/\/+$/, "")
}

export function buildApiUrl(
  path: string,
  searchParams?: Record<string, string | number | boolean | null | undefined>,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  const url = new URL(`${getApiBaseUrl()}${normalizedPath}`)

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return
      }
      url.searchParams.set(key, String(value))
    })
  }

  return url.toString()
}

export function buildTaskArtifactFileUrl(taskId: string, relativePath: string): string {
  return buildApiUrl(`/tasks/${taskId}/artifacts/file`, { path: relativePath })
}

async function readErrorPayload(response: Response): Promise<Partial<ApiErrorPayload>> {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    try {
      return (await response.json()) as Partial<ApiErrorPayload>
    } catch {
      return { message: response.statusText }
    }
  }

  try {
    const text = await response.text()
    return { message: text || response.statusText }
  } catch {
    return { message: response.statusText }
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
  })

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorPayload(response))
  }

  return readJson<T>(response)
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health", { method: "GET" })
}

export function getApiErrorMessage(error: unknown, fallback = "请求失败"): string {
  if (error instanceof ApiError) {
    return error.hint ? `${error.message} ${error.hint}`.trim() : error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

export async function uploadTaskFiles(input: {
  files: File[]
  workflow: WorkflowType
  language?: string
  onProgress?: (progress: number) => void
}): Promise<TaskBatchCreateResponse> {
  const { files, workflow, language = "zh", onProgress } = input

  return new Promise<TaskBatchCreateResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", buildApiUrl("/tasks/upload/batch"))
    xhr.responseType = "text"

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return
      }
      onProgress(Math.round((event.loaded / event.total) * 100))
    }

    xhr.onerror = () => {
      reject(new ApiError(0, { message: "网络错误，无法连接后端服务。" }))
    }

    xhr.onload = () => {
      let payload: unknown = undefined

      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : undefined
      } catch {
        payload = undefined
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as TaskBatchCreateResponse)
        return
      }

      reject(new ApiError(xhr.status, (payload as Partial<ApiErrorPayload>) || { message: xhr.statusText }))
    }

    const formData = new FormData()
    files.forEach((file) => {
      formData.append("files", file)
    })
    formData.append("workflow", workflow)
    formData.append("language", language)
    formData.append("model_size", "small")
    formData.append("strategy", "single_task_per_file")

    xhr.send(formData)
  })
}

export function createTaskFromUrl(payload: TaskSourceCreatePayload & { url: string }): Promise<TaskCreateResponse> {
  return apiFetch<TaskCreateResponse>("/tasks/url", {
    method: "POST",
    body: JSON.stringify({
      url: payload.url,
      workflow: payload.workflow,
      language: payload.language ?? "zh",
      model_size: payload.model_size ?? "small",
    }),
  })
}

export function createTaskFromPath(
  payload: TaskSourceCreatePayload & { local_path: string },
): Promise<TaskCreateResponse> {
  return apiFetch<TaskCreateResponse>("/tasks/path", {
    method: "POST",
    body: JSON.stringify({
      local_path: payload.local_path,
      workflow: payload.workflow,
      language: payload.language ?? "zh",
      model_size: payload.model_size ?? "small",
    }),
  })
}

export function streamTaskEvents(taskId: string, onMessage: (event: TaskStreamEvent) => void): EventSource {
  const source = new EventSource(buildApiUrl(`/tasks/${taskId}/events`))
  source.onmessage = (message) => {
    if (!message.data || message.data === "[DONE]") {
      return
    }
    onMessage(JSON.parse(message.data) as TaskStreamEvent)
  }
  return source
}

export function streamSelfCheckEvents(
  sessionId: string,
  onMessage: (event: SelfCheckStreamEvent) => void,
): EventSource {
  const source = new EventSource(buildApiUrl(`/self-check/${sessionId}/events`))
  source.onmessage = (message) => {
    if (!message.data || message.data === "[DONE]") {
      return
    }
    onMessage(JSON.parse(message.data) as SelfCheckStreamEvent)
  }
  return source
}

export async function listTasksWithQuery(params: {
  q?: string
  workflow?: WorkflowType | "all"
  status?: string
  sort_by?: "date" | "name" | "size"
  limit?: number
  offset?: number
} = {}): Promise<TaskListResponse> {
  const url = buildApiUrl("/tasks", params)
  const response = await fetch(url, { headers: { Accept: "application/json" } })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorPayload(response))
  }
  return readJson<TaskListResponse>(response)
}

export function getTaskStats(): Promise<TaskStatsResponse> {
  return apiFetch<TaskStatsResponse>("/tasks/stats", { method: "GET" })
}

export function getRecentTasks(limit = 3): Promise<TaskRecentResponse> {
  const url = buildApiUrl("/tasks/recent", { limit })
  return fetchJson<TaskRecentResponse>(url)
}

export function getTaskDetail(taskId: string): Promise<TaskDetailResponse> {
  return apiFetch<TaskDetailResponse>(`/tasks/${taskId}`, { method: "GET" })
}

export function cancelTask(taskId: string) {
  return apiFetch(`/tasks/${taskId}/cancel`, { method: "POST", body: JSON.stringify({}) })
}

export function rerunTaskStageD(taskId: string) {
  return apiFetch(`/tasks/${taskId}/rerun-stage-d`, { method: "POST", body: JSON.stringify({}) })
}

export function updateTaskArtifacts(
  taskId: string,
  payload: {
    summary_markdown?: string | null
    notes_markdown?: string | null
    mindmap_markdown?: string | null
  },
): Promise<TaskDetailResponse> {
  return apiFetch<TaskDetailResponse>(`/tasks/${taskId}/artifacts`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export async function deleteTask(taskId: string): Promise<void> {
  await apiFetch<void>(`/tasks/${taskId}`, { method: "DELETE" })
}

export async function openTaskLocation(taskId: string): Promise<{ task_id: string; path: string }> {
  return apiFetch<{ task_id: string; path: string }>(`/tasks/${taskId}/open-location`, { method: "GET" })
}

export async function downloadTaskArtifact(
  taskId: string,
  kind: "transcript" | "notes" | "mindmap" | "srt" | "vtt" | "bundle",
  archive: "zip" | "tar" = "zip",
): Promise<void> {
  const response = await fetch(buildApiUrl(`/tasks/${taskId}/export/${kind}`, { archive }), {
    headers: { Accept: "*/*" },
  })

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorPayload(response))
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  const disposition = response.headers.get("content-disposition") || ""
  const fileNameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/)
  const fileName = decodeURIComponent(fileNameMatch?.[1] || fileNameMatch?.[2] || `${taskId}-${kind}`)

  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function getModels(): Promise<ModelListResponse> {
  return apiFetch<ModelListResponse>("/config/models", { method: "GET" })
}

export function startModelDownload(modelId: string): Promise<ModelListResponse> {
  return apiFetch<ModelListResponse>(`/config/models/${modelId}/download`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function cancelModelDownload(modelId: string): Promise<ModelListResponse> {
  return apiFetch<ModelListResponse>(`/config/models/${modelId}/download`, {
    method: "DELETE",
  })
}

export function reloadModels(modelId?: string): Promise<ModelListResponse> {
  return apiFetch<ModelListResponse>("/config/models/reload", {
    method: "POST",
    body: JSON.stringify({ model_id: modelId || null }),
  })
}

export function updateModel(
  modelId: string,
  payload: {
    path?: string | null
    status?: string | null
    load_profile?: string | null
    quantization?: string | null
    max_batch_size?: number | null
    enabled?: boolean | null
  },
): Promise<ModelListResponse> {
  return apiFetch<ModelListResponse>(`/config/models/${modelId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function getPromptTemplates(): Promise<PromptTemplateBundleResponse> {
  return apiFetch<PromptTemplateBundleResponse>("/config/prompts", { method: "GET" })
}

export function createPromptTemplate(payload: {
  channel: string
  name: string
  content: string
}): Promise<PromptTemplateBundleResponse> {
  return apiFetch<PromptTemplateBundleResponse>("/config/prompts/templates", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function updatePromptTemplate(
  templateId: string,
  payload: { name: string; content: string },
): Promise<PromptTemplateBundleResponse> {
  return apiFetch<PromptTemplateBundleResponse>(`/config/prompts/templates/${templateId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
}

export function deletePromptTemplate(templateId: string): Promise<PromptTemplateBundleResponse> {
  return apiFetch<PromptTemplateBundleResponse>(`/config/prompts/templates/${templateId}`, {
    method: "DELETE",
  })
}

export function updatePromptSelection(payload: {
  correction?: string
  notes?: string
  mindmap?: string
  vqa?: string
}): Promise<PromptTemplateBundleResponse> {
  return apiFetch<PromptTemplateBundleResponse>("/config/prompts/selection", {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export function getUiSettings(): Promise<UISettingsResponse> {
  return apiFetch<UISettingsResponse>("/config/ui", { method: "GET" })
}

export function updateUiSettings(payload: {
  language?: "zh" | "en"
  font_size?: number
  auto_save?: boolean
  theme_hue?: number
  background_image?: string | null
  background_image_opacity?: number
  background_image_blur?: number
  background_image_scale?: number
  background_image_focus_x?: number
  background_image_focus_y?: number
  background_image_fill_mode?: "cover" | "contain" | "repeat" | "center"
}): Promise<UISettingsResponse> {
  return apiFetch<UISettingsResponse>("/config/ui", {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export function getWhisperConfig(): Promise<WhisperConfigResponse> {
  return apiFetch<WhisperConfigResponse>("/config/whisper", { method: "GET" })
}

export function getLLMConfig(): Promise<LLMConfigResponse> {
  return apiFetch<LLMConfigResponse>("/config/llm", { method: "GET" })
}

export function updateLLMConfig(payload: LLMConfigResponse): Promise<LLMConfigResponse> {
  return apiFetch<LLMConfigResponse>("/config/llm", {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export function updateWhisperConfig(
  payload: Omit<WhisperConfigResponse, "warnings" | "rollback_applied">,
): Promise<WhisperConfigResponse> {
  return apiFetch<WhisperConfigResponse>("/config/whisper", {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export function startSelfCheck(): Promise<SelfCheckStartResponse> {
  return apiFetch<SelfCheckStartResponse>("/self-check/start", {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function getSelfCheckReport(sessionId: string): Promise<SelfCheckReportResponse> {
  return apiFetch<SelfCheckReportResponse>(`/self-check/${sessionId}/report`, { method: "GET" })
}

export function autoFixSelfCheck(sessionId: string) {
  return apiFetch(`/self-check/${sessionId}/auto-fix`, {
    method: "POST",
    body: JSON.stringify({}),
  })
}

export function getRuntimeMetrics(): Promise<RuntimeMetricsResponse> {
  return apiFetch<RuntimeMetricsResponse>("/runtime/metrics", { method: "GET" })
}

export function getRuntimePaths(): Promise<RuntimePathsResponse> {
  return apiFetch<RuntimePathsResponse>("/runtime/paths", { method: "GET" })
}

export async function streamChatWithTask(
  payload: {
    task_id: string
    question: string
    top_k?: number
  },
  handlers: {
    onEvent: (event: VqaChatStreamEvent) => void
    signal?: AbortSignal
  },
): Promise<void> {
  const response = await fetch(buildApiUrl("/chat/stream"), {
    method: "POST",
    signal: handlers.signal,
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task_id: payload.task_id,
      question: payload.question,
      top_k: payload.top_k ?? 5,
      stream: true,
    }),
  })

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorPayload(response))
  }

  if (!response.body) {
    throw new Error("后端未返回可读取的流式响应。")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      buffer = drainSseBuffer(buffer, handlers.onEvent)
    }
    buffer += decoder.decode()
    drainSseBuffer(buffer, handlers.onEvent)
  } finally {
    reader.releaseLock()
  }
}

export function getChatTrace(traceId: string): Promise<VqaTraceResponse> {
  return apiFetch<VqaTraceResponse>(`/traces/${traceId}`, { method: "GET" })
}

export async function getTaskArtifactText(
  taskId: string,
  kind: "transcript" | "notes" | "mindmap" | "srt" | "vtt",
): Promise<string> {
  const response = await fetch(buildApiUrl(`/tasks/${taskId}/export/${kind}`), {
    headers: { Accept: "text/plain, text/markdown, text/html" },
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorPayload(response))
  }
  return response.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorPayload(response))
  }

  return readJson<T>(response)
}

function drainSseBuffer(
  buffer: string,
  onEvent: (event: VqaChatStreamEvent) => void,
): string {
  const chunks = buffer.split(/\r?\n\r?\n/)
  const pending = chunks.pop() ?? ""

  for (const chunk of chunks) {
    const payloadLines = chunk
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())

    if (payloadLines.length === 0) {
      continue
    }

    const payload = payloadLines.join("\n")
    if (!payload || payload === "[DONE]") {
      onEvent({ type: "done" })
      continue
    }

    onEvent(JSON.parse(payload) as VqaChatStreamEvent)
  }

  return pending
}
