import type { Chapter, MindMapDoc, MindNode, SummaryDoc } from "@vidgnost/contracts"

import { logger } from "../core/logger.js"
import { extractJson, formatTimecode, snippet } from "../core/text.js"
import type { ModelGateway } from "../providers/gateway.js"

const log = logger.child({ scope: "mindmap" })

const SYSTEM_PROMPT = [
  "你是一名知识结构设计师。把视频内容整理成一棵三层思维导图。",
  "规则：",
  "1. 根节点是视频主题（不超过 20 字），第二层是 4-8 个主题分支，第三层是每个分支下 2-5 个具体要点。",
  "2. 节点标签必须是名词短语或短句，不超过 24 字；不要出现「其他」「总结」这类占位节点。",
  "3. 每个第三层节点可以带 `start`（该内容在原片中的秒数，整数）。",
  "4. 只输出 JSON。",
].join("\n")

interface RawNode {
  children?: RawNode[]
  label?: unknown
  note?: unknown
  start?: unknown
}

export class MindMapService {
  constructor(private readonly gateway: ModelGateway) {}

  async build(input: {
    chapters: Chapter[]
    chapterNotes: Map<string, Array<{ start: number; text: string }>>
    signal?: AbortSignal
    summary: SummaryDoc
    title: string
  }): Promise<MindMapDoc> {
    const outlineText = input.chapters
      .map((chapter) => {
        const points = input.chapterNotes.get(chapter.id) || chapter.bullets.map((text) => ({ text, start: chapter.start }))
        return [
          `- ${chapter.title} [${formatTimecode(chapter.start)}] ${chapter.gist}`,
          ...points.slice(0, 5).map((point) => `  - [${formatTimecode(point.start)}] ${point.text}`),
        ].join("\n")
      })
      .join("\n")

    try {
      const result = await this.gateway.chat("llm.balanced", {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: [
          `视频标题：${input.title}`,
          `总览：${input.summary.tldr}`,
          "",
          "章节与要点：",
          outlineText,
          "",
          '输出 JSON：{"root":{"label":"主题","children":[{"label":"分支","children":[{"label":"要点","start":123}]}]}}',
        ].join("\n"),
        responseFormat: { type: "json_object" },
        signal: input.signal,
        maxTokens: 4000,
      })
      const parsed = extractJson<{ root?: RawNode }>(result.text)
      const root = normalizeNode(parsed?.root, "root-0", 0)
      if (root && (root.children?.length || 0) >= 2) {
        return buildDoc(root, "llm.balanced")
      }
    } catch (error) {
      log.warn({ error: String(error) }, "mindmap llm failed, using deterministic tree")
    }

    return buildDoc(deterministicTree(input), "deterministic-from-outline")
  }
}

function normalizeNode(raw: RawNode | undefined, id: string, depth: number): MindNode | null {
  const label = String(raw?.label || "").trim()
  if (!label) {
    return null
  }
  // 导图宽度由最长标签决定，因此按层级收紧标签长度，避免图形被拉得无法阅读。
  const maxLabel = depth === 0 ? 26 : depth === 1 ? 18 : 26
  const children =
    depth >= 2
      ? []
      : (raw?.children || [])
          .map((child, index) => normalizeNode(child, `${id}-${index}`, depth + 1))
          .filter((node): node is MindNode => Boolean(node))
  const start = Number(raw?.start)
  return {
    id,
    label: snippet(label, maxLabel),
    ...(raw?.note ? { note: String(raw.note).slice(0, 200) } : {}),
    ...(Number.isFinite(start) && start >= 0 ? { start: Math.round(start) } : {}),
    ...(children.length > 0 ? { children: children.slice(0, 6) } : {}),
  }
}

function deterministicTree(input: {
  chapters: Chapter[]
  chapterNotes: Map<string, Array<{ start: number; text: string }>>
  summary: SummaryDoc
  title: string
}): MindNode {
  return {
    id: "root-0",
    label: snippet(input.title, 26),
    children: input.chapters.map((chapter, index) => {
      const points = input.chapterNotes.get(chapter.id) || chapter.bullets.map((text) => ({ text, start: chapter.start }))
      return {
        id: `root-0-${index}`,
        label: snippet(chapter.title, 18),
        start: Math.round(chapter.start),
        children: points.slice(0, 5).map((point, pointIndex) => ({
          id: `root-0-${index}-${pointIndex}`,
          label: snippet(point.text, 26),
          start: Math.round(point.start),
        })),
      }
    }),
  }
}

function buildDoc(root: MindNode, generatedBy: string): MindMapDoc {
  return {
    root,
    mermaid: renderMermaid(root),
    generatedBy,
    createdAt: new Date().toISOString(),
  }
}

/** 生成 Mermaid `mindmap` 源码；同时天然兼容 markmap 的标题层级导出。 */
export function renderMermaid(root: MindNode): string {
  const lines: string[] = ["mindmap"]
  const walk = (node: MindNode, depth: number) => {
    // Mermaid mindmap 的第一层缩进为 2 空格；根节点使用圆角形状以便与分支区分。
    const indent = "  ".repeat(depth + 1)
    const label = sanitizeMermaidLabel(node.label)
    const shape = depth === 0 ? `root((${label}))` : label
    lines.push(`${indent}${shape}`)
    for (const child of node.children || []) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return lines.join("\n")
}

function sanitizeMermaidLabel(label: string): string {
  // 只清洗会参与 Mermaid 语法解析的 ASCII 字符；全角标点是内容，必须保留。
  return String(label || "")
    .replace(/[(){}[\]"`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
}

/** 把思维导图渲染为 Markdown 标题层级（markmap 直接可用）。 */
export function renderMarkmapMarkdown(root: MindNode): string {
  const lines: string[] = []
  const walk = (node: MindNode, depth: number) => {
    lines.push(`${"#".repeat(Math.min(6, depth + 1))} ${node.label}${node.start === undefined ? "" : ` \`[${formatTimecode(node.start)}]\``}`)
    for (const child of node.children || []) {
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return lines.join("\n")
}
