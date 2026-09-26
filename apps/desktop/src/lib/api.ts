import type {
  AppSettings,
  ArtifactPayload,
  AskStreamEvent,
  CreateTaskRequest,
  ModelCatalogEntry,
  ModelRole,
  ModelRoute,
  ProviderConfig,
  RuntimeHealth,
  TaskEvent,
  TaskListResponse,
  TaskRecord,
} from '@vidgnost/contracts'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') || 'http://127.0.0.1:8666/api'

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly hint?: string

  constructor(input: { message: string; code: string; status: number; hint?: string }) {
    super(input.message)
    this.name = 'ApiError'
    this.code = input.code
    this.status = input.status
    this.hint = input.hint
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })

  if (response.status === 204) {
    return undefined as T
  }

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : {}

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; hint?: string } }).error
    throw new ApiError({
      status: response.status,
      code: error?.code || `HTTP_${response.status}`,
      message: error?.message || `请求失败：HTTP ${response.status}`,
      hint: error?.hint,
    })
  }

  return payload as T
}

export const api = {
  base: API_BASE,

  health: () => request<{ ok: boolean; version: string; storageDir: string }>('/health'),
  runtimeHealth: () => request<RuntimeHealth>('/health/runtime'),
  toolchainHealth: () => request<{ checkedAt: string; checks: Array<{ name: string; ok: boolean; detail: string; latencyMs: number }> }>('/health/toolchain'),

  listTasks: (query?: { limit?: number; query?: string; status?: string }) => {
    const params = new URLSearchParams()
    if (query?.limit) params.set('limit', String(query.limit))
    if (query?.query) params.set('query', query.query)
    if (query?.status) params.set('status', query.status)
    const suffix = params.toString()
    return request<TaskListResponse>(`/tasks${suffix ? `?${suffix}` : ''}`)
  },
  createTask: (body: CreateTaskRequest) =>
    request<{ task: TaskRecord }>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  getTask: (taskId: string) => request<{ task: TaskRecord }>(`/tasks/${taskId}`),
  cancelTask: (taskId: string) => request<{ task: TaskRecord }>(`/tasks/${taskId}/cancel`, { method: 'POST' }),
  rerunTask: (taskId: string, stages?: string[]) =>
    request<{ task: TaskRecord }>(`/tasks/${taskId}/rerun`, { method: 'POST', body: JSON.stringify({ stages }) }),
  deleteTask: (taskId: string) => request<void>(`/tasks/${taskId}`, { method: 'DELETE' }),
  getArtifact: (taskId: string, key: string) => request<ArtifactPayload>(`/tasks/${taskId}/artifacts/${key}`),

  config: () =>
    request<{
      settings: AppSettings
      routes: ModelRoute[]
      providers: ProviderConfig[]
    }>('/config'),
  catalog: () =>
    request<{
      models: ModelCatalogEntry[]
      roles: Array<{ role: ModelRole; label: string; purpose: string; kind: string }>
      providerLabels: Record<string, string>
    }>('/config/catalog'),
  patchSettings: (body: unknown) =>
    request<{ settings: AppSettings; routes: ModelRoute[] }>('/config/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  patchProvider: (body: unknown) =>
    request<{ providers: ProviderConfig[] }>('/config/providers', { method: 'PATCH', body: JSON.stringify(body) }),
  putRoutes: (routes: ModelRoute[]) =>
    request<{ routes: ModelRoute[] }>('/config/routes', { method: 'PUT', body: JSON.stringify({ routes }) }),
  runHealth: () => request<RuntimeHealth>('/config/health', { method: 'POST' }),

  mediaUrl: (taskId: string) => `${API_BASE}/tasks/${taskId}/media`,
  frameUrl: (taskId: string, frameId: string) => `${API_BASE}/tasks/${taskId}/frames/${frameId}`,
  exportUrl: (taskId: string, format: string) => `${API_BASE}/tasks/${taskId}/export?format=${format}`,
}

/**
 * 订阅任务事件流。返回取消订阅函数。
 * 浏览器 EventSource 无法携带自定义头，因此直接在 URL 上使用 GET。
 */
export function subscribeTaskEvents(
  taskId: string,
  handlers: { onEvent: (event: TaskEvent) => void; onError?: (error: Event) => void },
): () => void {
  const source = new EventSource(`${API_BASE}/tasks/${taskId}/stream`)
  const types: TaskEvent['type'][] = ['snapshot', 'stage', 'log', 'artifact', 'status', 'done']
  for (const type of types) {
    source.addEventListener(type, (raw) => {
      try {
        handlers.onEvent(JSON.parse((raw as MessageEvent).data) as TaskEvent)
      } catch {
        // 忽略无法解析的事件
      }
    })
  }
  source.onerror = (error) => handlers.onError?.(error)
  return () => source.close()
}

export function subscribeLibraryEvents(handlers: { onEvent: (event: TaskEvent) => void }): () => void {
  const source = new EventSource(`${API_BASE}/stream`)
  for (const type of ['status', 'done'] as const) {
    source.addEventListener(type, (raw) => {
      try {
        handlers.onEvent(JSON.parse((raw as MessageEvent).data) as TaskEvent)
      } catch {
        // 忽略
      }
    })
  }
  return () => source.close()
}

/** 提问：服务端流式返回 trace / delta / answer。 */
export async function askQuestion(
  taskId: string,
  body: { question: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; topK?: number },
  handlers: {
    onDelta: (text: string) => void
    onEvent: (event: AskStreamEvent) => void
    signal?: AbortSignal
  },
): Promise<void> {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    let message = `提问失败：HTTP ${response.status}`
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } }
      message = parsed.error?.message || message
    } catch {
      // 保留默认信息
    }
    throw new ApiError({ message, code: `HTTP_${response.status}`, status: response.status })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() || ''
    for (const block of blocks) {
      const lines = block.split('\n')
      const eventLine = lines.find((line) => line.startsWith('event:'))
      const dataLine = lines.find((line) => line.startsWith('data:'))
      if (!eventLine || !dataLine) continue
      const type = eventLine.slice(6).trim()
      if (type === 'close') continue
      try {
        const parsed = JSON.parse(dataLine.slice(5).trim()) as AskStreamEvent
        if (parsed.type === 'delta') {
          handlers.onDelta(parsed.text)
        } else {
          handlers.onEvent(parsed)
        }
      } catch {
        // 忽略无法解析的分片
      }
    }
  }
}
