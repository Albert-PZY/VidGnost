import type { IsoDateTime } from "./common.js"

/* ------------------------------------------------------------------ 章节 */

export interface Chapter {
  id: string
  /** 从 0 开始。 */
  index: number
  title: string
  /** 一句话概括。 */
  gist: string
  start: number
  end: number
  /** 归属的段落 ID。 */
  paragraphIds: string[]
  /** 本章要点，3-6 条。 */
  bullets: string[]
}

export interface OutlineDoc {
  chapters: Chapter[]
  generatedBy: string
  createdAt: IsoDateTime
}

/* ------------------------------------------------------------------ 摘要 */

export interface Highlight {
  text: string
  /** 锚定时间轴，可空（全局结论）。 */
  start?: number
  chapterId?: string
}

export interface GlossaryEntry {
  term: string
  explanation: string
}

export interface SummaryDoc {
  /** 一段话总览。 */
  tldr: string
  /** 核心结论 / 关键要点。 */
  highlights: Highlight[]
  /** 可执行动作项。 */
  actions: string[]
  /** 遗留疑问。 */
  questions: string[]
  glossary: GlossaryEntry[]
  tags: string[]
  /** 目标读者与难度评估。 */
  audience: string
  generatedBy: string
  createdAt: IsoDateTime
}

/* ---------------------------------------------------------------- 思维导图 */

export interface MindNode {
  id: string
  label: string
  note?: string
  start?: number
  children?: MindNode[]
}

export interface MindMapDoc {
  root: MindNode
  /** 可直接渲染的 mermaid `mindmap` 源码。 */
  mermaid: string
  generatedBy: string
  createdAt: IsoDateTime
}

/* ---------------------------------------------------------------- 知识图谱 */

export type KnowledgeNodeType =
  | "concept"
  | "person"
  | "tool"
  | "organization"
  | "method"
  | "metric"
  | "artifact"

export interface KnowledgeNode {
  id: string
  label: string
  type: KnowledgeNodeType
  /** 重要度 0-1。 */
  weight: number
  /** 首次出现时间（秒）。 */
  start?: number
  /** 关联章节。 */
  chapterIds: string[]
  mention: number
}

export interface KnowledgeEdge {
  id: string
  source: string
  target: string
  relation: string
  weight: number
}

export interface KnowledgeGraphDoc {
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  generatedBy: string
  createdAt: IsoDateTime
}

/* -------------------------------------------------------------------- 视觉 */

export interface KeyFrame {
  id: string
  /** 秒。 */
  time: number
  /** 相对任务目录的路径。 */
  path: string
  kind: "scene" | "interval"
  /** 视觉模型图注。 */
  caption?: string
  /** 画面内可读文本（幻灯片 / 代码 / 表格）。 */
  onScreenText?: string
  /** 是否为演示型画面（幻灯片、代码、图表）。 */
  slideLike?: boolean
}

export interface FrameDoc {
  frames: KeyFrame[]
  generatedBy: string
  createdAt: IsoDateTime
}

/* -------------------------------------------------------------------- 翻译 */

export interface TranslatedParagraph {
  paragraphId: string
  text: string
}

export interface TranslationDoc {
  targetLanguage: string
  engine: string
  paragraphs: TranslatedParagraph[]
  createdAt: IsoDateTime
}
