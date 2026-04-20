import type { FastifyInstance } from "fastify"

import type {
  KnowledgeNoteCreateRequest,
  KnowledgeNoteFilter,
  KnowledgeNoteUpdateRequest,
  StudyState,
  SubtitleSwitchRequest,
  TaskExportCreateRequest,
} from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import type { StudyService } from "../modules/study/study-service.js"
import { normalizeTaskId, type TaskIdParams } from "./task-route-support.js"

interface KnowledgeNoteIdParams {
  noteId?: string
}

interface StudyStatePatchBody {
  active_highlight_id?: string | null
  playback_position_seconds?: number
  last_position_seconds?: number
  last_selected_subtitle_track_id?: string | null
  selected_theme_id?: string | null
  is_favorite?: boolean
  favorite?: boolean
  last_opened_at?: string | null
}

export async function registerStudyRoutes(
  app: FastifyInstance,
  apiPrefix: string,
  studyService: StudyService,
): Promise<void> {
  app.get(`${apiPrefix}/tasks/:taskId/study-preview`, async (request) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    return studyService.getPreview(taskId)
  })

  app.get(`${apiPrefix}/tasks/:taskId/study-pack`, async (request) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    return studyService.getWorkspace(taskId)
  })

  app.get(`${apiPrefix}/tasks/:taskId/subtitle-tracks`, async (request) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    return studyService.getSubtitleTracks(taskId)
  })

  app.post(`${apiPrefix}/tasks/:taskId/subtitle-switch`, async (request) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const body = (request.body || {}) as SubtitleSwitchRequest
    const trackId = String(body.track_id || "").trim()
    if (!trackId) {
      throw AppError.badRequest("Subtitle track id is required", {
        code: "SUBTITLE_TRACK_ID_INVALID",
      })
    }
    return studyService.switchSubtitleTrack(taskId, trackId)
  })

  app.get(`${apiPrefix}/tasks/:taskId/exports`, async (request) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    return studyService.listExports(taskId)
  })

  app.post(`${apiPrefix}/tasks/:taskId/exports`, async (request) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    return studyService.createExport(taskId, request.body as TaskExportCreateRequest)
  })

  app.patch(`${apiPrefix}/tasks/:taskId/study-state`, async (request) => {
    const taskId = normalizeTaskId(request.params as TaskIdParams)
    const body = (request.body || {}) as StudyStatePatchBody
    const patch: Partial<StudyState> = {
      ...(body.active_highlight_id !== undefined ? { active_highlight_id: body.active_highlight_id } : {}),
      ...((body.playback_position_seconds ?? body.last_position_seconds) !== undefined
        ? { playback_position_seconds: body.playback_position_seconds ?? body.last_position_seconds ?? 0 }
        : {}),
      ...(body.last_selected_subtitle_track_id !== undefined
        ? { last_selected_subtitle_track_id: body.last_selected_subtitle_track_id }
        : {}),
      ...(body.selected_theme_id !== undefined ? { selected_theme_id: body.selected_theme_id } : {}),
      ...((body.is_favorite ?? body.favorite) !== undefined
        ? { is_favorite: Boolean(body.is_favorite ?? body.favorite) }
        : {}),
      ...(body.last_opened_at !== undefined ? { last_opened_at: body.last_opened_at } : {}),
    }
    if (Object.keys(patch).length === 0) {
      throw AppError.badRequest("Study state patch is empty", {
        code: "STUDY_STATE_PATCH_EMPTY",
      })
    }
    return studyService.updateStudyState(taskId, patch)
  })

  app.get(`${apiPrefix}/knowledge/notes`, async (request) => {
    const query = (request.query || {}) as KnowledgeNoteFilter
    const normalizedSourceKind = String((query as { source_kind?: unknown }).source_kind || "").trim()
    return studyService.listKnowledgeNotes({
      ...(query.task_id ? { task_id: String(query.task_id) } : {}),
      ...(query.source_type ? { source_type: query.source_type } : {}),
      ...(normalizedSourceKind && normalizedSourceKind !== "all"
        ? { source_kind: normalizedSourceKind as KnowledgeNoteFilter["source_kind"] }
        : {}),
      ...(query.study_theme_id ? { study_theme_id: String(query.study_theme_id) } : {}),
      ...(query.tag ? { tag: String(query.tag) } : {}),
    })
  })

  app.post(`${apiPrefix}/knowledge/notes`, async (request) => {
    return studyService.createKnowledgeNote(request.body as KnowledgeNoteCreateRequest)
  })

  app.patch(`${apiPrefix}/knowledge/notes/:noteId`, async (request) => {
    const noteId = normalizeNoteId(request.params as KnowledgeNoteIdParams)
    return studyService.updateKnowledgeNote(noteId, request.body as KnowledgeNoteUpdateRequest)
  })

  app.delete(`${apiPrefix}/knowledge/notes/:noteId`, async (request, reply) => {
    const noteId = normalizeNoteId(request.params as KnowledgeNoteIdParams)
    await studyService.deleteKnowledgeNote(noteId)
    reply.code(204)
    return reply.send()
  })
}

function normalizeNoteId(params: KnowledgeNoteIdParams): string {
  const noteId = String(params.noteId || "").trim()
  if (!noteId) {
    throw AppError.badRequest("Knowledge note id is required", {
      code: "KNOWLEDGE_NOTE_ID_INVALID",
    })
  }
  return noteId
}
