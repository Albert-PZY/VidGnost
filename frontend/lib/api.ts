import type {
  ApiErrorPayload,
  LLMConfigResponse,
  ModelListResponse,
  PromptTemplateBundleResponse,
  RuntimeMetricsResponse,
  SelfCheckReportResponse,
  SelfCheckStartResponse,
  SelfCheckStreamEvent,
  TaskBatchCreateResponse,
  TaskDetailResponse,
  TaskListResponse,
  TaskRecentResponse,
  TaskStatsResponse,
  TaskStreamEvent,
  UISettingsResponse,
  VqaChatResponse,
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

export async function listTasks(params: {
  q?: string
  workflow?: WorkflowType | "all"
  sort_by?: "date" | "name" | "size"
  limit?: number
  offset?: number
} = {}): Promise<TaskListResponse> {
  return apiFetch<TaskListResponse>("/tasks", {
    method: "GET",
    headers: undefined,
  })
}

export async function listTasksWithQuery(params: {
  q?: string
  workflow?: WorkflowType | "all"
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

export function chatWithTask(payload: {
  task_id: string
  question: string
  top_k?: number
}): Promise<VqaChatResponse> {
  return apiFetch<VqaChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({
      task_id: payload.task_id,
      question: payload.question,
      top_k: payload.top_k ?? 5,
      stream: false,
    }),
  })
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
