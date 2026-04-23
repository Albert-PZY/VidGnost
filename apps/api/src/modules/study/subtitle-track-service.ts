import type { AppConfig } from "../../core/config.js"
import type { StoredTaskRecord, TaskRepository } from "../tasks/task-repository.js"
import { normalizeSourceType } from "../tasks/task-support.js"
import {
  PlatformSubtitleProbeService,
  type ResolvedSubtitleProbe,
  SUBTITLE_PROBE_ARTIFACT_PATH,
  expandSubtitleProbeEntries,
} from "../subtitles/platform-subtitle-probe-service.js"
import type { SubtitleTrackBundle } from "./study-workspace-types.js"

interface BuildSubtitleTracksOptions {
  probeMode?: "cached" | "materialize"
}

interface SubtitleTrackServiceDependencies {
  probeService?: Pick<PlatformSubtitleProbeService, "readCachedProbe" | "resolveProbe">
}

export class SubtitleTrackService {
  private readonly probeService: Pick<PlatformSubtitleProbeService, "readCachedProbe" | "resolveProbe">

  constructor(
    config: AppConfig,
    private readonly taskRepository: TaskRepository,
    dependencies: SubtitleTrackServiceDependencies = {},
  ) {
    this.probeService = dependencies.probeService ?? new PlatformSubtitleProbeService(config, taskRepository)
  }

  async buildTracks(task: StoredTaskRecord, options: BuildSubtitleTracksOptions = {}): Promise<SubtitleTrackBundle> {
    const taskId = String(task.id || "")
    const sourceType = normalizeSourceType(task.source_type)
    const language = normalizeLanguage(task.language)
    const now = normalizeTimestamp(task.updated_at || task.created_at)
    const whisperTrackId = "track-whisper-primary"
    const sourceInput = String(task.source_input || "").trim()
    const probeMode = options.probeMode === "cached" ? "cached" : "materialize"

    const tracks = sourceType === "youtube" || sourceType === "bilibili"
      ? await this.buildRemoteTracks(taskId, sourceInput, sourceType, language, now, probeMode)
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
    sourceInput: string,
    sourceType: "youtube" | "bilibili",
    language: string,
    now: string,
    probeMode: "cached" | "materialize",
  ) {
    const platformLabel = sourceType === "youtube" ? "YouTube" : "Bilibili"
    const probe = await this.resolveProbeForSource({
      probeMode,
      sourceInput,
      sourceType,
      taskId,
    })
    const subtitles = expandSubtitleProbeEntries(probe.payload?.subtitles)
    const automaticCaptions = expandSubtitleProbeEntries(probe.payload?.automatic_captions)
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
      artifact_path: sourceEntry ? SUBTITLE_PROBE_ARTIFACT_PATH : null,
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
        artifact_path: SUBTITLE_PROBE_ARTIFACT_PATH,
        source_url: entry.url ?? null,
        created_at: now,
        updated_at: now,
      }))

    return [sourceTrack, ...translationTracks]
  }

  private async resolveProbeForSource(input: {
    probeMode: "cached" | "materialize"
    sourceInput: string
    sourceType: "youtube" | "bilibili"
    taskId: string
  }): Promise<ResolvedSubtitleProbe> {
    if (input.probeMode === "cached" || input.sourceType === "bilibili") {
      return await this.probeService.readCachedProbe(input.taskId) ?? buildMissingProbe()
    }
    return this.probeService.resolveProbe({
      sourceInput: input.sourceInput,
      taskId: input.taskId,
    })
  }
}

function buildMissingProbe(): ResolvedSubtitleProbe {
  return {
    payload: null,
    status: "missing",
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
