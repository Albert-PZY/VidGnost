import path from "node:path"

import type {
  Chapter,
  KnowledgeGraphDoc,
  MindMapDoc,
  OutlineDoc,
  ParagraphDoc,
  SummaryDoc,
  TaskArtifact,
  TaskRecord,
  TranscriptDoc,
  TranslationDoc,
} from "@vidgnost/contracts"

import { AppError, toErrorShape } from "../core/errors.js"
import { sha1 } from "../core/id.js"
import { logger } from "../core/logger.js"
import { formatTimecode } from "../core/text.js"
import type { AudioService } from "../media/audio-service.js"
import type { FrameService } from "../media/frame-service.js"
import type { MediaService } from "../media/media-service.js"
import type { EnrichService } from "../insight/enrich-service.js"
import type { KnowledgeService } from "../insight/knowledge-service.js"
import type { MindMapService } from "../insight/mindmap-service.js"
import { renderMarkmapMarkdown } from "../insight/mindmap-service.js"
import type { OutlineService } from "../insight/outline-service.js"
import { segmentTranscript } from "../insight/segmenter.js"
import type { SummaryService } from "../insight/summary-service.js"
import { renderMarkdownNotes } from "../insight/summary-service.js"
import type { TranscriptionService } from "../asr/transcription-service.js"
import { transcriptToSrt } from "../asr/transcription-service.js"
import type { ModelGateway } from "../providers/gateway.js"
import { buildChunkContexts } from "../retrieval/contextualizer.js"
import { buildChunks, mapFramesToParagraphs } from "../retrieval/chunking.js"
import type { RetrievalIndexService } from "../retrieval/index-service.js"
import type { TaskStore } from "../store/task-store.js"
import type { TaskEventBus } from "./event-bus.js"
import { STAGE_DEFINITIONS, updateStage } from "./stages.js"

const log = logger.child({ scope: "pipeline" })

export interface RunnerDeps {
  audio: AudioService
  bus: TaskEventBus
  enrich: EnrichService
  frames: FrameService
  gateway: ModelGateway
  index: RetrievalIndexService
  knowledge: KnowledgeService
  media: MediaService
  mindmap: MindMapService
  outline: OutlineService
  store: TaskStore
  summary: SummaryService
  transcription: TranscriptionService
}

interface ChapterNotesFile {
  notes: Record<string, Array<{ start: number; text: string }>>
}

/** 顺序执行 10 个阶段，每阶段写检查点，命中缓存时直接复用产物。 */
export class TaskRunner {
  constructor(private readonly deps: RunnerDeps) {}

  async run(task: TaskRecord, signal: AbortSignal): Promise<TaskRecord> {
    let current: TaskRecord = { ...task, status: "running", error: undefined, updatedAt: new Date().toISOString() }
    await this.persist(current)
    this.emitStatus(current)

    try {
      for (const definition of STAGE_DEFINITIONS) {
        if (signal.aborted) {
          throw AppError.conflict("任务已取消。", { code: "TASK_CANCELED" })
        }
        current = await this.runStage(current, definition.id, signal)
      }

      const finishedAt = new Date().toISOString()
      current = {
        ...current,
        status: "succeeded",
        finishedAt,
        updatedAt: finishedAt,
        stats: {
          ...current.stats,
          elapsedMs: new Date(finishedAt).getTime() - new Date(current.createdAt).getTime(),
        },
      }
      await this.persist(current)
      this.deps.bus.publish({ type: "status", taskId: current.id, status: "succeeded" })
      this.deps.bus.publish({ type: "done", taskId: current.id, task: current })
      return current
    } catch (error) {
      const shape = toErrorShape(error)
      const finishedAt = new Date().toISOString()
      const canceled = shape.code === "TASK_CANCELED"
      current = {
        ...current,
        status: canceled ? "canceled" : "failed",
        finishedAt,
        updatedAt: finishedAt,
        error: shape,
      }
      await this.persist(current)
      this.deps.bus.publish({ type: "status", taskId: current.id, status: current.status, error: shape })
      this.deps.bus.publish({ type: "done", taskId: current.id, task: current })
      if (!canceled) {
        log.error({ taskId: current.id, error: shape.message }, "task failed")
      }
      return current
    }
  }

  private async runStage(task: TaskRecord, stageId: string, signal: AbortSignal): Promise<TaskRecord> {
    const definition = STAGE_DEFINITIONS.find((item) => item.id === stageId)
    if (!definition) {
      return task
    }

    const cacheKey = await this.cacheKey(task, definition.id, definition.roles, definition.optionKeys)
    const checkpoint = await this.deps.store.readCheckpoint<{ key?: string }>(task.id, definition.id)
    const artifactsReady = await this.artifactsReady(task, definition.id)

    if (checkpoint?.key === cacheKey && artifactsReady) {
      const reused = updateStage(task, definition.id, {
        status: "succeeded",
        progress: 1,
        message: "命中阶段缓存，复用已有产物",
        startedAt: task.stages.find((item) => item.id === definition.id)?.startedAt,
        finishedAt: new Date().toISOString(),
      })
      reused.updatedAt = new Date().toISOString()
      await this.persist(reused)
      this.emitStage(reused, definition.id)
      this.emitLog(reused.id, "info", `阶段「${definition.label}」命中缓存，已跳过。`)
      return reused
    }

    let next = updateStage(task, definition.id, {
      status: "running",
      progress: 0.02,
      message: "开始",
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      error: undefined,
      artifacts: [],
    })
    next.updatedAt = new Date().toISOString()
    await this.persist(next)
    this.emitStage(next, definition.id)

    const progress = async (value: number, message?: string) => {
      next = updateStage(next, definition.id, {
        progress: Math.max(0, Math.min(1, value)),
        ...(message ? { message } : {}),
      })
      next.updatedAt = new Date().toISOString()
      await this.persist(next)
      this.emitStage(next, definition.id)
    }
    const note = (message: string) => this.emitLog(next.id, "info", message)

    const context: StageContext = { note, progress, signal, task: next }
    const result = await this.execute(definition.id, context)

    if (result.source) {
      next = { ...next, source: result.source, title: result.source.title || next.title }
    }
    next = updateStage(next, definition.id, {
      status: result.skipped ? "skipped" : "succeeded",
      progress: 1,
      message: result.message || "完成",
      finishedAt: new Date().toISOString(),
      artifacts: result.artifacts || [],
    })
    next = {
      ...next,
      artifacts: mergeArtifacts(next.artifacts, await this.deps.store.refreshArtifacts(next, result.artifacts)),
      stats: { ...next.stats, ...(result.stats || {}) },
    }
    next.updatedAt = new Date().toISOString()
    await this.persist(next)
    this.emitStage(next, definition.id)
    for (const artifact of next.artifacts) {
      if ((result.artifacts || []).includes(artifact.key)) {
        this.deps.bus.publish({ type: "artifact", taskId: next.id, artifact })
      }
    }
    await this.deps.store.writeCheckpoint(next.id, definition.id, {
      key: cacheKey,
      message: result.message || "完成",
      artifacts: result.artifacts || [],
    })
    return next
  }

  /* ------------------------------------------------------------ 阶段实现 */

  private async execute(stageId: string, context: StageContext): Promise<StageResult> {
    switch (stageId) {
      case "ingest":
        return this.stageIngest(context)
      case "audio":
        return this.stageAudio(context)
      case "transcribe":
        return this.stageTranscribe(context)
      case "structure":
        return this.stageStructure(context)
      case "insight":
        return this.stageInsight(context)
      case "mindmap":
        return this.stageMindmap(context)
      case "knowledge":
        return this.stageKnowledge(context)
      case "vision":
        return this.stageVision(context)
      case "index":
        return this.stageIndex(context)
      default:
        return this.stageFinalize(context)
    }
  }

  private async stageIngest(context: StageContext): Promise<StageResult> {
    const { task } = context
    context.note(`解析来源：${task.source.uri}`)
    await context.progress(0.3, "探测媒体信息")
    const source = await this.deps.media.resolveSource({
      source: task.source.uri,
      taskId: task.id,
      signal: context.signal,
    })
    context.note(`媒体就绪：${formatTimecode(source.durationSeconds)} · ${(source.sizeBytes / 1024 / 1024).toFixed(1)}MB`)
    await context.progress(1, "来源就绪")
    return { source, message: `${formatTimecode(source.durationSeconds)} 媒体已就绪`, artifacts: [] }
  }

  private async stageAudio(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    if (task.source.audioOnly) {
      // 纯音频源直接复用原文件
      return { message: "来源为纯音频，跳过抽取", skipped: true, artifacts: [] }
    }
    context.note("抽取 16kHz 单声道音频…")
    const artifact = await this.deps.audio.extractWav({
      mediaPath: task.source.mediaPath,
      taskDir: this.deps.store.taskDir(task.id),
      signal: context.signal,
    })
    await this.deps.store.writeCheckpoint(task.id, "audio", {
      wavPath: artifact.wavPath,
      durationSeconds: artifact.durationSeconds,
    })
    context.note(`音频抽取完成：${formatTimecode(artifact.durationSeconds)}`)
    return { message: `音频 ${formatTimecode(artifact.durationSeconds)}`, artifacts: [] }
  }

  private async stageTranscribe(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    const audioCheckpoint = await this.deps.store.readCheckpoint<{ wavPath: string; durationSeconds: number }>(task.id, "audio")
    const wavPath = audioCheckpoint?.wavPath || path.join(this.deps.store.taskDir(task.id), "media", "audio.wav")
    const durationSeconds = audioCheckpoint?.durationSeconds || task.source.durationSeconds

    const result = await this.deps.transcription.transcribe({
      audio: { wavPath, durationSeconds },
      mediaPath: task.source.mediaPath,
      language: task.options.language,
      options: task.options,
      taskDir: this.deps.store.taskDir(task.id),
      signal: context.signal,
      onProgress: (message) => this.emitLog(task.id, "info", message),
      onSegment: (segment) => {
        this.deps.bus.publish({ type: "log", taskId: task.id, level: "info", message: `转写：${formatTimecode(segment.start)} ${segment.text}`, at: new Date().toISOString() })
      },
    })

    await this.deps.store.writeArtifactJson(task.id, "transcript", result.transcript)
    await this.deps.store.writeArtifactText(task.id, "transcript.srt", transcriptToSrt(result.transcript.segments))
    await this.deps.store.writeArtifactText(task.id, "transcript.txt", result.transcript.text)
    for (const artifact of await this.deps.store.refreshArtifacts(task, ["transcript", "transcript.srt", "transcript.txt"])) {
      this.deps.bus.publish({ type: "artifact", taskId: task.id, artifact })
    }

    context.note(`转写完成：${result.transcript.segments.length} 句（${result.transcript.engine}）`)
    return {
      message: `${result.transcript.segments.length} 句 · ${result.transcript.engineDetail}`,
      artifacts: ["transcript", "transcript.srt", "transcript.txt"],
      stats: {
        transcriptEngine: result.transcript.engine,
        transcriptModel: result.transcript.engineDetail,
        segments: result.transcript.segments.length,
      },
    }
  }

  private async stageStructure(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    const transcript = await this.deps.store.artifactJson<TranscriptDoc>(task.id, "transcript")
    if (!transcript) {
      throw AppError.conflict("缺少转写稿，无法进行分段。", { code: "TRANSCRIPT_MISSING" })
    }

    await context.progress(0.1, "语义分段")
    let paragraphDoc: ParagraphDoc = segmentTranscript(transcript)
    context.note(`语义分段：${paragraphDoc.paragraphs.length} 段`)

    if (task.options.proofread) {
      await context.progress(0.3, "转写校对")
      const proofread = await this.deps.enrich.proofread({
        paragraphs: paragraphDoc.paragraphs,
        chapters: [],
        title: task.title,
        signal: context.signal,
      })
      paragraphDoc = { paragraphs: proofread.paragraphs, generatedBy: `${paragraphDoc.generatedBy}+proofread` }
      context.note(`校对完成：修正 ${proofread.changedCount} 段`)
    }

    await this.deps.store.writeArtifactJson(task.id, "paragraphs", paragraphDoc)

    await context.progress(0.45, "切分章节")
    const outline: OutlineDoc = await this.deps.outline.build({
      paragraphs: paragraphDoc.paragraphs,
      durationSeconds: task.source.durationSeconds,
      title: task.title,
      signal: context.signal,
    })
    await this.deps.store.writeArtifactJson(task.id, "outline", outline)
    context.note(`章节切分：${outline.chapters.length} 章`)

    return {
      message: `${paragraphDoc.paragraphs.length} 段 / ${outline.chapters.length} 章`,
      artifacts: ["paragraphs", "outline"],
      stats: { paragraphs: paragraphDoc.paragraphs.length, chapters: outline.chapters.length },
    }
  }

  private async stageInsight(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    const paragraphDoc = await this.deps.store.artifactJson<ParagraphDoc>(task.id, "paragraphs")
    const outline = await this.deps.store.artifactJson<OutlineDoc>(task.id, "outline")
    if (!paragraphDoc || !outline) {
      throw AppError.conflict("缺少分段或章节产物。", { code: "STRUCTURE_MISSING" })
    }

    const total = outline.chapters.length || 1
    const chapterNotes = await this.deps.summary.mapChapters({
      chapters: outline.chapters,
      paragraphs: paragraphDoc.paragraphs,
      title: task.title,
      signal: context.signal,
      onProgress: (done) => {
        void context.progress(0.1 + (done / total) * 0.65, `章节要点 ${done}/${total}`)
      },
    })

    await this.writeChapterNotes(task.id, chapterNotes)

    await context.progress(0.8, "全局归并")
    const summary: SummaryDoc = await this.deps.summary.reduce({
      chapters: outline.chapters,
      paragraphs: paragraphDoc.paragraphs,
      durationSeconds: task.source.durationSeconds,
      preset: task.options.preset,
      title: task.title,
      signal: context.signal,
      chapterNotes,
    })
    await this.deps.store.writeArtifactJson(task.id, "summary", summary)

    const notes = renderMarkdownNotes({
      chapters: outline.chapters,
      chapterNotes,
      summary,
      title: task.title,
    })
    await this.deps.store.writeArtifactText(task.id, "notes", notes)

    return {
      message: `${summary.highlights.length} 条结论 · ${summary.tags.length} 个标签`,
      artifacts: ["summary", "notes"],
    }
  }

  private async stageMindmap(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    const outline = await this.deps.store.artifactJson<OutlineDoc>(task.id, "outline")
    const summary = await this.deps.store.artifactJson<SummaryDoc>(task.id, "summary")
    if (!outline || !summary) {
      return { message: "缺少章节或摘要，跳过导图", skipped: true, artifacts: [] }
    }
    const chapterNotes = await this.readChapterNotes(task.id)

    const mindmap: MindMapDoc = await this.deps.mindmap.build({
      chapters: outline.chapters,
      chapterNotes,
      summary,
      title: task.title,
      signal: context.signal,
    })
    await this.deps.store.writeArtifactJson(task.id, "mindmap", mindmap)
    await this.deps.store.writeArtifactText(task.id, "mindmap.mmd", mindmap.mermaid)
    await this.deps.store.writeArtifactText(
      task.id,
      "notes",
      `${await this.deps.store.readArtifactText(task.id, "notes")}\n\n## 思维导图\n\n\`\`\`mermaid\n${mindmap.mermaid}\n\`\`\`\n`,
    )

    return { message: `${countNodes(mindmap)} 个节点`, artifacts: ["mindmap", "mindmap.mmd", "notes"] }
  }

  private async stageKnowledge(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    const outline = await this.deps.store.artifactJson<OutlineDoc>(task.id, "outline")
    const paragraphDoc = await this.deps.store.artifactJson<ParagraphDoc>(task.id, "paragraphs")
    if (!outline || !paragraphDoc) {
      return { message: "缺少分段产物，跳过知识图谱", skipped: true, artifacts: [] }
    }

    const graph: KnowledgeGraphDoc = await this.deps.knowledge.build({
      chapters: outline.chapters,
      paragraphs: paragraphDoc.paragraphs,
      title: task.title,
      signal: context.signal,
    })
    await this.deps.store.writeArtifactJson(task.id, "knowledge", graph)
    if (graph.nodes.length > 0) {
      await this.deps.store.writeArtifactText(
        task.id,
        "notes",
        `${await this.deps.store.readArtifactText(task.id, "notes")}\n\n## 关键概念\n\n${graph.nodes
          .slice(0, 18)
          .map((node) => `- **${node.label}**${node.start === undefined ? "" : ` \`[${formatTimecode(node.start)}]\``}`)
          .join("\n")}\n`,
      )
    }

    return {
      message: `${graph.nodes.length} 个实体 / ${graph.edges.length} 条关系`,
      artifacts: ["knowledge", "notes"],
      stats: { knowledgeNodes: graph.nodes.length },
    }
  }

  private async stageVision(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    if (!task.options.vision) {
      return { message: "未开启视觉增强", skipped: true, artifacts: [] }
    }
    if (task.source.audioOnly) {
      return { message: "来源为纯音频，跳过画面理解", skipped: true, artifacts: [] }
    }

    context.note("抽取关键帧…")
    await context.progress(0.1, "抽取关键帧")
    const frames = await this.deps.frames.extractKeyFrames({
      mediaPath: task.source.mediaPath,
      durationSeconds: task.source.durationSeconds,
      taskDir: this.deps.store.taskDir(task.id),
      signal: context.signal,
      maxFrames: task.options.preset === "deep" ? 30 : 16,
    })
    context.note(`抽取到 ${frames.length} 张候选帧，开始多模态图注…`)

    const captioned = await this.deps.enrich.captionFrames({
      frames,
      taskDir: this.deps.store.taskDir(task.id),
      title: task.title,
      signal: context.signal,
      onProgress: (done, total) => {
        void context.progress(0.1 + (done / Math.max(1, total)) * 0.85, `画面理解 ${done}/${total}`)
      },
    })

    await this.deps.store.writeArtifactJson(task.id, "frames", {
      frames: captioned,
      generatedBy: "qwen3.8-omni-flash",
      createdAt: new Date().toISOString(),
    })

    return {
      message: `${captioned.length} 帧已理解`,
      artifacts: ["frames"],
      stats: { frames: captioned.length },
    }
  }

  private async stageIndex(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    const paragraphDoc = await this.deps.store.artifactJson<ParagraphDoc>(task.id, "paragraphs")
    const outline = await this.deps.store.artifactJson<OutlineDoc>(task.id, "outline")
    const framesDoc = await this.deps.store.artifactJson<{ frames: Array<{ caption?: string; onScreenText?: string; time: number }> }>(task.id, "frames")
    if (!paragraphDoc || !outline) {
      throw AppError.conflict("缺少分段或章节产物，无法建立索引。", { code: "STRUCTURE_MISSING" })
    }

    const frameNotes = framesDoc?.frames?.length
      ? mapFramesToParagraphs({ frames: framesDoc.frames, paragraphs: paragraphDoc.paragraphs })
      : undefined

    await context.progress(0.1, "章节内切块")
    const chunks = buildChunks({
      chapters: outline.chapters,
      paragraphs: paragraphDoc.paragraphs,
      frameNotesByParagraph: frameNotes,
    })
    context.note(`切块：${chunks.length} 块`)

    await context.progress(0.25, "生成检索上下文前缀")
    const contexts = await buildChunkContexts({
      chunks,
      chapters: outline.chapters,
      gateway: this.deps.gateway,
      title: task.title,
      signal: context.signal,
      onProgress: (done, total) => {
        void context.progress(0.25 + (done / Math.max(1, total)) * 0.45, `上下文前缀 ${done}/${total}`)
      },
    })

    await context.progress(0.75, "向量化与索引落盘")
    const result = await this.deps.index.build({
      chunks,
      contexts,
      taskDir: this.deps.store.taskDir(task.id),
      signal: context.signal,
    })

    return {
      message: `${result.chunkCount} 块 · ${result.dimensions} 维 · ${result.model}`,
      artifacts: ["index"],
      stats: { chunks: result.chunkCount },
    }
  }

  private async stageFinalize(context: StageContext): Promise<StageResult> {
    const task = await this.currentTask(context.task.id)
    const [outline, summary, mindmap, knowledge, paragraphDoc] = await Promise.all([
      this.deps.store.artifactJson<OutlineDoc>(task.id, "outline"),
      this.deps.store.artifactJson<SummaryDoc>(task.id, "summary"),
      this.deps.store.artifactJson<MindMapDoc>(task.id, "mindmap"),
      this.deps.store.artifactJson<KnowledgeGraphDoc>(task.id, "knowledge"),
      this.deps.store.artifactJson<ParagraphDoc>(task.id, "paragraphs"),
    ])

    const artifacts: string[] = []

    if (task.options.translateTo && paragraphDoc) {
      context.note(`翻译为 ${task.options.translateTo}…`)
      try {
        const transcript = await this.deps.store.artifactJson<TranscriptDoc>(task.id, "transcript")
        const translation: TranslationDoc = await this.deps.enrich.translate({
          paragraphs: paragraphDoc.paragraphs,
          targetLanguage: task.options.translateTo,
          sourceLanguage: transcript?.language || task.options.language,
          signal: context.signal,
        })
        await this.deps.store.writeArtifactJson(task.id, "translation", translation)
        artifacts.push("translation")
      } catch (error) {
        this.emitLog(task.id, "warn", `翻译失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const report = renderReport({ task, outline, summary, mindmap, knowledge })
    await this.deps.store.writeArtifactText(task.id, "report", report)
    artifacts.push("report")

    const pack = {
      version: 3,
      task: {
        id: task.id,
        title: task.title,
        createdAt: task.createdAt,
        durationSeconds: task.source.durationSeconds,
        platform: task.source.platform,
        engine: task.stats.transcriptEngine,
      },
      outline,
      summary,
      mindmap,
      knowledge,
    }
    await this.deps.store.writeArtifactJson(task.id, "pack", pack)
    artifacts.push("pack")

    return { message: "导出工件已生成", artifacts }
  }

  /* ------------------------------------------------------------- 工具 */

  private async currentTask(taskId: string): Promise<TaskRecord> {
    return this.deps.store.requireTask(taskId)
  }

  private async writeChapterNotes(taskId: string, notes: Map<string, Array<{ start: number; text: string }>>): Promise<void> {
    const { writeJsonFile } = await import("../core/fs.js")
    await writeJsonFile(path.join(this.deps.store.taskDir(taskId), "chapter-notes.json"), {
      notes: Object.fromEntries(notes),
    } satisfies ChapterNotesFile)
  }

  async readChapterNotes(taskId: string): Promise<Map<string, Array<{ start: number; text: string }>>> {
    const { readJsonFile } = await import("../core/fs.js")
    const file = await readJsonFile<ChapterNotesFile>(path.join(this.deps.store.taskDir(taskId), "chapter-notes.json"))
    return new Map(Object.entries(file?.notes || {}))
  }

  private async artifactsReady(task: TaskRecord, stageId: string): Promise<boolean> {
    const required: Record<string, string[]> = {
      transcript: ["transcript"],
      structure: ["paragraphs", "outline"],
      insight: ["summary"],
      mindmap: ["mindmap"],
      knowledge: ["knowledge"],
      index: ["index"],
      finalize: ["report", "pack"],
    }
    const keys = required[stageId]
    if (!keys) {
      return true
    }
    const dir = this.deps.store.taskDir(task.id)
    const fs = await import("../core/fs.js")
    for (const key of keys) {
      const relative = (await import("../store/task-store.js")).ARTIFACT_FILES[key]
      if (!relative || !(await fs.pathExists(path.join(dir, relative)))) {
        return false
      }
    }
    return true
  }

  private async cacheKey(
    task: TaskRecord,
    stageId: string,
    roles: string[],
    optionKeys: Array<keyof TaskRecord["options"]>,
  ): Promise<string> {
    const signature = await this.deps.gateway.settings.signature(roles as never)
    const options = optionKeys.map((key) => `${String(key)}=${String(task.options[key])}`).join(",")
    return sha1(stageId, task.source.fingerprint, signature, options)
  }

  private async persist(task: TaskRecord): Promise<void> {
    await this.deps.store.write(task)
  }

  private emitStage(task: TaskRecord, stageId: string): void {
    const stage = task.stages.find((item) => item.id === stageId)
    if (stage) {
      this.deps.bus.publish({ type: "stage", taskId: task.id, stage, readiness: task.readiness })
    }
  }

  private emitStatus(task: TaskRecord): void {
    this.deps.bus.publish({ type: "status", taskId: task.id, status: task.status, error: task.error })
  }

  private emitLog(taskId: string, level: "info" | "warn" | "error", message: string): void {
    this.deps.bus.publish({ type: "log", taskId, level, message, at: new Date().toISOString() })
  }
}

interface StageContext {
  note: (message: string) => void
  progress: (value: number, message?: string) => Promise<void>
  signal: AbortSignal
  task: TaskRecord
}

interface StageResult {
  artifacts?: string[]
  message?: string
  skipped?: boolean
  /** ingest 阶段解析出的媒体信息，由 runner 合并回任务。 */
  source?: TaskRecord["source"]
  stats?: Partial<TaskRecord["stats"]>
}

function mergeArtifacts(current: TaskArtifact[], updates: TaskArtifact[]): TaskArtifact[] {
  const merged = new Map(current.map((artifact) => [artifact.key, artifact]))
  for (const artifact of updates) {
    merged.set(artifact.key, artifact)
  }
  return [...merged.values()]
}

function countNodes(mindmap: MindMapDoc): number {
  let count = 0
  const walk = (node: { children?: unknown[] }) => {
    count += 1
    for (const child of (node.children || []) as Array<{ children?: unknown[] }>) {
      walk(child)
    }
  }
  walk(mindmap.root)
  return count
}

function renderReport(input: {
  knowledge?: KnowledgeGraphDoc | null
  mindmap?: MindMapDoc | null
  outline?: OutlineDoc | null
  summary?: SummaryDoc | null
  task: TaskRecord
}): string {
  const { task, outline, summary, mindmap, knowledge } = input
  const lines: string[] = [
    `# ${task.title}`,
    "",
    `> 时长 ${formatTimecode(task.source.durationSeconds)} · 来源 ${task.source.platform} · 转写引擎 ${task.stats.transcriptEngine || "unknown"}`,
    "",
  ]

  const chapters: Chapter[] = outline?.chapters || []
  if (summary) {
    lines.push("## 总览", "", summary.tldr, "")
    if (summary.highlights.length > 0) {
      lines.push("## 核心结论", "")
      for (const highlight of summary.highlights) {
        lines.push(`- ${highlight.text}${highlight.start === undefined ? "" : ` \`[${formatTimecode(highlight.start)}]\``}`)
      }
      lines.push("")
    }
    if (summary.actions.length > 0) {
      lines.push("## 行动项", "")
      lines.push(...summary.actions.map((action) => `- [ ] ${action}`))
      lines.push("")
    }
    if (summary.glossary.length > 0) {
      lines.push("## 术语表", "")
      lines.push(...summary.glossary.map((entry) => `- **${entry.term}**：${entry.explanation}`))
      lines.push("")
    }
  }

  if (chapters.length > 0) {
    lines.push("## 章节", "")
    lines.push("| # | 章节 | 时间 |", "| --- | --- | --- |")
    chapters.forEach((chapter, index) => {
      lines.push(`| ${index + 1} | ${chapter.title} | \`${formatTimecode(chapter.start)}\` |`)
    })
    lines.push("")
  }

  if (mindmap) {
    lines.push("## 思维导图", "", "```mermaid", mindmap.mermaid, "```", "")
    lines.push(renderMarkmapMarkdown(mindmap.root), "")
  }

  if (knowledge && knowledge.nodes.length > 0) {
    lines.push("## 关键概念", "")
    lines.push(
      ...knowledge.nodes
        .slice(0, 24)
        .map((node) => `- **${node.label}**${node.start === undefined ? "" : ` \`[${formatTimecode(node.start)}]\``}`),
    )
    lines.push("")
  }

  if (summary && summary.questions.length > 0) {
    lines.push("## 遗留疑问", "")
    lines.push(...summary.questions.map((question) => `- ${question}`))
    lines.push("")
  }

  lines.push("---", "", `由 VidGnost 生成 · 任务 ${task.id}`)
  return lines.join("\n")
}
