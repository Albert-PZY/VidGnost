import type { AppConfig } from "../../core/config.js"
import { runCommand } from "../../core/process.js"
import { resolveYtDlpExecutable } from "../media/media-pipeline-service.js"
import type { TaskRepository } from "../tasks/task-repository.js"

export const SUBTITLE_PROBE_ARTIFACT_PATH = "D/study/subtitle-probe.json"

export interface SubtitleProbeEntry {
  ext?: string
  name?: string
  url?: string
}

export interface SubtitleProbePayload {
  automatic_captions: Record<string, SubtitleProbeEntry[]>
  subtitles: Record<string, SubtitleProbeEntry[]>
}

export interface ResolvedSubtitleProbe {
  payload: SubtitleProbePayload | null
  status: "available" | "failed" | "missing"
}

interface PlatformSubtitleProbeDependencies {
  resolveYtDlpExecutable?: typeof resolveYtDlpExecutable
  runCommand?: typeof runCommand
}

export class PlatformSubtitleProbeService {
  private readonly resolveYtDlpExecutable: typeof resolveYtDlpExecutable
  private readonly runCommand: typeof runCommand

  constructor(
    private readonly config: AppConfig,
    private readonly taskRepository: TaskRepository,
    dependencies: PlatformSubtitleProbeDependencies = {},
  ) {
    this.resolveYtDlpExecutable = dependencies.resolveYtDlpExecutable ?? resolveYtDlpExecutable
    this.runCommand = dependencies.runCommand ?? runCommand
  }

  async resolveProbe(input: {
    onLog?: (message: string) => Promise<void> | void
    signal?: AbortSignal
    sourceInput: string
    taskId: string
  }): Promise<ResolvedSubtitleProbe> {
    const cached = await this.taskRepository.readTaskArtifactText(input.taskId, SUBTITLE_PROBE_ARTIFACT_PATH)
    if (cached) {
      try {
        const payload = normalizeProbePayload(JSON.parse(cached) as SubtitleProbePayload)
        return {
          payload,
          status: resolveProbeStatus(payload),
        }
      } catch {
        await input.onLog?.("已忽略损坏的 subtitle-probe 缓存，准备重新探测平台字幕")
      }
    }

    const sourceInput = String(input.sourceInput || "").trim()
    if (!sourceInput) {
      return {
        payload: null,
        status: "failed",
      }
    }

    const ytdlpPath = await this.resolveYtDlpExecutable(this.config, input.signal)
    if (!ytdlpPath) {
      await input.onLog?.("未找到可用 yt-dlp，跳过平台字幕，直接回退 ASR 转写")
      return {
        payload: null,
        status: "failed",
      }
    }

    try {
      const result = await this.runCommand({
        command: ytdlpPath,
        args: ["--dump-single-json", "--skip-download", "--no-warnings", "--no-playlist", sourceInput],
        signal: input.signal,
      })
      const payload = normalizeProbePayload(JSON.parse(result.stdout) as SubtitleProbePayload)
      await this.taskRepository.writeTaskArtifactText(
        input.taskId,
        SUBTITLE_PROBE_ARTIFACT_PATH,
        JSON.stringify(payload, null, 2),
      )
      return {
        payload,
        status: resolveProbeStatus(payload),
      }
    } catch (error) {
      await input.onLog?.(`yt-dlp 平台字幕探测失败，已回退 ASR 转写: ${toErrorMessage(error)}`)
      return {
        payload: null,
        status: "failed",
      }
    }
  }
}

export function expandSubtitleProbeEntries(
  payload: Record<string, SubtitleProbeEntry[]> | undefined,
): Array<SubtitleProbeEntry & { language: string }> {
  return Object.entries(payload || {})
    .flatMap(([language, entries]) =>
      (entries || []).map((entry) => ({
        ...entry,
        language: normalizeLanguage(language),
      })),
    )
    .filter((entry) => Boolean(entry.language))
}

function normalizeProbePayload(payload: SubtitleProbePayload | null | undefined): SubtitleProbePayload {
  return {
    automatic_captions: normalizeProbeTrackMap(payload?.automatic_captions),
    subtitles: normalizeProbeTrackMap(payload?.subtitles),
  }
}

function normalizeProbeTrackMap(
  payload: Record<string, SubtitleProbeEntry[]> | undefined,
): Record<string, SubtitleProbeEntry[]> {
  const normalized: Record<string, SubtitleProbeEntry[]> = {}
  for (const [language, entries] of Object.entries(payload || {})) {
    const normalizedLanguage = normalizeLanguage(language)
    if (!normalizedLanguage) {
      continue
    }
    normalized[normalizedLanguage] = (entries || [])
      .filter((entry): entry is SubtitleProbeEntry => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        ...(entry.ext !== undefined ? { ext: String(entry.ext || "").trim() } : {}),
        ...(entry.name !== undefined ? { name: String(entry.name || "").trim() } : {}),
        ...(entry.url !== undefined ? { url: String(entry.url || "").trim() } : {}),
      }))
      .filter((entry) => Boolean(entry.ext) || Boolean(entry.name) || Boolean(entry.url))
  }
  return normalized
}

function resolveProbeStatus(payload: SubtitleProbePayload): "available" | "missing" {
  return hasProbeTracks(payload) ? "available" : "missing"
}

function hasProbeTracks(payload: SubtitleProbePayload): boolean {
  return expandSubtitleProbeEntries(payload.subtitles).length > 0 || expandSubtitleProbeEntries(payload.automatic_captions).length > 0
}

function normalizeLanguage(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "unknown error"
}
