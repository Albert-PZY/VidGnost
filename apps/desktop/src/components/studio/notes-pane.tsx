import { Compass, ListChecks, Sparkle } from 'lucide-react'

import type { OutlineDoc, SummaryDoc } from '@vidgnost/contracts'

import { TimeAnchor } from '@/components/studio/time-anchor'

/** 笔记视图：总览、核心结论、行动项、术语表，全部带时间锚点。 */
export function NotesPane({ outline, summary }: { outline: OutlineDoc | null; summary: SummaryDoc | null }) {
  if (!summary) {
    return <EmptyState message="摘要还没生成完成。" />
  }

  return (
    <div className="mx-auto max-w-[47.5rem] px-6 py-6">
      <section>
        <span className="label-eyebrow">总览</span>
        <p className="reading mt-2.5">{summary.tldr}</p>
        {summary.audience ? (
          <p className="mt-2 text-meta text-text-subtle">目标观众：{summary.audience}</p>
        ) : null}
      </section>

      {summary.highlights.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <Sparkle className="size-3.5 text-primary" strokeWidth={1.8} />
            <span className="label-eyebrow">核心结论</span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {summary.highlights.map((highlight, index) => (
              <li key={index} className="flex gap-3">
                <span className="metric-value mt-[3px] w-4 shrink-0 text-micro text-text-subtle">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="reading min-w-0 flex-1">
                  {highlight.text}
                  {highlight.start !== undefined ? <TimeAnchor seconds={highlight.start} className="ml-1.5" /> : null}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary.actions.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <ListChecks className="size-3.5 text-success" strokeWidth={1.8} />
            <span className="label-eyebrow">行动项</span>
          </div>
          <ul className="mt-3 space-y-2">
            {summary.actions.map((action, index) => (
              <li key={index} className="flex gap-2.5 text-body leading-relaxed text-foreground/90">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-success/70" />
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outline && outline.chapters.length > 0 ? (
        <section className="mt-8">
          <span className="label-eyebrow">分章笔记</span>
          <div className="mt-3 space-y-5">
            {outline.chapters.map((chapter, index) => (
              <article key={chapter.id} className="border-l border-border/70 pl-4">
                <header className="flex flex-wrap items-baseline gap-2">
                  <span className="metric-value text-micro text-text-subtle">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-lead font-medium text-text-strong">{chapter.title}</h3>
                  <TimeAnchor seconds={chapter.start} tone="chip" />
                </header>
                {chapter.gist ? <p className="mt-1.5 text-note text-text-muted">{chapter.gist}</p> : null}
                {chapter.bullets.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {chapter.bullets.map((bullet, bulletIndex) => (
                      <li key={bulletIndex} className="flex gap-2.5 text-body leading-relaxed text-foreground/90">
                        <span className="mt-[8px] size-1 shrink-0 rounded-full bg-text-subtle" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {summary.glossary.length > 0 ? (
          <section>
            <div className="flex items-center gap-2">
              <Compass className="size-3.5 text-info" strokeWidth={1.8} />
              <span className="label-eyebrow">术语表</span>
            </div>
            <dl className="mt-3 space-y-2.5">
              {summary.glossary.map((entry) => (
                <div key={entry.term}>
                  <dt className="text-note font-medium text-text-strong">{entry.term}</dt>
                  <dd className="mt-0.5 text-note leading-relaxed text-text-muted">{entry.explanation}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {summary.questions.length > 0 ? (
          <section>
            <span className="label-eyebrow">遗留疑问</span>
            <ul className="mt-3 space-y-2">
              {summary.questions.map((question, index) => (
                <li key={index} className="text-note leading-relaxed text-text-muted">
                  {question}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[15rem] items-center justify-center px-6">
      <p className="text-note text-text-subtle">{message}</p>
    </div>
  )
}
