import { resolveConfig, type AppConfig } from "../core/config.js"
import { AudioService } from "../media/audio-service.js"
import { FrameService } from "../media/frame-service.js"
import { MediaService } from "../media/media-service.js"
import { EnrichService } from "../insight/enrich-service.js"
import { KnowledgeService } from "../insight/knowledge-service.js"
import { MindMapService } from "../insight/mindmap-service.js"
import { OutlineService } from "../insight/outline-service.js"
import { SummaryService } from "../insight/summary-service.js"
import { TranscriptionService } from "../asr/transcription-service.js"
import { ModelGateway } from "../providers/gateway.js"
import { RetrievalIndexService } from "../retrieval/index-service.js"
import { QaService } from "../retrieval/qa-service.js"
import { TaskStore } from "../store/task-store.js"
import { TaskEventBus } from "../pipeline/event-bus.js"
import { TaskManager } from "../pipeline/task-manager.js"
import { TaskRunner } from "../pipeline/task-runner.js"

export interface AppContext {
  audio: AudioService
  bus: TaskEventBus
  config: AppConfig
  enrich: EnrichService
  frames: FrameService
  gateway: ModelGateway
  index: RetrievalIndexService
  knowledge: KnowledgeService
  media: MediaService
  mindmap: MindMapService
  outline: OutlineService
  qa: QaService
  runner: TaskRunner
  store: TaskStore
  summary: SummaryService
  tasks: TaskManager
  transcription: TranscriptionService
}

export function createAppContext(config: AppConfig = resolveConfig()): AppContext {
  const bus = new TaskEventBus()
  const store = new TaskStore(config)

  // 事件总线同时负责把事件落盘，保证刷新页面后仍能回放完整时间线。
  bus.subscribeAll((event) => {
    const taskId = event.type === "snapshot" ? event.task.id : event.type === "done" ? event.task.id : event.taskId
    void store.appendEvent(taskId, event).catch(() => undefined)
  })

  const gateway = new ModelGateway(config)
  const media = new MediaService(config)
  const audio = new AudioService(media, {
    asrChunkMb: config.asrChunkMb,
    tmpDir: config.tmpDir,
    keepIntermediateMedia: false,
  })
  const frames = new FrameService(media)
  const transcription = new TranscriptionService(gateway, audio)
  const outline = new OutlineService(gateway)
  const summary = new SummaryService(gateway)
  const mindmap = new MindMapService(gateway)
  const knowledge = new KnowledgeService(gateway)
  const enrich = new EnrichService(gateway)
  const index = new RetrievalIndexService(gateway)
  const qa = new QaService(gateway)

  const runner = new TaskRunner({
    audio,
    bus,
    enrich,
    frames,
    gateway,
    index,
    knowledge,
    media,
    mindmap,
    outline,
    store,
    summary,
    transcription,
  })

  const tasks = new TaskManager({ bus, config, gateway, runner, store })

  return {
    audio,
    bus,
    config,
    enrich,
    frames,
    gateway,
    index,
    knowledge,
    media,
    mindmap,
    outline,
    qa,
    runner,
    store,
    summary,
    tasks,
    transcription,
  }
}
