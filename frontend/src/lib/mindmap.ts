import type { NodeTreeData, NodeTreeFormat } from 'jsmind'

interface StackEntry {
  depth: number
  node: NodeTreeData
}

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function sanitizeMindmapTopic(value: string): string {
  let topic = value.trim()
  if (!topic) return ''
  topic = topic.replace(/\[(.*?)\]\((.*?)\)/g, '$1')
  topic = topic.replace(/<\/?[^>]+>/g, '')
  topic = topic.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '')
  topic = topic.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+)/, '')
  topic = topic.replace(/[*~]+/g, '')
  topic = topic.replace(/\s+/g, ' ').trim()
  return topic.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
}

function extractMindmapTopicFromMermaidLine(value: string): string {
  let topic = value.trim()
  if (!topic) return ''
  if (/^mindmap\b/i.test(topic)) return ''
  topic = topic.replace(/^root\b/i, '').trim()
  if (/^[A-Za-z0-9_-]+\s*(?=[([{])/i.test(topic)) {
    topic = topic.replace(/^[A-Za-z0-9_-]+\s*/i, '').trim()
  }
  for (;;) {
    const before = topic
    const wrappers: Array<[string, string]> = [
      ['((', '))'],
      ['[[', ']]'],
      ['{{', '}}'],
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]
    for (const [opening, closing] of wrappers) {
      if (topic.startsWith(opening) && topic.endsWith(closing)) {
        topic = topic.slice(opening.length, topic.length - closing.length).trim()
        break
      }
    }
    if (topic === before) break
  }
  return sanitizeMindmapTopic(topic)
}

function createNode(topic: string, counter: { value: number }): NodeTreeData {
  counter.value += 1
  return {
    id: `mindmap_node_${counter.value}`,
    topic,
    expanded: true,
  }
}

function pushChildNode(
  stack: StackEntry[],
  depth: number,
  topic: string,
  counter: { value: number },
): void {
  const safeDepth = Math.max(1, depth)
  while (stack.length > 1 && stack[stack.length - 1]?.depth >= safeDepth) {
    stack.pop()
  }
  const parent = stack[stack.length - 1]?.node ?? stack[0]?.node
  if (!parent) return
  const node = createNode(topic, counter)
  parent.children ??= []
  parent.children.push(node)
  stack.push({ depth: safeDepth, node })
}

function extractMindmapCode(text: string): string | null {
  const normalized = normalizeLineBreaks(text).trim()
  if (!normalized) return null
  const fenced = normalized.match(/```(?:mindmap|mermaid)\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const code = fenced[1]?.trim() ?? ''
    return /^mindmap\b/i.test(code) ? code : null
  }
  return /^mindmap\b/i.test(normalized) ? normalized : null
}

function isUnsupportedMermaidDiagram(text: string): boolean {
  const normalized = normalizeLineBreaks(text).trim()
  if (!normalized) return false
  const fenced = normalized.match(/```mermaid\s*([\s\S]*?)\s*```/i)
  const code = fenced?.[1]?.trim() ?? normalized
  return /^(?:graph|flowchart)\b/i.test(code)
}

function parseMermaidMindmap(code: string, fallbackTitle: string): NodeTreeData | null {
  const normalized = normalizeLineBreaks(code)
  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/\t/g, '  '))
    .filter((line) => line.trim().length > 0)
  if (!lines.length) return null

  const contentLines = /^mindmap\b/i.test(lines[0] ?? '') ? lines.slice(1) : lines
  const parsedLines = contentLines
    .map((line) => ({
      indent: line.match(/^\s*/)?.[0].length ?? 0,
      topic: extractMindmapTopicFromMermaidLine(line),
    }))
    .filter((line) => line.topic)
  if (!parsedLines.length) return null

  const counter = { value: 0 }
  const root = createNode(parsedLines[0]?.topic ?? fallbackTitle, counter)
  const stack: StackEntry[] = [{ depth: 0, node: root }]
  const baseIndent = parsedLines[0]?.indent ?? 0

  for (const item of parsedLines.slice(1)) {
    const relativeDepth = Math.max(1, Math.floor(Math.max(0, item.indent - baseIndent) / 2))
    pushChildNode(stack, relativeDepth, item.topic, counter)
  }
  return root
}

function parseOutlineMindmap(markdown: string, fallbackTitle: string): NodeTreeData | null {
  const normalized = normalizeLineBreaks(markdown)
  const counter = { value: 0 }
  const root = createNode(sanitizeMindmapTopic(fallbackTitle) || '思维导图', counter)
  const stack: StackEntry[] = [{ depth: 0, node: root }]
  let sawContent = false
  let sectionDepth = 0
  let rootAssigned = false

  for (const rawLine of normalized.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('```')) continue

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const topic = sanitizeMindmapTopic(headingMatch[2] ?? '')
      if (!topic) continue
      const depth = Math.max(0, (headingMatch[1]?.length ?? 1) - 1)
      if (depth === 0 && !rootAssigned) {
        root.topic = topic
        rootAssigned = true
        sawContent = true
        sectionDepth = 0
        stack.splice(1)
        continue
      }
      pushChildNode(stack, depth, topic, counter)
      sectionDepth = depth
      sawContent = true
      continue
    }

    const bulletMatch = rawLine.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/)
    if (bulletMatch) {
      const topic = sanitizeMindmapTopic(bulletMatch[3] ?? '')
      if (!topic) continue
      const indentDepth = Math.floor((bulletMatch[1]?.replace(/\t/g, '  ').length ?? 0) / 2)
      pushChildNode(stack, sectionDepth + 1 + indentDepth, topic, counter)
      sawContent = true
      continue
    }

    const topic = sanitizeMindmapTopic(trimmed)
    if (!topic) continue
    pushChildNode(stack, Math.max(1, sectionDepth + 1), topic, counter)
    sawContent = true
  }

  return sawContent ? root : null
}

export function buildJsMindMindmap(
  markdown: string,
  fallbackTitle = '思维导图',
): NodeTreeFormat | null {
  const normalized = normalizeLineBreaks(markdown).trim()
  if (!normalized || isUnsupportedMermaidDiagram(normalized)) {
    return null
  }

  const mindmapCode = extractMindmapCode(normalized)
  const root = mindmapCode
    ? parseMermaidMindmap(mindmapCode, fallbackTitle)
    : parseOutlineMindmap(normalized, fallbackTitle)
  if (!root) return null

  return {
    format: 'node_tree',
    data: root,
  }
}
