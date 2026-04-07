import type {
  LLMConfig,
  PromptTemplateBundle,
  PromptTemplateChannel,
  SelfCheckReport,
  TaskDetail,
  TaskSummaryItem,
  WhisperConfig,
} from '../types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL?.trim() || 'http://localhost:8000/api').replace(
  /\/+$/,
  '',
)
export type BundleArchiveFormat = 'zip' | 'tar'

interface TaskCreateResponse {
  task_id: string
  status: string
}

interface TaskListResponse {
  items: TaskSummaryItem[]
  total: number
}

interface SelfCheckStartResponse {
  session_id: string
  status: string
}

interface ApiErrorPayload {
  code?: string
  message?: string
  detail?: unknown
}

export class ApiError extends Error {
  status: number
  code: string
  detail: unknown
  path: string
  method: string

  constructor(input: {
    status: number
    code: string
    message: string
    detail?: unknown
    path: string
    method: string
  }) {
    super(input.message)
    this.name = 'ApiError'
    this.status = input.status
    this.code = input.code
    this.detail = input.detail ?? null
    this.path = input.path
    this.method = input.method
  }
}

function toApiErrorPayload(data: unknown): ApiErrorPayload | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const maybePayload = data as Record<string, unknown>
  return {
    code: typeof maybePayload.code === 'string' ? maybePayload.code : undefined,
    message: typeof maybePayload.message === 'string' ? maybePayload.message : undefined,
    detail: maybePayload.detail,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'
  const url = `${API_BASE}${path}`
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Network request failed',
      detail: null,
      path,
      method,
    })
  }

  const rawBody = await response.text()
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const isJson = contentType.includes('application/json')
  let parsedBody: unknown = null
  if (rawBody.trim()) {
    if (isJson) {
      try {
        parsedBody = JSON.parse(rawBody)
      } catch {
        parsedBody = rawBody
      }
    } else {
      parsedBody = rawBody
    }
  }

  if (!response.ok) {
    const payload = toApiErrorPayload(parsedBody)
    const message =
      payload?.message ||
      (typeof parsedBody === 'string' ? parsedBody : null) ||
      `Request failed: ${response.status}`
    throw new ApiError({
      status: response.status,
      code: payload?.code || `HTTP_${response.status}`,
      message,
      detail: payload?.detail ?? null,
      path,
      method,
    })
  }

  if (response.status === 204 || !rawBody.trim()) {
    return undefined as T
  }

  if (isJson && parsedBody !== null) {
    return parsedBody as T
  }
  return rawBody as T
}

export async function createTaskByUrl(input: {
  url: string
  model_size: 'small'
  language: string
}): Promise<TaskCreateResponse> {
  return request<TaskCreateResponse>('/tasks/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function createTaskByPath(input: {
  local_path: string
  model_size: 'small'
  language: string
}): Promise<TaskCreateResponse> {
  return request<TaskCreateResponse>('/tasks/path', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function createTaskByFile(input: {
  file: File
  model_size: 'small'
  language: string
}): Promise<TaskCreateResponse> {
  const form = new FormData()
  form.append('file', input.file)
  form.append('model_size', input.model_size)
  form.append('language', input.language)
  return request<TaskCreateResponse>('/tasks/upload', {
    method: 'POST',
    body: form,
  })
}

export async function getTask(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>(`/tasks/${taskId}`)
}

export async function listTasks(search = ''): Promise<TaskSummaryItem[]> {
  const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''
  const payload = await request<TaskListResponse>(`/tasks${query}`)
  return payload.items
}

export async function updateTaskTitle(taskId: string, title: string): Promise<TaskSummaryItem> {
  return request<TaskSummaryItem>(`/tasks/${taskId}/title`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
}

export async function updateTaskArtifacts(
  taskId: string,
  input: {
    summary_markdown?: string
    notes_markdown?: string
    mindmap_markdown?: string
  },
): Promise<TaskDetail> {
  return request<TaskDetail>(`/tasks/${taskId}/artifacts`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function getTaskArtifactContent(taskId: string, path: string): Promise<string> {
  return request<string>(`/tasks/${taskId}/artifacts/content?path=${encodeURIComponent(path)}`)
}

export async function deleteTask(taskId: string): Promise<void> {
  await request<void>(`/tasks/${taskId}`, {
    method: 'DELETE',
  })
}

export async function cancelTask(taskId: string): Promise<void> {
  await request<TaskCreateResponse>(`/tasks/${taskId}/cancel`, {
    method: 'POST',
  })
}

export async function rerunTaskStageD(taskId: string): Promise<void> {
  await request<TaskCreateResponse>(`/tasks/${taskId}/rerun-stage-d`, {
    method: 'POST',
  })
}

export function exportTaskBundleUrl(taskId: string, archive: BundleArchiveFormat): string {
  return `${API_BASE}/tasks/${taskId}/export/bundle?archive=${archive}`
}

export function taskEventsUrl(taskId: string): string {
  return `${API_BASE}/tasks/${taskId}/events`
}

export async function getLLMConfig(): Promise<LLMConfig> {
  return request<LLMConfig>('/config/llm')
}

export async function updateLLMConfig(input: LLMConfig): Promise<LLMConfig> {
  return request<LLMConfig>('/config/llm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function getPromptTemplates(): Promise<PromptTemplateBundle> {
  return request<PromptTemplateBundle>('/config/prompts')
}

export async function updatePromptTemplateSelection(input: {
  selected_summary_template_id: string
  selected_notes_template_id: string
  selected_mindmap_template_id: string
}): Promise<PromptTemplateBundle> {
  return request<PromptTemplateBundle>('/config/prompts/selection', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function createPromptTemplate(input: {
  channel: PromptTemplateChannel
  name: string
  content: string
}): Promise<PromptTemplateBundle> {
  return request<PromptTemplateBundle>('/config/prompts/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updatePromptTemplate(input: {
  template_id: string
  name: string
  content: string
}): Promise<PromptTemplateBundle> {
  return request<PromptTemplateBundle>(
    `/config/prompts/templates/${encodeURIComponent(input.template_id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name,
        content: input.content,
      }),
    },
  )
}

export async function deletePromptTemplate(templateId: string): Promise<PromptTemplateBundle> {
  return request<PromptTemplateBundle>(
    `/config/prompts/templates/${encodeURIComponent(templateId)}`,
    {
      method: 'DELETE',
    },
  )
}

export async function getWhisperConfig(): Promise<WhisperConfig> {
  return request<WhisperConfig>('/config/whisper')
}

export async function updateWhisperConfig(input: WhisperConfig): Promise<WhisperConfig> {
  return request<WhisperConfig>('/config/whisper', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function startSelfCheck(): Promise<SelfCheckStartResponse> {
  return request<SelfCheckStartResponse>('/self-check/start', {
    method: 'POST',
  })
}

export async function startSelfCheckAutoFix(sessionId: string): Promise<SelfCheckStartResponse> {
  return request<SelfCheckStartResponse>(`/self-check/${sessionId}/auto-fix`, {
    method: 'POST',
  })
}

export async function getSelfCheckReport(sessionId: string): Promise<SelfCheckReport> {
  return request<SelfCheckReport>(`/self-check/${sessionId}/report`)
}

export function selfCheckEventsUrl(sessionId: string): string {
  return `${API_BASE}/self-check/${sessionId}/events`
}
