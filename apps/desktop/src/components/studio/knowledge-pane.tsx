import { useMemo, useState } from 'react'

import type { KnowledgeGraphDoc, KnowledgeNodeType } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/studio/notes-pane'
import { TimeAnchor } from '@/components/studio/time-anchor'

const TYPE_LABELS: Record<KnowledgeNodeType, string> = {
  concept: '概念',
  person: '人物',
  tool: '工具',
  organization: '组织',
  method: '方法',
  metric: '指标',
  artifact: '产物',
}

/** 知识视图：概念清单 + 关系列表。概念按类型分组，可过滤并按提及量排序。 */
export function KnowledgePane({ graph }: { graph: KnowledgeGraphDoc | null }) {
  const [activeType, setActiveType] = useState<KnowledgeNodeType | 'all'>('all')

  const groups = useMemo(() => {
    if (!graph) return []
    const nodes = activeType === 'all' ? graph.nodes : graph.nodes.filter((node) => node.type === activeType)
    return [...nodes].sort((a, b) => b.mention - a.mention || b.weight - a.weight)
  }, [activeType, graph])

  const labelOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of graph?.nodes || []) {
      map.set(node.id, node.label)
    }
    return map
  }, [graph])

  if (!graph || graph.nodes.length === 0) {
    return <EmptyState message="知识图谱还没生成完成。" />
  }

  const presentTypes = [...new Set(graph.nodes.map((node) => node.type))]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 px-6 py-3">
        <span className="label-eyebrow mr-1">概念</span>
        <TypeChip active={activeType === 'all'} label={`全部 ${graph.nodes.length}`} onClick={() => setActiveType('all')} />
        {presentTypes.map((type) => (
          <TypeChip
            key={type}
            active={activeType === type}
            label={`${TYPE_LABELS[type]} ${graph.nodes.filter((node) => node.type === type).length}`}
            onClick={() => setActiveType(type)}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <ul className="space-y-2">
            {groups.map((node) => (
              <li key={node.id} className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/40 px-3 py-2.5">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-[10px] text-text-muted">
                  {TYPE_LABELS[node.type].slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium text-text-strong">{node.label}</span>
                    <TimeAnchor seconds={node.start} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-text-subtle">
                    {TYPE_LABELS[node.type]}
                    <span className="mx-1.5">·</span>
                    提及 {node.mention} 次
                    {node.chapterIds.length > 0 ? (
                      <>
                        <span className="mx-1.5">·</span>
                        出现在 {node.chapterIds.length} 个章节
                      </>
                    ) : null}
                  </p>
                </div>
                <span
                  className="mt-1.5 h-1 w-10 shrink-0 overflow-hidden rounded-full bg-secondary"
                  title={`重要度 ${Math.round(node.weight * 100)}%`}
                >
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(node.weight * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>

          {graph.edges.length > 0 ? (
            <section>
              <span className="label-eyebrow">概念关系</span>
              <ul className="mt-3 space-y-2">
                {graph.edges.slice(0, 40).map((edge) => (
                  <li key={edge.id} className="text-[12px] leading-relaxed text-text-muted">
                    <span className="text-foreground/90">{labelOf.get(edge.source) || edge.source}</span>
                    <span className="mx-1.5 rounded bg-secondary px-1.5 py-px text-[10px] text-text-muted">
                      {edge.relation}
                    </span>
                    <span className="text-foreground/90">{labelOf.get(edge.target) || edge.target}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function TypeChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] transition-colors',
        active ? 'bg-secondary text-foreground' : 'text-text-muted hover:bg-secondary/60 hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
