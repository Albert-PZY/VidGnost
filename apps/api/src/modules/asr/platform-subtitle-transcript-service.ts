import type { TranscriptSegment } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import {
  PlatformSubtitleProbeService,
  type SubtitleProbePayload,
  expandSubtitleProbeEntries,
} from "../subtitles/platform-subtitle-probe-service.js"
import type { TaskRepository } from "../tasks/task-repository.js"
import {
  buildTranscriptText,
  parseCaptionXmlSegments,
  parseJsonSubtitleSegments,
  parseSrtSegments,
  parseVttSegments,
} from "./transcript-segment-normalizer.js"

interface ProbeTrackCandidate {
  ext: string
  kind: "automatic" | "manual"
  label: string
  language: string
  url: string
}

export interface PlatformSubtitleTranscriptionResult {
  chunks: Array<{
    durationSeconds: number
    index: number
    segments: TranscriptSegment[]
    startSeconds: number
  }>
  language: string
  segments: TranscriptSegment[]
  source: "yt-dlp"
  text: string
  track_ext: string
  track_kind: "automatic" | "manual"
  track_language: string
}

export class PlatformSubtitleTranscriptService {
  private readonly probeService: PlatformSubtitleProbeService

  constructor(
    config: AppConfig,
    private readonly taskRepository: TaskRepository,
  ) {
    this.probeService = new PlatformSubtitleProbeService(config, taskRepository)
  }

  async transcribeFromPlatformSubtitles(input: {
    onLog?: (message: string) => Promise<void> | void
    onReset?: () => Promise<void> | void
    onSegment?: (segment: TranscriptSegment) => Promise<void> | void
    preferredLanguage?: string | null
    signal?: AbortSignal
    sourceInput: string
    sourceType: string
    taskId: string
  }): Promise<PlatformSubtitleTranscriptionResult | null> {
    const sourceType = String(input.sourceType || "").trim().toLowerCase()
    if (sourceType !== "youtube" && sourceType !== "bilibili") {
      return null
    }

    const sourceInput = String(input.sourceInput || "").trim()
    if (!sourceInput) {
      return null
    }

    const probe = await this.probeService.resolveProbe({
      onLog: input.onLog,
      signal: input.signal,
      sourceInput,
      taskId: input.taskId,
    })
    if (!probe.payload) {
      return null
    }

    const selectedTrack = selectBestTrack(probe.payload, input.preferredLanguage)
    if (!selectedTrack) {
      await input.onLog?.("yt-dlp 未发现可用平台字幕，已回退 ASR 转写")
      return null
    }

    await input.onLog?.(
      `yt-dlp 已选中平台字幕轨: ${selectedTrack.kind === "manual" ? "原始字幕" : "自动字幕"} / ${selectedTrack.language} / ${selectedTrack.ext}`,
    )

    const rawSubtitle = await this.downloadSubtitle(selectedTrack, input.signal)
    if (!rawSubtitle) {
      await input.onLog?.("平台字幕下载失败，已回退 ASR 转写")
      return null
    }

    const segments = parseSubtitleSegments(selectedTrack.ext, rawSubtitle)
    const text = buildTranscriptText(segments)
    if (!segments.length || !text) {
      await input.onLog?.(`平台字幕解析失败(ext=${selectedTrack.ext})，已回退 ASR 转写`)
      return null
    }

    const rawArtifactPath = `C/platform-subtitles/${selectedTrack.kind}-${sanitizeSegment(selectedTrack.language)}.${sanitizeSegment(selectedTrack.ext)}`
    await Promise.all([
      this.taskRepository.writeTaskArtifactText(input.taskId, rawArtifactPath, rawSubtitle),
      this.taskRepository.writeTaskArtifactText(
        input.taskId,
        "C/platform-subtitles/selected-track.json",
        JSON.stringify({
          ext: selectedTrack.ext,
          kind: selectedTrack.kind,
          label: selectedTrack.label,
          language: selectedTrack.language,
          source: "yt-dlp",
          url: selectedTrack.url,
        }, null, 2),
      ),
    ])

    await input.onReset?.()
    for (const segment of segments) {
      await input.onSegment?.(segment)
    }

    await input.onLog?.(`已通过 yt-dlp 平台字幕生成转写，共 ${segments.length} 个片段`)

    return {
      chunks: [buildSyntheticChunk(segments)],
      language: selectedTrack.language,
      segments,
      source: "yt-dlp",
      text,
      track_ext: selectedTrack.ext,
      track_kind: selectedTrack.kind,
      track_language: selectedTrack.language,
    }
  }

  private async downloadSubtitle(candidate: ProbeTrackCandidate, signal?: AbortSignal): Promise<string | null> {
    try {
      const response = await fetch(candidate.url, {
        headers: {
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0",
        },
        signal,
      })
      if (!response.ok) {
        return null
      }
      return await response.text()
    } catch {
      return null
    }
  }
}

function selectBestTrack(
  probe: SubtitleProbePayload,
  preferredLanguage: string | null | undefined,
): ProbeTrackCandidate | null {
  const candidates = [
    ...normalizeProbeTrackCandidates(probe.subtitles, "manual"),
    ...normalizeProbeTrackCandidates(probe.automatic_captions, "automatic"),
  ].filter((candidate) => isSupportedSubtitleExt(candidate.ext))

  if (!candidates.length) {
    return null
  }

  const normalizedPreferredLanguage = normalizeLanguage(preferredLanguage)
  return [...candidates].sort((left, right) =>
    compareCandidateRank(left, right, normalizedPreferredLanguage),
  )[0] || null
}

function normalizeProbeTrackCandidates(
  payload: SubtitleProbePayload["automatic_captions"] | SubtitleProbePayload["subtitles"] | undefined,
  kind: ProbeTrackCandidate["kind"],
): ProbeTrackCandidate[] {
  return expandSubtitleProbeEntries(payload)
    .map((entry) => ({
      ext: sanitizeSegment(entry.ext || ""),
      kind,
      label: String(entry.name || "").trim(),
      language: normalizeLanguage(entry.language),
      url: String(entry.url || "").trim(),
    }))
    .filter((entry) => Boolean(entry.language) && Boolean(entry.url))
}

function compareCandidateRank(
  left: ProbeTrackCandidate,
  right: ProbeTrackCandidate,
  preferredLanguage: string,
): number {
  const comparison =
    compareRank(rankLanguage(left.language, preferredLanguage), rankLanguage(right.language, preferredLanguage)) ||
    compareRank(rankKind(left.kind), rankKind(right.kind)) ||
    compareRank(rankExtension(left.ext), rankExtension(right.ext))
  if (comparison !== 0) {
    return comparison
  }
  return left.language.localeCompare(right.language)
}

function compareRank(left: number, right: number): number {
  return left - right
}

function rankLanguage(language: string, preferredLanguage: string): number {
  if (!preferredLanguage) {
    return 0
  }
  if (language === preferredLanguage) {
    return 0
  }
  if (baseLanguage(language) === baseLanguage(preferredLanguage)) {
    return 1
  }
  return 2
}

function rankKind(kind: ProbeTrackCandidate["kind"]): number {
  return kind === "manual" ? 0 : 1
}

function rankExtension(ext: string): number {
  switch (sanitizeSegment(ext)) {
    case "vtt":
      return 0
    case "srt":
      return 1
    case "json3":
      return 2
    case "json":
      return 3
    case "srv3":
      return 4
    case "srv2":
      return 5
    case "srv1":
      return 6
    case "ttml":
    case "xml":
      return 7
    default:
      return 99
  }
}

function isSupportedSubtitleExt(ext: string): boolean {
  return rankExtension(ext) < 99
}

function parseSubtitleSegments(ext: string, rawSubtitle: string): TranscriptSegment[] {
  const normalizedExt = sanitizeSegment(ext)
  if (normalizedExt === "vtt") {
    return parseVttSegments(rawSubtitle)
  }
  if (normalizedExt === "srt") {
    return parseSrtSegments(rawSubtitle)
  }
  if (normalizedExt === "json3" || normalizedExt === "json") {
    return parseJsonSubtitleSegments(rawSubtitle)
  }
  if (normalizedExt === "srv1" || normalizedExt === "srv2" || normalizedExt === "srv3" || normalizedExt === "ttml" || normalizedExt === "xml") {
    return parseCaptionXmlSegments(rawSubtitle)
  }

  const content = String(rawSubtitle || "").trim()
  if (content.startsWith("{")) {
    return parseJsonSubtitleSegments(content)
  }
  if (/^\uFEFF?WEBVTT/u.test(content) || content.includes("-->")) {
    const vttSegments = parseVttSegments(content)
    return vttSegments.length > 0 ? vttSegments : parseSrtSegments(content)
  }
  if (content.includes("<text") || content.includes("<p ") || content.includes("<transcript") || content.includes("<tt")) {
    return parseCaptionXmlSegments(content)
  }
  return parseSrtSegments(content)
}

function buildSyntheticChunk(segments: TranscriptSegment[]) {
  const durationSeconds = Math.max(0, ...segments.map((segment) => Number(segment.end) || 0))
  return {
    durationSeconds,
    index: 0,
    segments,
    startSeconds: 0,
  }
}

function baseLanguage(value: string): string {
  return normalizeLanguage(value).split("-")[0] || ""
}

function normalizeLanguage(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function sanitizeSegment(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "")
}
