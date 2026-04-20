import type { LLMConfigResponse, SubtitleTrack, TranscriptSegment, TranslationRecord } from "@vidgnost/contracts"

import { LlmServiceReadinessProbe, isLoopbackUrl } from "../llm/loopback-readiness.js"
import type { LlmConfigRepository } from "../llm/llm-config-repository.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { StoredTaskRecord, TaskRepository } from "../tasks/task-repository.js"
import { parseTranscriptSegments } from "../tasks/task-support.js"
import type { SubtitleTrackBundle } from "./study-workspace-types.js"

interface TranslationDecisionInput {
  preferredTargetLanguage: string | null
  subtitleTracks: SubtitleTrackBundle
  task: StoredTaskRecord
  updatedAt: string
}

interface TranslationDecisionResult {
  preferred_track_id: string | null
  subtitle_tracks: SubtitleTrack[]
  translation_records: TranslationRecord[]
}

interface TranslationDecisionDependencies {
  llmClient?: Pick<OpenAiCompatibleClient, "generateText" | "listModels"> | null
  llmConfigRepository?: LlmConfigRepository | null
}

export class TranslationDecisionService {
  private readonly llmClient: Pick<OpenAiCompatibleClient, "generateText" | "listModels"> | null
  private readonly llmConfigRepository: LlmConfigRepository | null
  private readonly readinessProbe: LlmServiceReadinessProbe

  constructor(
    private readonly taskRepository: TaskRepository,
    dependencies: TranslationDecisionDependencies = {},
  ) {
    this.llmClient = dependencies.llmClient ?? null
    this.llmConfigRepository = dependencies.llmConfigRepository ?? null
    this.readinessProbe = new LlmServiceReadinessProbe(this.llmClient)
  }

  async resolve(input: TranslationDecisionInput): Promise<TranslationDecisionResult> {
    const taskId = String(input.task.id || "")
    const preferredTargetLanguage = normalizeLanguage(input.preferredTargetLanguage)
    const existingTracks = [...input.subtitleTracks.tracks]

    if (!preferredTargetLanguage) {
      return {
        preferred_track_id: input.subtitleTracks.default_track_id,
        subtitle_tracks: existingTracks,
        translation_records: [buildDisabledRecord(taskId, input.updatedAt)],
      }
    }

    const sourceTrack = existingTracks.find((track) => track.kind === "source" && track.availability === "available")
    if (sourceTrack && normalizeLanguage(sourceTrack.language) === preferredTargetLanguage) {
      return {
        preferred_track_id: sourceTrack.track_id,
        subtitle_tracks: existingTracks,
        translation_records: [buildOriginalRecord(taskId, input.updatedAt, sourceTrack)],
      }
    }

    const platformTranslationTrack = existingTracks.find((track) =>
      track.kind === "platform_translation" && normalizeLanguage(track.language) === preferredTargetLanguage,
    )

    if (platformTranslationTrack) {
      return {
        preferred_track_id: platformTranslationTrack.track_id,
        subtitle_tracks: existingTracks,
        translation_records: [buildPlatformRecord(taskId, input.updatedAt, platformTranslationTrack)],
      }
    }

    const cachedTrack = existingTracks.find((track) =>
      track.kind === "llm_translation" && normalizeLanguage(track.language) === preferredTargetLanguage,
    )

    if (cachedTrack) {
      return {
        preferred_track_id: cachedTrack.track_id,
        subtitle_tracks: existingTracks,
        translation_records: [buildLlmGeneratedRecord(taskId, input.updatedAt, cachedTrack)],
      }
    }

    const llmConfig = await this.resolveLlmTranslationConfig()
    if (!llmConfig) {
      return {
        preferred_track_id: input.subtitleTracks.default_track_id,
        subtitle_tracks: existingTracks,
        translation_records: [buildDisabledRecord(taskId, input.updatedAt, preferredTargetLanguage)],
      }
    }

    try {
      const llmTrack = await this.createLlmTranslationTrack(input.task, preferredTargetLanguage, input.updatedAt, llmConfig)
      return {
        preferred_track_id: llmTrack.track_id,
        subtitle_tracks: [...existingTracks, llmTrack],
        translation_records: [buildLlmGeneratedRecord(taskId, input.updatedAt, llmTrack)],
      }
    } catch {
      return {
        preferred_track_id: input.subtitleTracks.default_track_id,
        subtitle_tracks: existingTracks,
        translation_records: [buildFailedRecord(taskId, input.updatedAt, preferredTargetLanguage)],
      }
    }
  }

  private async resolveLlmTranslationConfig(): Promise<LLMConfigResponse | null> {
    if (!this.llmClient?.generateText || !this.llmConfigRepository) {
      return null
    }

    const llmConfig = await this.llmConfigRepository.get()
    const configured = await this.llmConfigRepository.isUserConfigured()
    if (!configured) {
      return null
    }
    if (!llmConfig.base_url.trim() || !llmConfig.model.trim()) {
      return null
    }
    if (!llmConfig.api_key.trim() && !isLoopbackUrl(llmConfig.base_url)) {
      return null
    }
    const reachable = await this.readinessProbe.isReachable({
      apiKey: llmConfig.api_key,
      baseUrl: llmConfig.base_url,
      timeoutSeconds: 2,
    })
    if (!reachable) {
      return null
    }

    return llmConfig
  }

  private async createLlmTranslationTrack(
    task: StoredTaskRecord,
    preferredTargetLanguage: string,
    updatedAt: string,
    llmConfig: LLMConfigResponse,
  ): Promise<SubtitleTrack> {
    const taskId = String(task.id || "")
    const sourceSegments = buildTranslationSegments(task)
    const translatedSegments = await this.translateSegments({
      llmConfig,
      segments: sourceSegments,
      sourceLanguage: normalizeLanguage(task.language) || "zh",
      targetLanguage: preferredTargetLanguage,
    })
    const artifactPath = `D/study/translations/${preferredTargetLanguage}/subtitle-track.json`
    await this.taskRepository.writeTaskArtifactText(
      taskId,
      artifactPath,
      JSON.stringify({
        generated_at: updatedAt,
        source_language: normalizeLanguage(task.language),
        target_language: preferredTargetLanguage,
        segments: translatedSegments,
        task_id: taskId,
      }, null, 2),
    )

    return {
      task_id: taskId,
      track_id: `track-llm-translation-${preferredTargetLanguage}`,
      label: `LLM 翻译轨 (${preferredTargetLanguage})`,
      language: preferredTargetLanguage,
      kind: "llm_translation",
      availability: "generated",
      is_default: false,
      artifact_path: artifactPath,
      source_url: null,
      created_at: updatedAt,
      updated_at: updatedAt,
    }
  }

  private async translateSegments(input: {
    llmConfig: LLMConfigResponse
    segments: TranscriptSegment[]
    sourceLanguage: string
    targetLanguage: string
  }): Promise<Array<TranscriptSegment & { source_text: string; text: string }>> {
    if (!this.llmClient?.generateText) {
      throw new Error("LLM client is unavailable")
    }

    const translatedSegments: Array<TranscriptSegment & { source_text: string; text: string }> = []
    for (const chunk of chunkSegments(input.segments, 20)) {
      const response = await this.llmClient.generateText({
        apiKey: input.llmConfig.api_key,
        baseUrl: input.llmConfig.base_url,
        model: input.llmConfig.model,
        timeoutSeconds: 120,
        systemPrompt: "You translate subtitle text. Return strict JSON only.",
        userPrompt: buildTranslationPrompt({
          sourceLanguage: input.sourceLanguage,
          targetLanguage: input.targetLanguage,
          segments: chunk,
        }),
      })
      const translations = parseTranslationPayload(response.content, chunk)
      translatedSegments.push(...translations)
    }

    return translatedSegments
  }
}

function buildDisabledRecord(taskId: string, updatedAt: string, targetLanguage?: string | null): TranslationRecord {
  return {
    id: `translation-${taskId}-disabled`,
    task_id: taskId,
    source: "disabled",
    status: "disabled",
    target: targetLanguage
      ? {
          language: targetLanguage,
          label: targetLanguage,
        }
      : null,
    subtitle_track_id: null,
    artifact_path: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

function buildOriginalRecord(taskId: string, updatedAt: string, track: SubtitleTrack): TranslationRecord {
  return {
    id: `translation-${taskId}-original-${track.language}`,
    task_id: taskId,
    source: "original",
    status: "ready",
    target: {
      language: normalizeLanguage(track.language) || "zh",
      label: track.label,
    },
    subtitle_track_id: track.track_id,
    artifact_path: track.artifact_path,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

function buildPlatformRecord(taskId: string, updatedAt: string, track: SubtitleTrack): TranslationRecord {
  return {
    id: `translation-${taskId}-platform-${track.language}`,
    task_id: taskId,
    source: "platform_track",
    status: "ready",
    target: {
      language: normalizeLanguage(track.language) || "zh",
      label: track.label,
    },
    subtitle_track_id: track.track_id,
    artifact_path: track.artifact_path,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

function buildLlmGeneratedRecord(taskId: string, updatedAt: string, track: SubtitleTrack): TranslationRecord {
  return {
    id: `translation-${taskId}-llm-${track.language}`,
    task_id: taskId,
    source: "llm_generated",
    status: "ready",
    target: {
      language: normalizeLanguage(track.language) || "zh",
      label: track.label,
    },
    subtitle_track_id: track.track_id,
    artifact_path: track.artifact_path,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

function buildFailedRecord(taskId: string, updatedAt: string, targetLanguage: string): TranslationRecord {
  return {
    id: `translation-${taskId}-llm-${targetLanguage}-failed`,
    task_id: taskId,
    source: "llm_generated",
    status: "failed",
    target: {
      language: targetLanguage,
      label: targetLanguage,
    },
    subtitle_track_id: null,
    artifact_path: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

function buildTranslationSegments(task: StoredTaskRecord): TranscriptSegment[] {
  const parsedSegments = parseTranscriptSegments(task.transcript_segments_json)
  if (parsedSegments.length > 0) {
    return parsedSegments
  }

  const transcriptText = String(task.transcript_text || "").trim()
  if (!transcriptText) {
    throw new Error("Task transcript is empty")
  }

  return [
    {
      start: 0,
      end: 0,
      text: transcriptText,
    },
  ]
}

function chunkSegments(segments: TranscriptSegment[], size: number): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = []
  for (let index = 0; index < segments.length; index += size) {
    chunks.push(segments.slice(index, index + size))
  }
  return chunks
}

function buildTranslationPrompt(input: {
  sourceLanguage: string
  targetLanguage: string
  segments: TranscriptSegment[]
}): string {
  return [
    `Translate each subtitle line from ${input.sourceLanguage} to ${input.targetLanguage}.`,
    "Return a JSON array only.",
    "Each item must contain id and translated_text.",
    "Preserve the input order and do not omit items.",
    `SEGMENTS_JSON: ${JSON.stringify(input.segments.map((segment, index) => ({ id: String(index), text: segment.text })))}`
  ].join("\n")
}

function parseTranslationPayload(
  raw: string,
  sourceSegments: TranscriptSegment[],
): Array<TranscriptSegment & { source_text: string; text: string }> {
  const jsonPayload = extractJsonArray(raw)
  const translatedItems = JSON.parse(jsonPayload) as Array<{ id?: unknown; translated_text?: unknown }>
  if (!Array.isArray(translatedItems) || translatedItems.length !== sourceSegments.length) {
    throw new Error("Translated segment count mismatch")
  }

  return sourceSegments.map((segment, index) => {
    const item = translatedItems[index] || {}
    const translatedText = String(item.translated_text || "").trim()
    if (!translatedText) {
      throw new Error("Translated segment is empty")
    }
    return {
      ...segment,
      source_text: segment.text,
      text: translatedText,
    }
  })
}

function extractJsonArray(raw: string): string {
  const trimmed = String(raw || "").trim()
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeBlockMatch?.[1]) {
    return codeBlockMatch[1].trim()
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrayMatch?.[0]) {
    return arrayMatch[0]
  }

  return trimmed
}

function normalizeLanguage(value: unknown): string | null {
  const candidate = String(value || "").trim().toLowerCase()
  return candidate || null
}
