import type { WorkflowType } from "@vidgnost/contracts"

export interface GeneratedArtifactState {
  content: string
  fallback_reason: string
  generated_by: "llm" | "fallback"
}

export interface SummaryArtifactManifest {
  mindmap: GeneratedArtifactState
  notes: GeneratedArtifactState
  summary: GeneratedArtifactState
}

export class FallbackArtifactService {
  createLlmArtifact(content: string): GeneratedArtifactState {
    return {
      content: String(content || "").trim(),
      generated_by: "llm",
      fallback_reason: "",
    }
  }

  createFallbackNotes(input: {
    fallbackReason: string
    taskTitle: string
    transcriptText: string
    workflow: WorkflowType
  }): GeneratedArtifactState {
    const paragraphs = input.transcriptText
      .split(/\n+/u)
      .map((item) => item.trim())
      .filter(Boolean)
    const bullets = paragraphs.slice(0, 8).map((item) => `- ${truncate(item, 140)}`)
    const heading = input.workflow === "vqa" ? "问答准备摘要" : "笔记摘要"

    return this.createFallbackArtifact(
      [
        `# ${input.taskTitle || "任务笔记"}`,
        "",
        `## ${heading}`,
        "",
        ...(bullets.length > 0 ? bullets : ["- 当前没有足够的转写内容。"]),
        "",
        "## 原始转写摘录",
        "",
        "```text",
        truncate(input.transcriptText || "暂无转写内容。", 4000),
        "```",
      ].join("\n"),
      input.fallbackReason,
    )
  }

  createFallbackMindmap(input: {
    fallbackReason: string
    taskTitle: string
    transcriptText: string
  }): GeneratedArtifactState {
    const paragraphs = input.transcriptText
      .split(/\n+/u)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)

    return this.createFallbackArtifact(
      [
        `# ${input.taskTitle || "任务导图"}`,
        "",
        "## 核心内容",
        ...paragraphs.map((item) => `### ${truncate(item, 60)}`),
      ].join("\n"),
      input.fallbackReason,
    )
  }

  createSummaryArtifact(input: {
    correctedText: string
    notesArtifact: GeneratedArtifactState
    taskTitle: string
  }): GeneratedArtifactState {
    const summary = [
      `# ${input.taskTitle || "任务摘要"}`,
      "",
      "## 摘要",
      "",
      truncate(
        input.notesArtifact.content
          .replace(/^> 当前为回退生成结果：.+$/gmu, "")
          .replace(/^#.+$/gmu, "")
          .trim() || input.correctedText,
        1200,
      ),
    ].join("\n")

    if (input.notesArtifact.generated_by === "fallback") {
      return this.createFallbackArtifact(summary, input.notesArtifact.fallback_reason)
    }
    return this.createLlmArtifact(summary)
  }

  buildManifest(input: SummaryArtifactManifest): string {
    return JSON.stringify(input, null, 2)
  }

  listFallbackChannels(manifest: SummaryArtifactManifest): string[] {
    return (Object.entries(manifest) as Array<[keyof SummaryArtifactManifest, GeneratedArtifactState]>)
      .filter(([, artifact]) => artifact.generated_by === "fallback")
      .map(([channel]) => channel)
  }

  private createFallbackArtifact(content: string, fallbackReason: string): GeneratedArtifactState {
    return {
      content: prependFallbackNotice(content, fallbackReason),
      generated_by: "fallback",
      fallback_reason: fallbackReason,
    }
  }
}

function prependFallbackNotice(content: string, fallbackReason: string): string {
  const normalizedReason = fallbackReason.trim() || "fallback_applied"
  return [`> 当前为回退生成结果：${normalizedReason}`, "", String(content || "").trim()].join("\n")
}

function truncate(value: string, limit: number): string {
  const normalized = String(value || "").trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`
}
