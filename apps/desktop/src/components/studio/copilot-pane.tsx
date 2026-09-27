import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bot, Eraser, Loader2, Quote, User } from 'lucide-react'

import type { Citation } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { AnswerMarkdown } from '@/components/studio/answer-markdown'
import { useAppStore } from '@/stores/app-store'
import { usePlayerStore } from '@/stores/player-store'

const SUGGESTIONS = [
  '用三句话总结这个视频',
  '视频里提到的关键步骤有哪些？',
  '有没有给出具体的命令或配置示例？',
]

/**
 * Copilot：基于时间锚定证据的追问面板。
 * 回答里的每个引用都是可点击片段；点击后播放器跳到该片段并高亮原文。
 */
export function CopilotPane() {
  const turns = useAppStore((state) => state.turns)
  const asking = useAppStore((state) => state.asking)
  const ask = useAppStore((state) => state.ask)
  const reset = useAppStore((state) => state.resetConversation)
  const task = useAppStore((state) => state.task)
  const hasOutline = useAppStore((state) => Boolean(state.artifacts.outline))
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [turns])

  // 只要章节与段落产物已就绪就允许提问，不必等整个任务跑完。
  const ready = hasOutline && task?.status !== 'failed'

  const submit = () => {
    const value = input.trim()
    if (!value || asking) return
    setInput('')
    void ask(value)
  }

  return (
    <aside className="flex w-[22.25rem] shrink-0 flex-col hairline-l">
      <div className="flex items-center gap-2 px-4 pb-2.5 pt-4">
        <Bot className="size-3.5 text-primary" strokeWidth={1.8} />
        <span className="label-eyebrow">Copilot</span>
        <span className="ml-auto flex items-center gap-1">
          {turns.length > 0 ? (
            <button
              type="button"
              onClick={reset}
              className="grid size-6 place-items-center rounded text-text-subtle transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="清空对话"
              title="清空对话"
            >
              <Eraser className="size-3.5" />
            </button>
          ) : null}
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {turns.length === 0 ? (
          <div className="pt-3">
            <p className="text-note leading-relaxed text-text-muted">
              {ready
                ? '基于转写与章节索引提问。回答中的每个引用都能跳到原片对应片段。'
                : '任务处理完成后即可追问。'}
            </p>
            {ready ? (
              <ul className="mt-3 space-y-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => void ask(suggestion)}
                      className="w-full rounded-lg border border-border/60 px-3 py-2 text-left text-note text-text-muted transition-colors hover:border-border-strong hover:bg-secondary/50 hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          turns.map((turn) => <Turn key={turn.id} turn={turn} />)
        )}
      </div>

      <div className="px-4 pb-4 pt-2">
        <div className="rounded-xl border border-border/70 bg-card/60 p-2 transition-colors focus-within:border-primary/50">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
            rows={2}
            disabled={!ready}
            placeholder={ready ? '问点什么… Enter 发送' : '等待任务处理完成'}
            aria-label="向视频提问"
            className="w-full resize-none bg-transparent px-1 text-note leading-relaxed text-foreground outline-none placeholder:text-text-subtle disabled:cursor-not-allowed"
          />
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-micro text-text-subtle">Shift + Enter 换行</span>
            <button
              type="button"
              onClick={submit}
              disabled={!ready || asking || !input.trim()}
              aria-label="发送问题"
              className={cn(
                'grid size-6 place-items-center rounded-md transition-colors',
                ready && input.trim() && !asking
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'bg-secondary text-text-subtle',
              )}
            >
              {asking ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function Turn({ turn }: { turn: { citations?: Citation[]; content: string; role: 'assistant' | 'user'; streaming?: boolean } }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <p className="max-w-[86%] rounded-xl rounded-br-sm bg-secondary px-3 py-2 text-note leading-relaxed text-foreground">
          {turn.content}
        </p>
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-text-muted">
          <User className="size-3" />
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Bot className="size-3" />
        </span>
        <div className={cn('min-w-0 flex-1 text-body leading-[1.75] text-foreground/90', turn.streaming && 'stream-caret')}>
          {turn.content ? (
            <AnswerMarkdown citations={turn.citations} text={turn.content} />
          ) : turn.streaming ? null : (
            <p className="text-text-subtle">（空回答）</p>
          )}
        </div>
      </div>

      {turn.citations && turn.citations.length > 0 ? (
        <div className="space-y-1.5 pl-7">
          <span className="label-eyebrow">证据片段</span>
          {turn.citations.map((citation) => (
            <CitationCard key={citation.index} citation={citation} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CitationCard({ citation }: { citation: Citation }) {
  const seek = usePlayerStore((state) => state.seek)
  return (
    <button
      type="button"
      onClick={() => seek(citation.start, { autoplay: true })}
      className="group flex w-full gap-2.5 rounded-lg border border-border/50 bg-card/40 px-2.5 py-2 text-left transition-colors hover:border-timestamp/40 hover:bg-card"
    >
      <span className="timecode mt-px shrink-0 rounded bg-timestamp-surface/70 px-1.5 py-0.5 text-timestamp">
        {formatTimecode(citation.start)}
      </span>
      <span className="min-w-0 flex-1">
        {citation.chapterTitle ? (
          <span className="block truncate text-micro text-text-subtle">{citation.chapterTitle}</span>
        ) : null}
        <span className="mt-0.5 line-clamp-3 block text-meta leading-relaxed text-text-muted group-hover:text-foreground/90">
          {citation.quote}
        </span>
      </span>
      <Quote className="mt-0.5 size-3 shrink-0 text-text-subtle group-hover:text-timestamp" />
    </button>
  )
}
