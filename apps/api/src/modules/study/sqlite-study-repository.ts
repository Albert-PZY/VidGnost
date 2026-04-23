import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import type {
  ExportRecord,
  KnowledgeNote,
  KnowledgeNoteFilter,
  StudyPack,
  StudyState,
  SubtitleTrack,
  TranslationRecord,
} from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { ensureDirectory } from "../../core/fs.js"

export class SqliteStudyRepository {
  private readonly dbPath: string
  private database: DatabaseSync | null = null

  constructor(private readonly config: AppConfig) {
    this.dbPath = path.join(config.storageDir, "study", "study.sqlite")
  }

  async readPack(taskId: string): Promise<StudyPack | null> {
    const row = (await this.getDatabase())
      .prepare("SELECT pack_json FROM study_packs WHERE task_id = ?")
      .get(taskId) as { pack_json?: string } | undefined
    return parseJson<StudyPack>(row?.pack_json)
  }

  async upsertPack(taskId: string, pack: StudyPack): Promise<void> {
    ;(await this.getDatabase())
      .prepare(`
        INSERT INTO study_packs (task_id, pack_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          pack_json = excluded.pack_json,
          updated_at = excluded.updated_at
      `)
      .run(taskId, JSON.stringify(pack), new Date().toISOString())
  }

  async readState(taskId: string): Promise<StudyState | null> {
    const row = (await this.getDatabase())
      .prepare("SELECT state_json FROM study_state WHERE task_id = ?")
      .get(taskId) as { state_json?: string } | undefined
    return parseJson<StudyState>(row?.state_json)
  }

  async upsertState(taskId: string, state: StudyState): Promise<void> {
    ;(await this.getDatabase())
      .prepare(`
        INSERT INTO study_state (task_id, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `)
      .run(taskId, JSON.stringify(state), new Date().toISOString())
  }

  async readSubtitleTracks(taskId: string): Promise<SubtitleTrack[]> {
    const row = (await this.getDatabase())
      .prepare("SELECT tracks_json FROM subtitle_tracks WHERE task_id = ?")
      .get(taskId) as { tracks_json?: string } | undefined
    return parseJsonArray<SubtitleTrack>(row?.tracks_json)
  }

  async upsertSubtitleTracks(taskId: string, tracks: SubtitleTrack[]): Promise<void> {
    ;(await this.getDatabase())
      .prepare(`
        INSERT INTO subtitle_tracks (task_id, tracks_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          tracks_json = excluded.tracks_json,
          updated_at = excluded.updated_at
      `)
      .run(taskId, JSON.stringify(tracks), new Date().toISOString())
  }

  async readTranslationRecords(taskId: string): Promise<TranslationRecord[]> {
    const row = (await this.getDatabase())
      .prepare("SELECT records_json FROM translation_records WHERE task_id = ?")
      .get(taskId) as { records_json?: string } | undefined
    return parseJsonArray<TranslationRecord>(row?.records_json)
  }

  async upsertTranslationRecords(taskId: string, records: TranslationRecord[]): Promise<void> {
    ;(await this.getDatabase())
      .prepare(`
        INSERT INTO translation_records (task_id, records_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          records_json = excluded.records_json,
          updated_at = excluded.updated_at
      `)
      .run(taskId, JSON.stringify(records), new Date().toISOString())
  }

  async readExportRecords(taskId: string): Promise<ExportRecord[]> {
    const row = (await this.getDatabase())
      .prepare("SELECT records_json FROM export_records WHERE task_id = ?")
      .get(taskId) as { records_json?: string } | undefined
    return parseJsonArray<ExportRecord>(row?.records_json)
  }

  async appendExportRecord(taskId: string, record: ExportRecord): Promise<ExportRecord[]> {
    const current = await this.readExportRecords(taskId)
    const next = [record, ...current]
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    await this.upsertExportRecords(taskId, next)
    return next
  }

  async upsertExportRecords(taskId: string, records: ExportRecord[]): Promise<void> {
    ;(await this.getDatabase())
      .prepare(`
        INSERT INTO export_records (task_id, records_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          records_json = excluded.records_json,
          updated_at = excluded.updated_at
      `)
      .run(taskId, JSON.stringify(records), new Date().toISOString())
  }

  async createKnowledgeNote(note: KnowledgeNote): Promise<void> {
    ;(await this.getDatabase())
      .prepare(`
        INSERT INTO knowledge_notes (note_id, task_id, note_json, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(note.id, note.task_id, JSON.stringify(note), note.updated_at)
  }

  async updateKnowledgeNote(note: KnowledgeNote): Promise<void> {
    ;(await this.getDatabase())
      .prepare(`
        UPDATE knowledge_notes
        SET note_json = ?, updated_at = ?
        WHERE note_id = ?
      `)
      .run(JSON.stringify(note), note.updated_at, note.id)
  }

  async readKnowledgeNote(noteId: string): Promise<KnowledgeNote | null> {
    const row = (await this.getDatabase())
      .prepare("SELECT note_json FROM knowledge_notes WHERE note_id = ?")
      .get(noteId) as { note_json?: string } | undefined
    return parseJson<KnowledgeNote>(row?.note_json)
  }

  async listKnowledgeNotes(filter: KnowledgeNoteFilter): Promise<KnowledgeNote[]> {
    const rows = (await this.getDatabase())
      .prepare("SELECT note_json FROM knowledge_notes ORDER BY updated_at DESC, note_id DESC")
      .all() as Array<{ note_json?: string }>

    return rows
      .map((row) => parseJson<KnowledgeNote>(row.note_json))
      .filter((note): note is KnowledgeNote => Boolean(note))
      .filter((note) => matchesKnowledgeFilter(note, filter))
  }

  async deleteKnowledgeNote(noteId: string): Promise<boolean> {
    const result = (await this.getDatabase())
      .prepare("DELETE FROM knowledge_notes WHERE note_id = ?")
      .run(noteId)
    return Number(result.changes || 0) > 0
  }

  async close(): Promise<void> {
    const database = this.database
    if (!database) {
      return
    }
    this.database = null
    database.close()
    await waitForSqliteHandleRelease()
  }

  private async getDatabase(): Promise<DatabaseSync> {
    if (this.database) {
      return this.database
    }
    await ensureDirectory(path.dirname(this.dbPath))
    this.database = new DatabaseSync(this.dbPath)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS study_packs (
        task_id TEXT PRIMARY KEY,
        pack_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS study_state (
        task_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_notes (
        note_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        note_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subtitle_tracks (
        task_id TEXT PRIMARY KEY,
        tracks_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS translation_records (
        task_id TEXT PRIMARY KEY,
        records_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS export_records (
        task_id TEXT PRIMARY KEY,
        records_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    return this.database
  }
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  const parsed = parseJson<unknown>(raw)
  return Array.isArray(parsed) ? (parsed as T[]) : []
}

function matchesKnowledgeFilter(note: KnowledgeNote, filter: KnowledgeNoteFilter): boolean {
  if (filter.task_id && note.task_id !== filter.task_id) {
    return false
  }
  if (filter.source_type && note.source_type !== filter.source_type) {
    return false
  }
  if (filter.source_kind && note.source_kind !== filter.source_kind) {
    return false
  }
  if (filter.study_theme_id && note.study_theme_id !== filter.study_theme_id) {
    return false
  }
  if (filter.tag && !note.tags.includes(filter.tag)) {
    return false
  }
  return true
}

async function waitForSqliteHandleRelease(): Promise<void> {
  if (process.platform !== "win32") {
    return
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 100)
  })
}
