import type { ReactNode } from 'react'

import type { Citation } from '@vidgnost/contracts'

import { formatTimecode } from '@/lib/format'
import { usePlayerStore } from '@/stores/player-store'

/**
 * 答案渲染：只支持受控的 Markdown 子集（段落、无序/有序列表、粗体、行内代码、标题），
 * 并把它与引用 chip 结合。之所以不引入完整 Markdown 库：
 * 这里渲染的是模型输出，语法面越小越安全，也越容易保持排版一致。
 */
export function AnswerMarkdown({ citations, text }: { citations?: Citation[]; text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.kind === 'list') {
          return (
            <ul key={index} className="space-y-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2.5">
                  <span className="mt-[9px] size-1 shrink-0 rounded-full bg-text-subtle" />
                  <span className="min-w-0 flex-1">
                    <Inline citations={citations} text={item} />
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'ordered') {
          return (
            <ol key={index} className="space-y-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2.5">
                  <span className="metric-value mt-px w-4 shrink-0 text-[10px] text-text-subtle">{itemIndex + 1}</span>
                  <span className="min-w-0 flex-1">
                    <Inline citations={citations} text={item} />
                  </span>
                </li>
              ))}
            </ol>
          )
        }
        if (block.kind === 'heading') {
          return (
            <p key={index} className="pt-1 text-[12px] font-semibold text-text-strong">
              <Inline citations={citations} text={block.text} />
            </p>
          )
        }
        return (
          <p key={index}>
            <Inline citations={citations} text={block.text} />
          </p>
        )
      })}
    </div>
  )
}

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { items: string[]; kind: 'list' }
  | { items: string[]; kind: 'ordered' }

function parseBlocks(text: string): Block[] {
  const lines = String(text || '').split(/\r?\n/)
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { items: string[]; kind: 'list' | 'ordered' } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push(list)
      list = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    const bullet = line.match(/^[-*·]\s+(.*)$/)
    if (bullet) {
      flushParagraph()
      if (!list || list.kind !== 'list') {
        flushList()
        list = { kind: 'list', items: [] }
      }
      list.items.push(bullet[1])
      continue
    }

    const ordered = line.match(/^\d+[.)]\s+(.*)$/)
    if (ordered) {
      flushParagraph()
      if (!list || list.kind !== 'ordered') {
        flushList()
        list = { kind: 'ordered', items: [] }
      }
      list.items.push(ordered[1])
      continue
    }

    const heading = line.match(/^#{1,6}\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', text: heading[1] })
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks
}

/** 行内渲染：粗体、行内代码与引用 chip。 */
function Inline({ citations, text }: { citations?: Citation[]; text: string }): ReactNode {
  const seek = usePlayerStore((state) => state.seek)
  const pattern = /(\[\^\d+\]|\*\*[^*]+\*\*|`[^`]+`)/g
  const parts = String(text || '').split(pattern)

  return (
    <>
      {parts.map((part, index) => {
        const citationMatch = part.match(/^\[\^(\d+)\]$/)
        if (citationMatch) {
          const citation = citations?.find((item) => item.index === Number(citationMatch[1]))
          if (!citation) {
            return null
          }
          return (
            <button
              key={index}
              type="button"
              onClick={() => seek(citation.start, { autoplay: true })}
              title={`跳到 ${formatTimecode(citation.start)}`}
              className="timecode mx-0.5 inline-flex items-center rounded bg-timestamp-surface/70 px-1.5 py-px align-baseline text-timestamp transition-colors hover:bg-timestamp-surface"
            >
              {formatTimecode(citation.start)}
            </button>
          )
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <strong key={index} className="font-semibold text-text-strong">
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code key={index} className="timecode rounded bg-secondary px-1 py-px text-[12px] text-foreground/90">
              {part.slice(1, -1)}
            </code>
          )
        }
        return <span key={index}>{part}</span>
      })}
    </>
  )
}
