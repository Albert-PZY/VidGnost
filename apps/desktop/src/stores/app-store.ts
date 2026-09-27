import { create } from 'zustand'

import type {
  AppSettings,
  AskAnswer,
  Citation,
  KnowledgeGraphDoc,
  MindMapDoc,
  ModelCatalogEntry,
  ModelKind,
  ModelRole,
  ModelRoute,
  OutlineDoc,
  ParagraphDoc,
  ProviderConfig,
  ProviderCreateRequest,
  ProviderModelUpsertRequest,
  ProviderPatchRequest,
  ProviderProtocolInfo,
  SummaryDoc,
  TaskEvent,
  TaskRecord,
  TaskSummary,
  TranscriptDoc,
} from '@vidgnost/contracts'

import { api, askQuestion, subscribeLibraryEvents, subscribeTaskEvents } from '@/lib/api'

export type Workspace = 'library' | 'studio' | 'providers' | 'settings'

export interface LogLine {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface StudioArtifacts {
  transcript: TranscriptDoc | null
  paragraphs: ParagraphDoc | null
  outline: OutlineDoc | null
  summary: SummaryDoc | null
  mindmap: MindMapDoc | null
  knowledge: KnowledgeGraphDoc | null
  frames: { frames: Array<{ id: string; time: number; caption?: string; onScreenText?: string; slideLike?: boolean }> } | null
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  streaming?: boolean
}

interface AppState {
  /* ------------------------------------------------------------- 导航 */
  workspace: Workspace
  setWorkspace: (workspace: Workspace) => void

  /* ------------------------------------------------------------- 资产库 */
  library: TaskSummary[]
  libraryLoading: boolean
  libraryQuery: string
  setLibraryQuery: (query: string) => void
  refreshLibrary: () => Promise<void>

  /* ------------------------------------------------------------- 任务 */
  task: TaskRecord | null
  taskLoading: boolean
  logs: LogLine[]
  artifacts: StudioArtifacts
  activeArtifact: string | null
  openTask: (taskId: string) => Promise<void>
  closeTask: () => void
  reloadTask: () => Promise<void>
  setActiveArtifact: (key: string) => void
  createTask: (input: { source: string; title?: string; options?: Record<string, unknown> }) => Promise<string>
  cancelTask: () => Promise<void>
  rerunTask: () => Promise<void>
  deleteTask: (taskId: string) => Promise<void>

  /* ----------------------------------------------------------- Copilot */
  turns: ChatTurn[]
  asking: boolean
  askTrace: AskAnswer['trace'] | null
  ask: (question: string) => Promise<void>
  resetConversation: () => void

  /* -------------------------------------------------------------- 配置 */
  settings: AppSettings | null
  routes: ModelRoute[]
  providers: ProviderConfig[]
  models: ModelCatalogEntry[]
  /** 协议能力表，界面据此决定某个类别下可以接入哪些协议。 */
  protocols: ProviderProtocolInfo[]
  roleMeta: Array<{ role: ModelRole; label: string; purpose: string; kind: ModelKind }>
  configLoading: boolean
  loadConfig: () => Promise<void>
  saveSettings: (patch: unknown) => Promise<void>
  saveRoutes: (routes: ModelRoute[]) => Promise<void>
  saveProvider: (patch: ProviderPatchRequest) => Promise<void>
  addProvider: (input: ProviderCreateRequest) => Promise<void>
  removeProvider: (providerId: string) => Promise<void>
  saveProviderModel: (providerId: string, modelId: string, input: ProviderModelUpsertRequest) => Promise<void>
  removeProviderModel: (providerId: string, modelId: string) => Promise<void>
}

let taskUnsubscribe: (() => void) | null = null

export const useAppStore = create<AppState>((set, get) => ({
  workspace: 'library',
  setWorkspace: (workspace) => set({ workspace }),

  library: [],
  libraryLoading: false,
  libraryQuery: '',
  setLibraryQuery: (libraryQuery) => {
    set({ libraryQuery })
    void get().refreshLibrary()
  },
  refreshLibrary: async () => {
    set({ libraryLoading: true })
    try {
      const result = await api.listTasks({ query: get().libraryQuery || undefined, limit: 200 })
      set({ library: result.tasks, libraryLoading: false })
    } catch {
      set({ libraryLoading: false })
    }
  },

  task: null,
  taskLoading: false,
  logs: [],
  artifacts: {
    transcript: null,
    paragraphs: null,
    outline: null,
    summary: null,
    mindmap: null,
    knowledge: null,
    frames: null,
  },
  activeArtifact: 'notes',

  openTask: async (taskId) => {
    taskUnsubscribe?.()
    set({
      workspace: 'studio',
      taskLoading: true,
      logs: [],
      turns: [],
      askTrace: null,
      activeArtifact: 'notes',
      artifacts: {
        transcript: null,
        paragraphs: null,
        outline: null,
        summary: null,
        mindmap: null,
        knowledge: null,
        frames: null,
      },
    })

    const { task } = await api.getTask(taskId)
    set({ task, taskLoading: false })
    await loadArtifacts(taskId, set)

    taskUnsubscribe = subscribeTaskEvents(taskId, {
      onEvent: (event) => applyEvent(event, set, get),
    })
  },

  closeTask: () => {
    taskUnsubscribe?.()
    taskUnsubscribe = null
    set({ task: null, logs: [], turns: [], askTrace: null })
  },

  reloadTask: async () => {
    const taskId = get().task?.id
    if (!taskId) return
    const { task } = await api.getTask(taskId)
    set({ task })
    await loadArtifacts(taskId, set)
  },

  setActiveArtifact: (activeArtifact) => set({ activeArtifact }),

  createTask: async (input) => {
    const { task } = await api.createTask(input as never)
    await get().refreshLibrary()
    await get().openTask(task.id)
    return task.id
  },

  cancelTask: async () => {
    const taskId = get().task?.id
    if (!taskId) return
    const { task } = await api.cancelTask(taskId)
    set({ task })
  },

  rerunTask: async () => {
    const taskId = get().task?.id
    if (!taskId) return
    const { task } = await api.rerunTask(taskId)
    set({ task, logs: [] })
  },

  deleteTask: async (taskId) => {
    await api.deleteTask(taskId)
    if (get().task?.id === taskId) {
      get().closeTask()
    }
    await get().refreshLibrary()
  },

  turns: [],
  asking: false,
  askTrace: null,
  ask: async (question) => {
    const taskId = get().task?.id
    if (!taskId || get().asking) return

    const history = get().turns.map((turn) => ({ role: turn.role, content: turn.content }))
    const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: 'user', content: question }
    const assistantId = `a-${Date.now()}`
    set((state) => ({
      asking: true,
      turns: [...state.turns, userTurn, { id: assistantId, role: 'assistant', content: '', streaming: true }],
    }))

    const patchAssistant = (patch: Partial<ChatTurn>) => {
      set((state) => ({
        turns: state.turns.map((turn) => (turn.id === assistantId ? { ...turn, ...patch } : turn)),
      }))
    }

    try {
      await askQuestion(
        taskId,
        { question, history: history.slice(-6) },
        {
          onDelta: (text) => {
            set((state) => ({
              turns: state.turns.map((turn) =>
                turn.id === assistantId ? { ...turn, content: turn.content + text } : turn,
              ),
            }))
          },
          onEvent: (event) => {
            if (event.type === 'trace') {
              set({ askTrace: event.trace })
            }
            if (event.type === 'answer') {
              patchAssistant({
                content: event.answer.answer,
                citations: event.answer.citations,
                streaming: false,
              })
              set({ askTrace: event.answer.trace })
            }
            if (event.type === 'error') {
              patchAssistant({ content: event.message, streaming: false })
            }
          },
        },
      )
    } catch (error) {
      patchAssistant({
        content: error instanceof Error ? error.message : String(error),
        streaming: false,
      })
    } finally {
      set({ asking: false })
      patchAssistant({ streaming: false })
    }
  },

  resetConversation: () => set({ turns: [], askTrace: null }),

  settings: null,
  routes: [],
  providers: [],
  models: [],
  protocols: [],
  roleMeta: [],
  configLoading: false,
  loadConfig: async () => {
    set({ configLoading: true })
    try {
      const [config, catalog] = await Promise.all([api.config(), api.catalog()])
      set({
        settings: config.settings,
        routes: config.routes,
        providers: config.providers,
        models: catalog.models,
        protocols: catalog.protocols,
        roleMeta: catalog.roles,
        configLoading: false,
      })
    } catch {
      set({ configLoading: false })
    }
  },
  saveSettings: async (patch) => {
    const result = await api.patchSettings(patch)
    set({ settings: result.settings, routes: result.routes })
  },
  saveRoutes: async (routes) => {
    const result = await api.putRoutes(routes)
    set({ routes: result.routes })
  },
  saveProvider: async (patch) => {
    const result = await api.patchProvider(patch)
    set({ providers: result.providers })
    await syncCatalogue(set)
  },
  addProvider: async (input) => {
    const result = await api.createProvider(input)
    set({ providers: result.providers })
    await syncCatalogue(set)
  },
  removeProvider: async (providerId) => {
    const result = await api.deleteProvider(providerId)
    set({ providers: result.providers })
    await syncCatalogue(set)
  },
  saveProviderModel: async (providerId, modelId, input) => {
    const result = await api.putProviderModel(providerId, modelId, input)
    set({ providers: result.providers })
    await syncCatalogue(set)
  },
  removeProviderModel: async (providerId, modelId) => {
    const result = await api.deleteProviderModel(providerId, modelId)
    set({ providers: result.providers })
    await syncCatalogue(set)
  },
}))

/** 渠道或模型改动后目录会变：自定义模型属于目录的一部分，必须一起刷新。 */
async function syncCatalogue(set: (partial: Partial<AppState>) => void): Promise<void> {
  const catalog = await api.catalog()
  set({ models: catalog.models, protocols: catalog.protocols, roleMeta: catalog.roles })
}

function applyEvent(
  event: TaskEvent,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
): void {
  switch (event.type) {
    case 'snapshot':
      set({ task: event.task })
      return
    case 'stage':
      set((state) =>
        state.task
          ? {
              task: {
                ...state.task,
                stages: state.task.stages.map((stage) => (stage.id === event.stage.id ? event.stage : stage)),
                readiness: event.readiness,
              },
            }
          : {},
      )
      return
    case 'status':
      set((state) => (state.task ? { task: { ...state.task, status: event.status, error: event.error } } : {}))
      return
    case 'log':
      set((state) => ({
        logs: [...state.logs.slice(-260), { at: event.at, level: event.level, message: event.message }],
      }))
      return
    case 'artifact':
      void loadArtifacts(event.taskId, set)
      return
    case 'done':
      set({ task: event.task })
      void loadArtifacts(event.taskId, set)
      void get().refreshLibrary()
      return
    default:
      return
  }
}

async function loadArtifacts(
  taskId: string,
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
): Promise<void> {
  const keys = ['transcript', 'paragraphs', 'outline', 'summary', 'mindmap', 'knowledge', 'frames'] as const
  const results = await Promise.all(
    keys.map(async (key) => {
      try {
        const payload = await api.getArtifact(taskId, key)
        return [key, payload.json] as const
      } catch {
        return [key, null] as const
      }
    }),
  )

  const patch: Partial<StudioArtifacts> = {}
  for (const [key, value] of results) {
    ;(patch as Record<string, unknown>)[key] = value
  }
  set((state) => ({ artifacts: { ...state.artifacts, ...patch } }))
}

/* 资产库全局订阅：任意任务状态变化都触发列表刷新（节流 1.5s）。 */
let libraryTimer: ReturnType<typeof setTimeout> | null = null
subscribeLibraryEvents({
  onEvent: () => {
    if (libraryTimer) {
      return
    }
    libraryTimer = setTimeout(() => {
      libraryTimer = null
      void useAppStore.getState().refreshLibrary()
    }, 1500)
  },
})
