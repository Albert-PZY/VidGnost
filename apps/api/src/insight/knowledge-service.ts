import type {
  Chapter,
  KnowledgeEdge,
  KnowledgeGraphDoc,
  KnowledgeNode,
  KnowledgeNodeType,
  TranscriptParagraph,
} from "@vidgnost/contracts"

import { logger } from "../core/logger.js"
import { clamp01, extractJson } from "../core/text.js"
import type { ModelGateway } from "../providers/gateway.js"
import { renderParagraphsForPrompt, windowParagraphs } from "./segmenter.js"

const log = logger.child({ scope: "knowledge" })

const NODE_TYPES: KnowledgeNodeType[] = ["concept", "person", "tool", "organization", "method", "metric", "artifact"]

const SYSTEM_PROMPT = [
  "你是知识图谱抽取器。输入是一段带编号的视频转写，请抽出实体与关系。",
  "规则：",
  "1. 只抽对理解内容真正重要的实体，单个窗口最多 14 个。",
  "2. type 只能取：concept | person | tool | organization | method | metric | artifact。",
  "3. weight 是 0-1 的重要度；paragraphId 是该实体第一次出现的段落编号。",
  "4. relations 只在两个已抽出的实体之间建立，relation 用 2-6 个字的中文动词短语。",
  "5. 只输出 JSON。",
].join("\n")

interface RawEntity {
  label?: unknown
  paragraphId?: unknown
  type?: unknown
  weight?: unknown
}

interface RawRelation {
  relation?: unknown
  source?: unknown
  target?: unknown
}

export class KnowledgeService {
  constructor(private readonly gateway: ModelGateway) {}

  async build(input: {
    chapters: Chapter[]
    paragraphs: TranscriptParagraph[]
    signal?: AbortSignal
    title: string
  }): Promise<KnowledgeGraphDoc> {
    if (input.paragraphs.length === 0) {
      return emptyGraph("none")
    }

    const chapterOfParagraph = new Map<string, string>()
    for (const chapter of input.chapters) {
      for (const paragraphId of chapter.paragraphIds) {
        chapterOfParagraph.set(paragraphId, chapter.id)
      }
    }
    const startOfParagraph = new Map(input.paragraphs.map((paragraph) => [paragraph.id, paragraph.start]))

    const windows = windowParagraphs(input.paragraphs, { tokenBudget: 3000, overlap: 1 })
    const nodes = new Map<string, KnowledgeNode>()
    const edges = new Map<string, KnowledgeEdge>()

    for (const [index, window] of windows.entries()) {
      try {
        const result = await this.gateway.chat("llm.balanced", {
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: [
            `视频标题：${input.title}`,
            `窗口 ${index + 1}/${windows.length}`,
            "",
            renderParagraphsForPrompt(window, { includeTime: false }),
            "",
            '输出 JSON：{"entities":[{"label":"实体","type":"concept","weight":0.8,"paragraphId":"p0002"}],"relations":[{"source":"实体A","target":"实体B","relation":"依赖"}]}',
          ].join("\n"),
          responseFormat: { type: "json_object" },
          signal: input.signal,
          maxTokens: 3000,
        })
        const parsed = extractJson<{ entities?: RawEntity[]; relations?: RawRelation[] }>(result.text)
        const localIds = new Map<string, string>()

        for (const raw of parsed?.entities || []) {
          const label = String(raw.label || "").trim()
          if (label.length < 2 || label.length > 40) {
            continue
          }
          const type = NODE_TYPES.includes(String(raw.type) as KnowledgeNodeType)
            ? (String(raw.type) as KnowledgeNodeType)
            : "concept"
          const id = `kn_${slug(label)}`
          const paragraphId = String(raw.paragraphId || "")
          const chapterId = chapterOfParagraph.get(paragraphId)
          localIds.set(label.toLowerCase(), id)

          const existing = nodes.get(id)
          if (existing) {
            existing.mention += 1
            existing.weight = clamp01(existing.weight + 0.08)
            if (chapterId && !existing.chapterIds.includes(chapterId)) {
              existing.chapterIds.push(chapterId)
            }
            if (existing.start === undefined && startOfParagraph.has(paragraphId)) {
              existing.start = Math.round(startOfParagraph.get(paragraphId) as number)
            }
          } else {
            nodes.set(id, {
              id,
              label,
              type,
              weight: clamp01(Number(raw.weight) || 0.5),
              mention: 1,
              chapterIds: chapterId ? [chapterId] : [],
              ...(startOfParagraph.has(paragraphId) ? { start: Math.round(startOfParagraph.get(paragraphId) as number) } : {}),
            })
          }
        }

        for (const raw of parsed?.relations || []) {
          const source = localIds.get(String(raw.source || "").trim().toLowerCase())
          const target = localIds.get(String(raw.target || "").trim().toLowerCase())
          if (!source || !target || source === target) {
            continue
          }
          const relation = String(raw.relation || "").trim().slice(0, 12)
          if (!relation) {
            continue
          }
          const id = `${source}|${relation}|${target}`
          const existing = edges.get(id)
          if (existing) {
            existing.weight = clamp01(existing.weight + 0.15)
          } else {
            edges.set(id, { id, source, target, relation, weight: 0.6 })
          }
        }
      } catch (error) {
        log.warn({ window: index, error: String(error) }, "knowledge window failed")
      }
    }

    const nodeList = [...nodes.values()].sort((a, b) => b.mention - a.mention || b.weight - a.weight)
    const nodeIds = new Set(nodeList.map((node) => node.id))
    const edgeList = [...edges.values()].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))

    return {
      nodes: nodeList,
      edges: edgeList,
      generatedBy: "llm.balanced",
      createdAt: new Date().toISOString(),
    }
  }
}

function emptyGraph(generatedBy: string): KnowledgeGraphDoc {
  return { nodes: [], edges: [], generatedBy, createdAt: new Date().toISOString() }
}

function slug(label: string): string {
  return Buffer.from(label, "utf8").toString("base64url").slice(0, 16)
}
