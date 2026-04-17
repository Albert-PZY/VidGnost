import type { TranscriptSegment, WorkflowType } from "@vidgnost/contracts"

import type { LlmConfigRepository } from "../llm/llm-config-repository.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { PromptTemplateRepository } from "../prompts/prompt-template-repository.js"
import {
  FallbackArtifactService,
  type GeneratedArtifactState,
  type SummaryArtifactManifest,
} from "./fallback-artifact-service.js"
import { TranscriptCorrectionService, type TranscriptCorrectionPreviewEvent } from "./transcript-correction-service.js"

export interface SummaryArtifacts {
  artifactManifestJson: string
  correctedSegments: TranscriptSegment[]
  correctedText: string
  correctionFullText: string
  correctionIndexJson: string
  correctionRewriteText: string
  correctionStrictSegmentsJson: string | null
  fallbackArtifactChannels: string[]
  fusionPromptMarkdown: string
  mindmapMarkdown: string
  notesMarkdown: string
  summaryMarkdown: string
}

export class SummaryService {
  constructor(
    private readonly llmConfigRepository: LlmConfigRepository,
    private readonly promptTemplateRepository: PromptTemplateRepository,
    private readonly llmClient: OpenAiCompatibleClient,
  ) {}

  async buildArtifacts(input: {
    onCorrectionPreviewEvent?: (event: TranscriptCorrectionPreviewEvent) => Promise<void> | void
    taskId: string
    taskTitle: string
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
    workflow: WorkflowType
  }): Promise<SummaryArtifacts> {
    const llmConfig = await this.llmConfigRepository.get()
    const llmEnabled = await this.isLlmGenerationEnabled()
    const promptBundle = await this.promptTemplateRepository.getBundle()

    const selectedCorrectionPrompt =
      promptBundle.templates.find((item) => item.id === promptBundle.selection.correction)?.content || ""
    const selectedNotesPrompt =
      promptBundle.templates.find((item) => item.id === promptBundle.selection.notes)?.content || ""
    const selectedMindmapPrompt =
      promptBundle.templates.find((item) => item.id === promptBundle.selection.mindmap)?.content || ""

    const transcriptCorrectionService = new TranscriptCorrectionService(this.llmClient)
    const fallbackArtifactService = new FallbackArtifactService()
    const correctionResult = await transcriptCorrectionService.apply({
      transcriptSegments: input.transcriptSegments,
      transcriptText: input.transcriptText,
      promptTemplate: selectedCorrectionPrompt,
      correctionMode: llmConfig.correction_mode,
      correctionBatchSize: llmConfig.correction_batch_size,
      correctionOverlap: llmConfig.correction_overlap,
      apiKey: llmConfig.api_key,
      baseUrl: llmConfig.base_url,
      model: llmConfig.model,
      systemPrompt: "你是一名严格的中文转写纠错助手。",
      llmEnabled,
      onPreviewEvent: input.onCorrectionPreviewEvent,
    })
    const correctedSegments = correctionResult.correctedSegments
    const correctedText = correctionResult.correctedText

    const notesPrompt = renderPrompt(selectedNotesPrompt, {
      query: "",
      context: correctedText,
      text: correctedText,
    })
    const notesArtifact = await this.generateArtifact({
      fallbackArtifactService,
      fallbackFactory: (fallbackReason) =>
        fallbackArtifactService.createFallbackNotes({
          fallbackReason,
          taskTitle: input.taskTitle,
          transcriptText: correctedText,
          workflow: input.workflow,
        }),
      llmEnabled,
      request: {
        apiKey: llmConfig.api_key,
        baseUrl: llmConfig.base_url,
        model: llmConfig.model,
        timeoutSeconds: 240,
        userPrompt: notesPrompt,
      },
    })

    const mindmapPrompt = renderPrompt(selectedMindmapPrompt, {
      query: "",
      context: correctedText,
      text: correctedText,
    })
    const mindmapArtifact = await this.generateArtifact({
      fallbackArtifactService,
      fallbackFactory: (fallbackReason) =>
        fallbackArtifactService.createFallbackMindmap({
          fallbackReason,
          taskTitle: input.taskTitle,
          transcriptText: correctedText,
        }),
      llmEnabled,
      request: {
        apiKey: llmConfig.api_key,
        baseUrl: llmConfig.base_url,
        model: llmConfig.model,
        timeoutSeconds: 180,
        userPrompt: mindmapPrompt,
      },
    })
    const summaryArtifact = fallbackArtifactService.createSummaryArtifact({
      taskTitle: input.taskTitle,
      correctedText,
      notesArtifact,
    })
    const artifactManifest: SummaryArtifactManifest = {
      notes: sanitizeGeneratedArtifact(notesArtifact),
      mindmap: sanitizeGeneratedArtifact(mindmapArtifact),
      summary: sanitizeGeneratedArtifact(summaryArtifact),
    }

    return {
      artifactManifestJson: fallbackArtifactService.buildManifest(artifactManifest),
      correctedSegments,
      correctedText,
      correctionFullText: correctionResult.fullText,
      correctionIndexJson: correctionResult.indexJson,
      correctionRewriteText: correctionResult.rewriteText,
      correctionStrictSegmentsJson: correctionResult.strictSegmentsJson,
      fallbackArtifactChannels: fallbackArtifactService.listFallbackChannels(artifactManifest),
      fusionPromptMarkdown: [
        "# Correction Prompt",
        "",
        selectedCorrectionPrompt || "(fallback heuristic)",
        "",
        "# Notes Prompt",
        "",
        selectedNotesPrompt || "(fallback heuristic)",
        "",
        "# Mindmap Prompt",
        "",
        selectedMindmapPrompt || "(fallback heuristic)",
      ].join("\n"),
      mindmapMarkdown: mindmapArtifact.content,
      notesMarkdown: notesArtifact.content,
      summaryMarkdown: summaryArtifact.content,
    }
  }

  async isLlmGenerationEnabled(): Promise<boolean> {
    const llmConfig = await this.llmConfigRepository.get()
    const configured = await this.llmConfigRepository.isUserConfigured()
    if (!configured && !isLoopbackUrl(llmConfig.base_url)) {
      return false
    }
    if (!llmConfig.base_url.trim() || !llmConfig.model.trim()) {
      return false
    }
    if (!llmConfig.api_key.trim() && !isLoopbackUrl(llmConfig.base_url)) {
      return false
    }
    return true
  }

  private async generateArtifact(input: {
    fallbackArtifactService: FallbackArtifactService
    fallbackFactory: (fallbackReason: string) => GeneratedArtifactState
    llmEnabled: boolean
    request: {
      apiKey: string
      baseUrl: string
      model: string
      timeoutSeconds?: number
      userPrompt: string
    }
  }): Promise<GeneratedArtifactState> {
    const generation = await this.tryGenerateText(input.request, input.llmEnabled)
    if (generation.content) {
      return input.fallbackArtifactService.createLlmArtifact(generation.content)
    }
    return input.fallbackFactory(generation.fallbackReason)
  }

  private async tryGenerateText(
    input: {
      apiKey: string
      baseUrl: string
      model: string
      systemPrompt?: string
      timeoutSeconds?: number
      userPrompt: string
    },
    llmEnabled: boolean,
  ): Promise<{ content: string | null; fallbackReason: string }> {
    if (!llmEnabled) {
      return {
        content: null,
        fallbackReason: "llm_disabled_or_unconfigured",
      }
    }
    if (!input.baseUrl.trim() || !input.model.trim()) {
      return {
        content: null,
        fallbackReason: "llm_config_incomplete",
      }
    }
    if (!input.apiKey.trim() && !isLoopbackUrl(input.baseUrl)) {
      return {
        content: null,
        fallbackReason: "llm_config_incomplete",
      }
    }
    try {
      const response = await this.llmClient.generateText(input)
      const content = response.content.trim()
      if (!content) {
        return {
          content: null,
          fallbackReason: "llm_empty_response",
        }
      }
      return {
        content,
        fallbackReason: "",
      }
    } catch {
      return {
        content: null,
        fallbackReason: "llm_generate_failed",
      }
    }
  }
}

function isLoopbackUrl(baseUrl: string): boolean {
  try {
    const target = new URL(baseUrl)
    return target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "::1"
  } catch {
    return false
  }
}

function renderPrompt(template: string, values: { context: string; query: string; text: string }): string {
  const base = String(template || "").trim()
  if (!base) {
    return values.text
  }
  let rendered = base
    .replaceAll("{text}", values.text)
    .replaceAll("{context}", values.context)
    .replaceAll("{query}", values.query)
  if (!rendered.includes(values.text)) {
    rendered = `${rendered}\n\n## 输入内容\n\n${values.text}`
  }
  return rendered
}

function sanitizeGeneratedArtifact(artifact: GeneratedArtifactState): GeneratedArtifactState {
  return {
    content: "",
    fallback_reason: artifact.fallback_reason,
    generated_by: artifact.generated_by,
  }
}
