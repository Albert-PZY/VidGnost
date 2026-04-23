import { randomUUID } from "node:crypto"

import type {
  KnowledgeLibraryResponse,
  KnowledgeNote,
  KnowledgeNoteCreateRequest,
  KnowledgeNoteFilter,
  KnowledgeNoteUpdateRequest,
} from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { AppError } from "../../core/errors.js"
import type { StoredTaskRecord } from "../tasks/task-repository.js"
import { normalizeSourceType } from "../tasks/task-support.js"
import { SqliteStudyRepository } from "./sqlite-study-repository.js"

export class KnowledgeNoteRepository {
  constructor(
    _config: AppConfig,
    private readonly sqliteStudyRepository: SqliteStudyRepository,
  ) {}

  async list(filter: KnowledgeNoteFilter): Promise<KnowledgeLibraryResponse> {
    const items = (await this.sqliteStudyRepository.listKnowledgeNotes(filter)).map(normalizeKnowledgeNote)
    const exportRecords = filter.task_id
      ? (await this.sqliteStudyRepository.readExportRecords(filter.task_id)).filter((record) => record.export_kind === "knowledge_notes")
      : []
    return {
      items,
      total: items.length,
      filters: filter,
      export_records: exportRecords,
    }
  }

  async create(input: {
    payload: KnowledgeNoteCreateRequest
    task: StoredTaskRecord
  }): Promise<KnowledgeNote> {
    const now = new Date().toISOString()
    const note: KnowledgeNote = {
      id: randomUUID(),
      task_id: input.payload.task_id,
      study_theme_id: input.payload.study_theme_id ?? null,
      source_type: normalizeSourceType(input.task.source_type),
      source_kind: input.payload.source_kind,
      title: input.payload.title,
      excerpt: input.payload.excerpt,
      note_markdown: input.payload.note_markdown ?? null,
      source_start_seconds: input.payload.source_start_seconds ?? null,
      source_end_seconds: input.payload.source_end_seconds ?? null,
      source_reference_id: input.payload.source_reference_id ?? null,
      source_reference_label: input.payload.source_reference_label ?? null,
      tags: [...input.payload.tags],
      created_at: now,
      updated_at: now,
    }
    await this.sqliteStudyRepository.createKnowledgeNote(note)
    return normalizeKnowledgeNote(note)
  }

  async update(noteId: string, payload: KnowledgeNoteUpdateRequest): Promise<KnowledgeNote> {
    const existing = await this.require(noteId)
    const updated: KnowledgeNote = {
      ...existing,
      ...(payload.study_theme_id !== undefined ? { study_theme_id: payload.study_theme_id } : {}),
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.excerpt !== undefined ? { excerpt: payload.excerpt } : {}),
      ...(payload.note_markdown !== undefined ? { note_markdown: payload.note_markdown } : {}),
      ...(payload.source_start_seconds !== undefined ? { source_start_seconds: payload.source_start_seconds } : {}),
      ...(payload.source_end_seconds !== undefined ? { source_end_seconds: payload.source_end_seconds } : {}),
      ...(payload.source_reference_id !== undefined ? { source_reference_id: payload.source_reference_id } : {}),
      ...(payload.source_reference_label !== undefined ? { source_reference_label: payload.source_reference_label } : {}),
      ...(payload.tags !== undefined ? { tags: [...payload.tags] } : {}),
      updated_at: new Date().toISOString(),
    }
    await this.sqliteStudyRepository.updateKnowledgeNote(updated)
    return normalizeKnowledgeNote(updated)
  }

  async delete(noteId: string): Promise<void> {
    const removed = await this.sqliteStudyRepository.deleteKnowledgeNote(noteId)
    if (!removed) {
      throw AppError.notFound("Knowledge note not found", {
        code: "KNOWLEDGE_NOTE_NOT_FOUND",
      })
    }
  }

  async require(noteId: string): Promise<KnowledgeNote> {
    const note = await this.sqliteStudyRepository.readKnowledgeNote(noteId)
    if (!note) {
      throw AppError.notFound("Knowledge note not found", {
        code: "KNOWLEDGE_NOTE_NOT_FOUND",
      })
    }
    return normalizeKnowledgeNote(note)
  }
}

function normalizeKnowledgeNote(note: KnowledgeNote): KnowledgeNote {
  return {
    ...note,
    source_start_seconds: note.source_start_seconds ?? null,
    source_end_seconds: note.source_end_seconds ?? null,
    source_reference_id: note.source_reference_id ?? null,
    source_reference_label: note.source_reference_label ?? null,
  }
}
