import { Buffer } from "node:buffer"

import type {
  TaskCreateResponse,
  TaskStatus,
  TaskStepItem,
  TranscriptSegment,
  WorkflowType,
} from "@vidgnost/contracts"

export const STAGE_KEYS = ["A", "B", "C", "D"] as const
export const D_SUBSTAGE_KEYS = ["transcript_optimize", "fusion_delivery"] as const
export const ALLOWED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"])

export function createEmptyStageLogs(): Record<string, string[]> {
  return Object.fromEntries(STAGE_KEYS.map((stage) => [stage, []])) as Record<string, string[]>
}

export function createEmptyStageMetrics(): Record<string, Record<string, unknown>> {
  const metrics = Object.fromEntries(
    STAGE_KEYS.map((stage) => [
      stage,
      {
        started_at: null,
        completed_at: null,
        elapsed_seconds: null,
        status: "pending",
        reason: null,
        log_count: 0,
      },
    ]),
  ) as Record<string, Record<string, unknown>>

  metrics.D.substage_metrics = Object.fromEntries(
    D_SUBSTAGE_KEYS.map((substage) => [
      substage,
      {
        status: "pending",
        started_at: null,
        completed_at: null,
        elapsed_seconds: null,
        optional: substage === "transcript_optimize",
        reason: null,
      },
    ]),
  )

  return metrics
}

export function parseStageLogs(raw: string | null | undefined): Record<string, string[]> {
  const result = createEmptyStageLogs()
  if (!raw) {
    return result
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>
    for (const stage of STAGE_KEYS) {
      const value = payload?.[stage]
      result[stage] = Array.isArray(value) ? value.map((item) => String(item)) : []
    }
    return result
  } catch {
    return result
  }
}

export function parseStageMetrics(raw: string | null | undefined): Record<string, Record<string, unknown>> {
  const result = createEmptyStageMetrics()
  if (!raw) {
    return result
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>
    for (const stage of STAGE_KEYS) {
      const value = payload?.[stage]
      if (value && typeof value === "object" && !Array.isArray(value)) {
        result[stage] = {
          ...result[stage],
          ...(value as Record<string, unknown>),
        }
      }
    }
    return result
  } catch {
    return result
  }
}

export function inferActiveStage(raw: string | null | undefined): string {
  const stageMetrics = parseStageMetrics(raw)
  const runningStage = Object.entries(stageMetrics).find((entry) => String(entry[1]?.status || "").trim().toLowerCase() === "running")
  return runningStage?.[0] || "D"
}

export function normalizeWorkflow(value: unknown): WorkflowType {
  return String(value || "").trim().toLowerCase() === "vqa" ? "vqa" : "notes"
}

export function normalizeSourceType(value: unknown): "bilibili" | "local_file" | "local_path" {
  const candidate = String(value || "").trim().toLowerCase()
  if (candidate === "local_file" || candidate === "local_path") {
    return candidate
  }
  return "bilibili"
}

export function normalizeDate(value: unknown): string {
  const candidate = String(value || "").trim()
  const parsed = Date.parse(candidate)
  return Number.isNaN(parsed) ? new Date(0).toISOString() : new Date(parsed).toISOString()
}

export function toPublicTaskStatus(rawStatus: unknown): TaskStatus {
  const status = String(rawStatus || "").trim().toLowerCase()
  if (["completed", "failed", "cancelled", "queued", "paused"].includes(status)) {
    return status as TaskStatus
  }
  if (["preparing", "transcribing", "summarizing", "running"].includes(status)) {
    return "running"
  }
  return "queued"
}

export function buildInitialSteps(workflow: WorkflowType): TaskStepItem[] {
  return workflowStepBlueprint(workflow).map((item) => ({
    id: item.id,
    name: item.name,
    status: "pending",
    progress: 0,
    duration: "",
    logs: [],
  }))
}

export function buildTaskCreateResponse(input: {
  taskId: string
  status: TaskStatus
  workflow: WorkflowType
}): TaskCreateResponse {
  return {
    task_id: input.taskId,
    status: input.status,
    workflow: input.workflow,
    initial_steps: buildInitialSteps(input.workflow),
  }
}

export function workflowStepBlueprint(workflow: WorkflowType): Array<{ id: string; name: string }> {
  if (workflow === "vqa") {
    return [
      { id: "extract", name: "音频提取" },
      { id: "transcribe", name: "语音转写" },
      { id: "correct", name: "文本纠错" },
      { id: "ready", name: "问答就绪" },
    ]
  }

  return [
    { id: "extract", name: "音频提取" },
    { id: "transcribe", name: "语音转写" },
    { id: "correct", name: "文本纠错" },
    { id: "notes", name: "笔记生成" },
  ]
}

export function sanitizeFilename(input: string): string {
  const normalized = String(input || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
  return normalized || "download"
}

export function renderMarkmapHtml(markdownText: string, title: string): string {
  const safeTitle = String(title || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const escapedMarkdown = String(markdownText || "# Empty").replace(/<\/script>/gi, "<\\/script>")

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle} - Mindmap</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #ffffff;
        color: #111827;
      }
      #mindmap {
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <svg id="mindmap"></svg>
    <script type="module">
      import { Transformer } from "https://cdn.jsdelivr.net/npm/markmap-lib@0.18.12/+esm";
      import { Markmap } from "https://cdn.jsdelivr.net/npm/markmap-view@0.18.12/+esm";
      const markdown = \`${escapedMarkdown}\`;
      const transformer = new Transformer();
      const { root } = transformer.transform(markdown);
      Markmap.create("#mindmap", { autoFit: true, duration: 300 }, root);
    </script>
  </body>
</html>
`
}

export function buildContentDisposition(filename: string): string {
  const asciiFallback =
    String(filename || "")
      .split("")
      .map((char) => {
        const code = char.charCodeAt(0)
        return code >= 32 && code <= 126 && !['"', "\\", ";"].includes(char) ? char : "_"
      })
      .join("") || "download.bin"

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987ValueChars(filename)}`
}

export function parseTranscriptSegments(raw: string | null | undefined): TranscriptSegment[] {
  if (!raw) {
    return []
  }

  try {
    const payload = JSON.parse(raw) as unknown
    if (!Array.isArray(payload)) {
      return []
    }

    return payload
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((segment) => ({
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        text: String(segment.text || ""),
        ...(segment.speaker !== undefined && segment.speaker !== null ? { speaker: String(segment.speaker) } : {}),
      }))
      .filter((segment) => segment.text.trim().length > 0)
  } catch {
    return []
  }
}

export function buildSrt(segments: TranscriptSegment[]): string {
  const lines: string[] = []
  normalizeSubtitleSegments(segments).forEach((segment, index) => {
    lines.push(String(index + 1))
    lines.push(`${formatSubtitleTimestamp(segment.start, ",")} --> ${formatSubtitleTimestamp(segment.end, ",")}`)
    lines.push(segment.text)
    lines.push("")
  })
  return lines.join("\n").trimEnd()
}

export function buildVtt(segments: TranscriptSegment[]): string {
  const lines = ["WEBVTT", ""]
  normalizeSubtitleSegments(segments).forEach((segment) => {
    lines.push(`${formatSubtitleTimestamp(segment.start, ".")} --> ${formatSubtitleTimestamp(segment.end, ".")}`)
    lines.push(segment.text)
    lines.push("")
  })
  return `${lines.join("\n").trimEnd()}\n`
}

export function buildArtifactIndex(input: {
  taskId: string
  transcriptText?: string | null
  transcriptSegmentsJson?: string | null
  summaryMarkdown?: string | null
  notesMarkdown?: string | null
  mindmapMarkdown?: string | null
  updatedAt?: string
}): { artifactIndexJson: string; artifactTotalBytes: number } {
  const updatedAt = input.updatedAt || new Date().toISOString()
  const entries: Array<Record<string, unknown>> = []
  let artifactTotalBytes = 0

  const appendEntry = (key: string, logicalPath: string, content: string | null | undefined) => {
    const normalized = content ?? ""
    if (!normalized) {
      return
    }
    const sizeBytes = Buffer.byteLength(normalized, "utf8")
    artifactTotalBytes += sizeBytes
    entries.push({
      key,
      logical_path: logicalPath,
      size_bytes: sizeBytes,
      updated_at: updatedAt,
    })
  }

  appendEntry("transcript_text", `db://task/${input.taskId}/transcript.txt`, input.transcriptText)
  appendEntry("transcript_segments", `db://task/${input.taskId}/transcript-segments.json`, input.transcriptSegmentsJson)
  appendEntry("summary_markdown", `db://task/${input.taskId}/summary.md`, input.summaryMarkdown)
  appendEntry("notes_markdown", `db://task/${input.taskId}/notes.md`, input.notesMarkdown)
  appendEntry("mindmap_markdown", `db://task/${input.taskId}/mindmap.md`, input.mindmapMarkdown)

  return {
    artifactIndexJson: JSON.stringify(entries),
    artifactTotalBytes,
  }
}

function normalizeSubtitleSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const normalized: TranscriptSegment[] = []
  let previousEnd = 0

  for (const segment of segments) {
    const text = String(segment.text || "").trim()
    if (!text) {
      continue
    }

    let start = Math.max(0, Number(segment.start) || 0)
    let end = Math.max(0, Number(segment.end) || 0)
    if (start < previousEnd) {
      start = previousEnd
    }
    if (end <= start) {
      end = start + 0.3
    }

    previousEnd = end
    normalized.push({
      ...segment,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      text,
    })
  }

  return normalized
}

function formatSubtitleTimestamp(seconds: number, separator: "," | "."): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((totalMilliseconds % 60_000) / 1_000)
  const milliseconds = totalMilliseconds % 1_000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(milliseconds).padStart(3, "0")}`
}

function encodeRFC5987ValueChars(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (match) => `%${match.charCodeAt(0).toString(16).toUpperCase()}`)
}
