import type { TranscriptSegment, WorkflowType } from "@vidgnost/contracts"

import type { LlmConfigRepository } from "../llm/llm-config-repository.js"
import type { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js"
import type { PromptTemplateRepository } from "../prompts/prompt-template-repository.js"

export interface SummaryArtifacts {
  correctedSegments: TranscriptSegment[]
  correctedText: string
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
    taskId: string
    taskTitle: string
    transcriptSegments: TranscriptSegment[]
    transcriptText: string
    workflow: WorkflowType
  }): Promise<SummaryArtifacts> {
    const llmConfig = await this.llmConfigRepository.get()
    const llmEnabled = await this.llmConfigRepository.isUserConfigured()
    const promptBundle = await this.promptTemplateRepository.getBundle()

    const selectedCorrectionPrompt =
      promptBundle.templates.find((item) => item.id === promptBundle.selection.correction)?.content || ""
    const selectedNotesPrompt =
      promptBundle.templates.find((item) => item.id === promptBundle.selection.notes)?.content || ""
    const selectedMindmapPrompt =
      promptBundle.templates.find((item) => item.id === promptBundle.selection.mindmap)?.content || ""

    const correctedSegments = applyHeuristicTranscriptCleanup(input.transcriptSegments)
    let correctedText = correctedSegments.map((item) => item.text).join("\n").trim()
    if (!correctedText) {
      correctedText = input.transcriptText.trim()
    }

    if (llmEnabled && llmConfig.correction_mode !== "off" && correctedText) {
      const correctionPrompt = renderPrompt(selectedCorrectionPrompt, {
        query: "",
        context: correctedText,
        text: correctedText,
      })
      const correctedByLlm = await this.tryGenerateText({
        apiKey: llmConfig.api_key,
        baseUrl: llmConfig.base_url,
        model: llmConfig.model,
        systemPrompt: "你是一名严格的中文转写纠错助手。",
        timeoutSeconds: 180,
        userPrompt: correctionPrompt,
      })
      if (correctedByLlm) {
        correctedText = correctedByLlm
      }
    }

    const notesPrompt = renderPrompt(selectedNotesPrompt, {
      query: "",
      context: correctedText,
      text: correctedText,
    })
    const notesMarkdown =
      (llmEnabled
        ? await this.tryGenerateText({
            apiKey: llmConfig.api_key,
            baseUrl: llmConfig.base_url,
            model: llmConfig.model,
            timeoutSeconds: 240,
            userPrompt: notesPrompt,
          })
        : null) || buildFallbackNotes(input.taskTitle, correctedText, input.workflow)

    const mindmapPrompt = renderPrompt(selectedMindmapPrompt, {
      query: "",
      context: correctedText,
      text: correctedText,
    })
    const mindmapMarkdown =
      (llmEnabled
        ? await this.tryGenerateText({
            apiKey: llmConfig.api_key,
            baseUrl: llmConfig.base_url,
            model: llmConfig.model,
            timeoutSeconds: 180,
            userPrompt: mindmapPrompt,
          })
        : null) || buildFallbackMindmap(input.taskTitle, correctedText)

    return {
      correctedSegments,
      correctedText,
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
      mindmapMarkdown,
      notesMarkdown,
      summaryMarkdown: buildSummaryMarkdown(input.taskTitle, correctedText, notesMarkdown),
    }
  }

  private async tryGenerateText(input: {
    apiKey: string
    baseUrl: string
    model: string
    systemPrompt?: string
    timeoutSeconds?: number
    userPrompt: string
  }): Promise<string | null> {
    if (!input.baseUrl.trim() || !input.model.trim()) {
      return null
    }
    try {
      const response = await this.llmClient.generateText(input)
      return response.content.trim() || null
    } catch {
      return null
    }
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

function applyHeuristicTranscriptCleanup(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.map((segment) => ({
    ...segment,
    text: normalizeChineseText(segment.text),
  }))
}

function normalizeChineseText(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。！？；：])/g, "$1")
    .replace(/([，。！？；：])(?=[^\s])/g, "$1 ")
    .replace(/ {2,}/g, " ")
    .trim()
}

function buildFallbackNotes(title: string, transcriptText: string, workflow: WorkflowType): string {
  const paragraphs = transcriptText
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const bullets = paragraphs.slice(0, 8).map((item) => `- ${truncate(item, 140)}`)
  const heading = workflow === "vqa" ? "问答准备摘要" : "笔记摘要"

  return [
    `# ${title || "任务笔记"}`,
    "",
    `## ${heading}`,
    "",
    ...(bullets.length > 0 ? bullets : ["- 当前没有足够的转写内容。"]),
    "",
    "## 原始转写摘录",
    "",
    "```text",
    truncate(transcriptText || "暂无转写内容。", 4000),
    "```",
  ].join("\n")
}

function buildFallbackMindmap(title: string, transcriptText: string): string {
  const paragraphs = transcriptText
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6)
  return [
    `# ${title || "任务导图"}`,
    "",
    "## 核心内容",
    ...paragraphs.map((item) => `### ${truncate(item, 60)}`),
  ].join("\n")
}

function buildSummaryMarkdown(title: string, correctedText: string, notesMarkdown: string): string {
  return [
    `# ${title || "任务摘要"}`,
    "",
    "## 摘要",
    "",
    truncate(
      notesMarkdown
        .replace(/^#.+$/gm, "")
        .trim() || correctedText,
      1200,
    ),
  ].join("\n")
}

function truncate(value: string, limit: number): string {
  const normalized = String(value || "").trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`
}
