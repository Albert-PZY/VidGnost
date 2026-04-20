import { spawn } from "node:child_process"

import type { AppConfig } from "../../core/config.js"
import type { StoredTaskRecord, TaskRepository } from "../tasks/task-repository.js"
import { normalizeSourceType } from "../tasks/task-support.js"
import type { SubtitleTrackBundle } from "./study-workspace-types.js"

interface SubtitleProbeEntry {
  ext?: string
  name?: string
  url?: string
}

interface SubtitleProbePayload {
  automatic_captions?: Record<string, SubtitleProbeEntry[]>
  subtitles?: Record<string, SubtitleProbeEntry[]>
}

interface ResolvedProbe {
  payload: SubtitleProbePayload | null
  status: "available" | "failed" | "missing"
}

export class SubtitleTrackService {
  constructor(
    private readonly config: AppConfig,
    private readonly taskRepository: TaskRepository,
  ) {}

  async buildTracks(task: StoredTaskRecord): Promise<SubtitleTrackBundle> {
    const taskId = String(task.id || "")
    const sourceType = normalizeSourceType(task.source_type)
    const language = normalizeLanguage(task.language)
    const now = normalizeTimestamp(task.updated_at || task.created_at)
    const whisperTrackId = "track-whisper-primary"

    const tracks = sourceType === "youtube" || sourceType === "bilibili"
      ? await this.buildRemoteTracks(taskId, sourceType, language, now)
      : buildLocalTracks(taskId, sourceType, language, now)

    const whisperTrack = {
      task_id: taskId,
      track_id: whisperTrackId,
      label: sourceType === "youtube" ? "YouTube Whisper 转写轨" : sourceType === "bilibili" ? "Bilibili Whisper 转写轨" : "Whisper 转写轨",
      language,
      kind: "whisper" as const,
      availability: "available" as const,
      is_default: false,
      artifact_path: "D/study/subtitle-tracks.json",
      source_url: null,
      created_at: now,
      updated_at: now,
    }

    const dedupedTracks = dedupeTracks([...tracks, whisperTrack]).map((track) => ({
      ...track,
      is_default: false,
    }))
    const defaultTrackId = dedupedTracks.find((track) => track.kind === "source" && track.availability === "available")?.track_id ?? whisperTrackId
    const normalizedTracks = dedupedTracks.map((track) => ({
      ...track,
      is_default: track.track_id === defaultTrackId,
    }))

    return {
      default_track_id: defaultTrackId,
      tracks: normalizedTracks,
    }
  }

  private async buildRemoteTracks(
    taskId: string,
    sourceType: "youtube" | "bilibili",
    language: string,
    now: string,
  ) {
    const platformLabel = sourceType === "youtube" ? "YouTube" : "Bilibili"
    const probe = await this.resolveProbe(taskId)
    const subtitles = normalizeTrackEntries(probe.payload?.subtitles)
    const automaticCaptions = normalizeTrackEntries(probe.payload?.automatic_captions)
    const sourceEntry =
      subtitles.find((entry) => normalizeLanguage(entry.language) === language) ??
      subtitles[0] ??
      automaticCaptions.find((entry) => normalizeLanguage(entry.language) === language) ??
      automaticCaptions[0]

    const sourceTrack = {
      task_id: taskId,
      track_id: `track-source-${normalizeLanguage(sourceEntry?.language || language)}`,
      label: `${platformLabel} 原始字幕轨`,
      language: normalizeLanguage(sourceEntry?.language || language),
      kind: "source" as const,
      availability: sourceEntry ? "available" as const : probe.status,
      is_default: false,
      artifact_path: sourceEntry ? "D/study/subtitle-probe.json" : null,
      source_url: sourceEntry?.url ?? null,
      created_at: now,
      updated_at: now,
    }

    const translationTracks = automaticCaptions
      .filter((entry) => normalizeLanguage(entry.language) !== sourceTrack.language)
      .map((entry) => ({
        task_id: taskId,
        track_id: `track-platform-translation-${normalizeLanguage(entry.language)}`,
        label: entry.name?.trim() || `${platformLabel} 自动翻译轨 (${normalizeLanguage(entry.language)})`,
        language: normalizeLanguage(entry.language),
        kind: "platform_translation" as const,
        availability: "available" as const,
        is_default: false,
        artifact_path: "D/study/subtitle-probe.json",
        source_url: entry.url ?? null,
        created_at: now,
        updated_at: now,
      }))

    return [sourceTrack, ...translationTracks]
  }

  private async resolveProbe(taskId: string): Promise<ResolvedProbe> {
    const cached = await this.readCachedProbe(taskId)
    if (cached) {
      const subtitles = normalizeTrackEntries(cached.subtitles)
      const automaticCaptions = normalizeTrackEntries(cached.automatic_captions)
      return {
        payload: cached,
        status: subtitles.length > 0 || automaticCaptions.length > 0 ? "available" : "missing",
      }
    }

    const task = await this.taskRepository.getStoredRecord(taskId)
    const sourceInput = String(task?.source_input || "").trim()
    if (!sourceInput) {
      return { payload: null, status: "failed" }
    }

    const probed = await this.runYtDlpProbe(sourceInput)
    if (!probed) {
      return { payload: null, status: "failed" }
    }
    await this.taskRepository.writeTaskArtifactText(taskId, "D/study/subtitle-probe.json", JSON.stringify(probed, null, 2))
    const subtitles = normalizeTrackEntries(probed.subtitles)
    const automaticCaptions = normalizeTrackEntries(probed.automatic_captions)
    return {
      payload: probed,
      status: subtitles.length > 0 || automaticCaptions.length > 0 ? "available" : "missing",
    }
  }

  private async readCachedProbe(taskId: string): Promise<SubtitleProbePayload | null> {
    const cached = await this.taskRepository.readTaskArtifactText(taskId, "D/study/subtitle-probe.json")
    if (!cached) {
      return null
    }
    try {
      return JSON.parse(cached) as SubtitleProbePayload
    } catch {
      return null
    }
  }

  private async runYtDlpProbe(sourceInput: string): Promise<SubtitleProbePayload | null> {
    const binary = this.config.ytdlpExecutable || "yt-dlp"
    return new Promise<SubtitleProbePayload | null>((resolve) => {
      const child = spawn(binary, ["--dump-single-json", "--skip-download", "--no-warnings", sourceInput], {
        stdio: ["ignore", "pipe", "pipe"],
      })
      const stdoutChunks: Buffer[] = []
      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      child.on("error", () => resolve(null))
      child.on("close", (code) => {
        if (code !== 0) {
          resolve(null)
          return
        }
        try {
          const parsed = JSON.parse(Buffer.concat(stdoutChunks).toString("utf8")) as SubtitleProbePayload
          resolve({
            automatic_captions: parsed.automatic_captions || {},
            subtitles: parsed.subtitles || {},
          })
        } catch {
          resolve(null)
        }
      })
    })
  }
}

function buildLocalTracks(taskId: string, sourceType: "local_file" | "local_path", language: string, now: string) {
  const sourceLabel = sourceType === "local_path" ? "本地路径原始字幕轨" : "本地文件原始字幕轨"
  return [
    {
      task_id: taskId,
      track_id: "track-source-primary",
      label: sourceLabel,
      language,
      kind: "source" as const,
      availability: "missing" as const,
      is_default: false,
      artifact_path: null,
      source_url: null,
      created_at: now,
      updated_at: now,
    },
  ]
}

function normalizeTrackEntries(payload: Record<string, SubtitleProbeEntry[]> | undefined) {
  return Object.entries(payload || {})
    .flatMap(([language, entries]) => (entries || []).map((entry) => ({
      ...entry,
      language,
    })))
    .filter((entry) => Boolean(entry.language))
}

function dedupeTracks<T extends { track_id: string }>(tracks: T[]): T[] {
  const seen = new Set<string>()
  return tracks.filter((track) => {
    if (seen.has(track.track_id)) {
      return false
    }
    seen.add(track.track_id)
    return true
  })
}

function normalizeLanguage(value: unknown): string {
  const candidate = String(value || "").trim().toLowerCase()
  return candidate || "zh"
}

function normalizeTimestamp(value: unknown): string {
  const parsed = Date.parse(String(value || "").trim())
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString()
}
