import { randomUUID } from "node:crypto"

import type {
  ExportRecord,
  KnowledgeLibraryResponse,
  KnowledgeNote,
  KnowledgeNoteCreateRequest,
  KnowledgeNoteFilter,
  KnowledgeNoteUpdateRequest,
  StudyPreview,
  StudyState,
  StudyWorkbenchResponse,
  SubtitleTrack,
  TranslationRecord,
  TaskExportCreateRequest,
  TaskExportKindValue,
} from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import type { LlmConfigRepository } from "../llm/llm-config-repository.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { TaskRepository } from "../tasks/task-repository.js"
import { parseTranscriptSegments } from "../tasks/task-support.js"
import { UiSettingsRepository } from "../ui/ui-settings-repository.js"
import { ExportFormatterService } from "./export-formatter-service.js"
import { KnowledgeNoteRepository } from "./knowledge-note-repository.js"
import { SqliteStudyRepository } from "./sqlite-study-repository.js"
import { SubtitleTrackService } from "./subtitle-track-service.js"
import { TranslationDecisionService } from "./translation-decision-service.js"
import { buildDefaultStudyState, buildStudyPack, StudyWorkspaceService } from "./study-workspace-service.js"

interface FormattedTaskExport {
  content: string
  content_type: string
  file_name: string
  format: ExportRecord["format"]
}

interface StudyServiceDependencies {
  llmClient?: Pick<OpenAiCompatibleClient, "generateText" | "listModels"> | null
  llmConfigRepository?: LlmConfigRepository | null
}

interface WorkspaceBuildContext {
  currentState: StudyState
  exportRecords: ExportRecord[]
  noteLibrary: KnowledgeLibraryResponse
  persistedTracks: SubtitleTrack[]
  task: Awaited<ReturnType<StudyService["requireTask"]>>
  uiSettings: {
    study_default_translation_target: string | null
  }
  updatedAt: string
}

export class StudyService {
  private readonly exportFormatterService: ExportFormatterService
  private readonly knowledgeNoteRepository: KnowledgeNoteRepository
  private readonly sqliteStudyRepository: SqliteStudyRepository
  private readonly studyWorkspaceService: StudyWorkspaceService
  private readonly subtitleTrackService: SubtitleTrackService
  private readonly translationDecisionService: TranslationDecisionService
  private readonly uiSettingsRepository: UiSettingsRepository

  constructor(
    config: AppConfig,
    private readonly taskRepository: TaskRepository,
    dependencies: StudyServiceDependencies = {},
  ) {
    this.sqliteStudyRepository = new SqliteStudyRepository(config)
    this.knowledgeNoteRepository = new KnowledgeNoteRepository(config, this.sqliteStudyRepository)
    this.uiSettingsRepository = new UiSettingsRepository(config)
    this.exportFormatterService = new ExportFormatterService()
    this.subtitleTrackService = new SubtitleTrackService(config, taskRepository)
    this.translationDecisionService = new TranslationDecisionService(taskRepository, {
      llmClient: dependencies.llmClient,
      llmConfigRepository: dependencies.llmConfigRepository,
    })
    this.studyWorkspaceService = new StudyWorkspaceService()
  }

  async getPreview(taskId: string): Promise<StudyPreview> {
    const workspace = await this.materializeWorkspace(taskId)
    return workspace.preview
  }

  async getWorkspace(taskId: string): Promise<StudyWorkbenchResponse> {
    return this.materializeWorkspace(taskId)
  }

  async getSubtitleTracks(taskId: string): Promise<SubtitleTrack[]> {
    return (await this.materializeWorkspace(taskId)).subtitle_tracks
  }

  async switchSubtitleTrack(taskId: string, trackId: string): Promise<StudyState> {
    const workspace = await this.buildWorkspace(taskId)
    const selectedTrack = workspace.subtitle_tracks.find((track) => track.track_id === trackId)
    if (!selectedTrack) {
      throw AppError.badRequest("Subtitle track not found", {
        code: "SUBTITLE_TRACK_NOT_FOUND",
      })
    }
    return this.updateStudyState(taskId, {
      last_selected_subtitle_track_id: selectedTrack.track_id,
    })
  }

  async listExports(taskId: string): Promise<ExportRecord[]> {
    await this.requireTask(taskId)
    return this.sqliteStudyRepository.readExportRecords(taskId)
  }

  async createExport(taskId: string, request: TaskExportCreateRequest): Promise<ExportRecord> {
    const exportPayload = await this.formatTaskExport(taskId, request.export_kind)
    const createdAt = new Date().toISOString()
    const filePath = `D/study/exports/${createdAt.replace(/[:.]/g, "-")}-${request.export_kind}.${extensionForFormat(exportPayload.format)}`
    await this.taskRepository.writeTaskArtifactText(taskId, filePath, exportPayload.content)
    const record: ExportRecord = {
      id: `export-${randomUUID()}`,
      task_id: taskId,
      export_kind: request.export_kind,
      format: request.format || exportPayload.format,
      file_path: filePath,
      created_at: createdAt,
    }
    await this.sqliteStudyRepository.appendExportRecord(taskId, record)
    await this.materializeWorkspace(taskId)
    return record
  }

  async formatTaskExport(taskId: string, exportKind: TaskExportKindValue): Promise<FormattedTaskExport> {
    const task = await this.requireTask(taskId)
    const workspace = await this.buildWorkspace(taskId)
    const notes = await this.knowledgeNoteRepository.list({ task_id: taskId })
    const title = sanitizeFileName(String(task.title || taskId).trim() || taskId)

    if (exportKind === "study_pack") {
      const payload = this.exportFormatterService.formatStudyPack(workspace.study_pack)
      return {
        ...payload,
        content_type: "text/markdown; charset=utf-8",
        file_name: `${title}-study-pack.md`,
      }
    }

    if (exportKind === "subtitle_tracks") {
      const payload = this.exportFormatterService.formatSubtitleTracks(workspace.subtitle_tracks)
      return {
        ...payload,
        content_type: "application/json; charset=utf-8",
        file_name: `${title}-subtitle-tracks.json`,
      }
    }

    if (exportKind === "translation_records") {
      const payload = this.exportFormatterService.formatTranslationRecords(workspace.translation_records)
      return {
        ...payload,
        content_type: "application/json; charset=utf-8",
        file_name: `${title}-translation-records.json`,
      }
    }

    if (exportKind === "knowledge_notes") {
      const payload = this.exportFormatterService.formatKnowledgeNotes(notes.items)
      return {
        ...payload,
        content_type: "text/markdown; charset=utf-8",
        file_name: `${title}-knowledge-notes.md`,
      }
    }

    throw AppError.badRequest("Unsupported study export kind", {
      code: "UNSUPPORTED_STUDY_EXPORT_KIND",
    })
  }

  async updateStudyState(taskId: string, patch: Partial<StudyState>): Promise<StudyState> {
    const workspace = await this.materializeWorkspace(taskId)
    const current = workspace.study_state
    const validTrackId = patch.last_selected_subtitle_track_id
      ? workspace.subtitle_tracks.find((track) => track.track_id === patch.last_selected_subtitle_track_id)?.track_id ?? null
      : patch.last_selected_subtitle_track_id === null
        ? null
        : undefined

    const nextState: StudyState = {
      ...current,
      ...(patch.active_highlight_id !== undefined ? { active_highlight_id: patch.active_highlight_id } : {}),
      ...(patch.playback_position_seconds !== undefined
        ? { playback_position_seconds: Math.max(0, Number(patch.playback_position_seconds) || 0) }
        : {}),
      ...(patch.selected_theme_id !== undefined ? { selected_theme_id: patch.selected_theme_id } : {}),
      ...(validTrackId !== undefined ? { last_selected_subtitle_track_id: validTrackId } : {}),
      ...(patch.is_favorite !== undefined ? { is_favorite: Boolean(patch.is_favorite) } : {}),
      ...(patch.last_opened_at !== undefined ? { last_opened_at: patch.last_opened_at } : {}),
    }
    await this.sqliteStudyRepository.upsertState(taskId, nextState)
    await this.materializeWorkspace(taskId)
    return nextState
  }

  async listKnowledgeNotes(filter: KnowledgeNoteFilter): Promise<KnowledgeLibraryResponse> {
    return this.knowledgeNoteRepository.list(filter)
  }

  async createKnowledgeNote(payload: KnowledgeNoteCreateRequest): Promise<KnowledgeNote> {
    const task = await this.requireTask(payload.task_id)
    const note = await this.knowledgeNoteRepository.create({ payload, task })
    await this.materializeWorkspace(note.task_id)
    return note
  }

  async updateKnowledgeNote(noteId: string, payload: KnowledgeNoteUpdateRequest): Promise<KnowledgeNote> {
    const note = await this.knowledgeNoteRepository.update(noteId, payload)
    await this.materializeWorkspace(note.task_id)
    return note
  }

  async deleteKnowledgeNote(noteId: string): Promise<void> {
    const note = await this.knowledgeNoteRepository.require(noteId)
    await this.knowledgeNoteRepository.delete(noteId)
    await this.materializeWorkspace(note.task_id)
  }

  async close(): Promise<void> {
    await this.sqliteStudyRepository.close()
  }

  async materializeSubtitleTracks(taskId: string): Promise<SubtitleTrack[]> {
    const context = await this.loadWorkspaceBuildContext(taskId)
    const subtitleBundle = await this.subtitleTrackService.buildTracks(context.task)
    const subtitleTracks = mergeTracks(subtitleBundle.tracks, context.persistedTracks)
    await this.sqliteStudyRepository.upsertSubtitleTracks(taskId, subtitleTracks)
    await this.writeStudyJsonArtifact(taskId, "subtitle-tracks.json", subtitleTracks)
    return subtitleTracks
  }

  async materializeTranslationRecords(taskId: string): Promise<{
    subtitle_tracks: SubtitleTrack[]
    translation_records: TranslationRecord[]
  }> {
    const context = await this.loadWorkspaceBuildContext(taskId)
    const subtitleBundle = await this.subtitleTrackService.buildTracks(context.task)
    const translationDecision = await this.translationDecisionService.resolve({
      preferredTargetLanguage: context.uiSettings.study_default_translation_target,
      subtitleTracks: {
        default_track_id: subtitleBundle.default_track_id,
        tracks: mergeTracks(subtitleBundle.tracks, context.persistedTracks),
      },
      task: context.task,
      updatedAt: context.updatedAt,
    })

    await Promise.all([
      this.sqliteStudyRepository.upsertSubtitleTracks(taskId, translationDecision.subtitle_tracks),
      this.sqliteStudyRepository.upsertTranslationRecords(taskId, translationDecision.translation_records),
      this.writeStudyJsonArtifact(taskId, "subtitle-tracks.json", translationDecision.subtitle_tracks),
      this.writeStudyJsonArtifact(taskId, "translation-records.json", translationDecision.translation_records),
    ])

    return {
      subtitle_tracks: translationDecision.subtitle_tracks,
      translation_records: translationDecision.translation_records,
    }
  }

  async materializeWorkspace(taskId: string): Promise<StudyWorkbenchResponse> {
    const workspace = await this.buildWorkspace(taskId)
    return {
      task: workspace.task,
      preview: workspace.preview,
      study_pack: workspace.study_pack,
      subtitle_tracks: workspace.subtitle_tracks,
      translation_records: workspace.translation_records,
      study_state: workspace.study_state,
      export_records: workspace.export_records,
    }
  }

  private async buildWorkspace(taskId: string) {
    const context = await this.loadWorkspaceBuildContext(taskId)
    const studyPack = buildStudyPack(
      context.task,
      parseTranscriptSegments(context.task.transcript_segments_json),
      context.updatedAt,
    )
    const subtitleBundle = await this.subtitleTrackService.buildTracks(context.task, {
      probeMode: "cached",
    })
    const mergedTracks = mergeTracks(subtitleBundle.tracks, context.persistedTracks)
    const translationDecision = await this.translationDecisionService.resolve({
      preferredTargetLanguage: context.uiSettings.study_default_translation_target,
      subtitleTracks: {
        default_track_id: subtitleBundle.default_track_id,
        tracks: mergedTracks,
      },
      task: context.task,
      updatedAt: context.updatedAt,
    })
    const nextState = this.resolveState({
      currentState: context.currentState,
      preferredTrackId: translationDecision.preferred_track_id,
      subtitleTracks: translationDecision.subtitle_tracks,
      fallbackTrackId: subtitleBundle.default_track_id,
    })
    if (stateChanged(context.currentState, nextState)) {
      await this.sqliteStudyRepository.upsertState(taskId, nextState)
    }

    const workspace = this.studyWorkspaceService.buildWorkspace({
      exportRecords: context.exportRecords,
      noteCount: context.noteLibrary.total,
      state: nextState,
      studyPack,
      subtitleTracks: translationDecision.subtitle_tracks,
      task: context.task,
      translationRecords: translationDecision.translation_records,
    })

    await Promise.all([
      this.sqliteStudyRepository.upsertPack(taskId, workspace.study_pack),
      this.sqliteStudyRepository.upsertSubtitleTracks(taskId, workspace.subtitle_tracks),
      this.sqliteStudyRepository.upsertTranslationRecords(taskId, workspace.translation_records),
    ])
    await this.writeStudyArtifacts(taskId, workspace)
    return workspace
  }

  private async loadWorkspaceBuildContext(taskId: string): Promise<WorkspaceBuildContext> {
    const task = await this.requireTask(taskId)
    const [currentState, exportRecords, noteLibrary, persistedTracks, uiSettings] = await Promise.all([
      this.ensureState(taskId),
      this.sqliteStudyRepository.readExportRecords(taskId),
      this.knowledgeNoteRepository.list({ task_id: taskId }),
      this.sqliteStudyRepository.readSubtitleTracks(taskId),
      this.uiSettingsRepository.get(),
    ])

    return {
      currentState,
      exportRecords,
      noteLibrary,
      persistedTracks,
      task,
      uiSettings,
      updatedAt: normalizeTimestamp(task.updated_at || task.created_at),
    }
  }

  private resolveState(input: {
    currentState: StudyState
    fallbackTrackId: string | null
    preferredTrackId: string | null
    subtitleTracks: SubtitleTrack[]
  }): StudyState {
    const availableTrackIds = new Set(input.subtitleTracks.map((track) => track.track_id))
    const selectedTrackId = availableTrackIds.has(String(input.currentState.last_selected_subtitle_track_id || ""))
      ? input.currentState.last_selected_subtitle_track_id
      : input.preferredTrackId && availableTrackIds.has(input.preferredTrackId)
        ? input.preferredTrackId
        : input.fallbackTrackId && availableTrackIds.has(input.fallbackTrackId)
          ? input.fallbackTrackId
          : input.subtitleTracks[0]?.track_id ?? null
    return {
      ...input.currentState,
      last_selected_subtitle_track_id: selectedTrackId,
    }
  }

  private async ensureState(taskId: string): Promise<StudyState> {
    const persisted = await this.sqliteStudyRepository.readState(taskId)
    if (persisted) {
      return persisted
    }
    const state = buildDefaultStudyState()
    await this.sqliteStudyRepository.upsertState(taskId, state)
    return state
  }

  private async requireTask(taskId: string) {
    const task = await this.taskRepository.getStoredRecord(taskId)
    if (!task) {
      throw AppError.notFound("Task not found", {
        code: "TASK_NOT_FOUND",
      })
    }
    return task
  }

  private async writeStudyArtifacts(
    taskId: string,
    workspace: Awaited<ReturnType<StudyWorkspaceService["buildWorkspace"]>>,
  ): Promise<void> {
    await this.taskRepository.writeTaskArtifactText(
      taskId,
      "D/study/workspace.json",
      JSON.stringify({
        task: workspace.task,
        preview: workspace.preview,
        study_pack: workspace.study_pack,
        subtitle_tracks: workspace.subtitle_tracks,
        translation_records: workspace.translation_records,
        study_state: workspace.study_state,
        export_records: workspace.export_records,
      }, null, 2),
    )
    await this.taskRepository.writeTaskArtifactText(taskId, "D/study/preview.json", JSON.stringify(workspace.preview, null, 2))
    await this.taskRepository.writeTaskArtifactText(taskId, "D/study/study-pack.json", JSON.stringify(workspace.study_pack, null, 2))
    await this.writeStudyJsonArtifact(taskId, "subtitle-tracks.json", workspace.subtitle_tracks)
    await this.writeStudyJsonArtifact(taskId, "translation-records.json", workspace.translation_records)
    await this.writeStudyJsonArtifact(taskId, "export-records.json", workspace.export_records)
  }

  private async writeStudyJsonArtifact(taskId: string, fileName: string, payload: unknown): Promise<void> {
    await this.taskRepository.writeTaskArtifactText(taskId, `D/study/${fileName}`, JSON.stringify(payload, null, 2))
  }
}

function extensionForFormat(format: ExportRecord["format"]): string {
  if (format === "md" || format === "json" || format === "txt" || format === "csv") {
    return format
  }
  return "txt"
}

function mergeTracks(primary: SubtitleTrack[], persisted: SubtitleTrack[]): SubtitleTrack[] {
  const merged = new Map<string, SubtitleTrack>()
  for (const track of [...persisted, ...primary]) {
    merged.set(track.track_id, track)
  }
  return [...merged.values()]
}

function normalizeTimestamp(value: unknown): string {
  const parsed = Date.parse(String(value || "").trim())
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString()
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim() || "study-export"
}

function stateChanged(left: StudyState, right: StudyState): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}
