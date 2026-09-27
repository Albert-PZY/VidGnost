import { useState } from 'react'
import { Network } from 'lucide-react'

import type { MindMapDoc, MindNode } from '@vidgnost/contracts'

import { cn } from '@/lib/utils'
import { formatTimecode } from '@/lib/format'
import { MermaidBlock } from '@/components/studio/mermaid-block'
import { EmptyState } from '@/components/studio/notes-pane'
import { usePlayerStore } from '@/stores/player-store'
import { useAppearanceStore } from '@/stores/appearance-store'

/** 导图视图：图形化导图 + 可访问的层级列表两种等价呈现。 */
export function MindMapPane({ mindmap }: { mindmap: MindMapDoc | null }) {
  const [mode, setMode] = useState<'graph' | 'outline'>('graph')
  const theme = useAppearanceStore((state) => state.resolved)

  if (!mindmap) {
    return <EmptyState message="思维导图还没生成完成。" />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-6 py-3">
        <span className="label-eyebrow">思维导图</span>
        <span className="text-micro text-text-subtle">{mindmap.generatedBy}</span>
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border/70 p-0.5">
          {(['graph', 'outline'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={cn(
                'rounded px-2.5 py-1 text-meta transition-colors',
                mode === item ? 'bg-secondary text-foreground' : 'text-text-muted hover:text-foreground',
              )}
            >
              {item === 'graph' ? '图形' : '层级'}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-8">
        {mode === 'graph' ? (
          <div className="rounded-xl border border-border/60 bg-card/40 p-4">
            <MermaidBlock source={mindmap.mermaid} theme={theme} />
          </div>
        ) : (
          <div className="mx-auto max-w-[47.5rem]">
            <MindNodeList node={mindmap.root} depth={0} />
          </div>
        )}
      </div>
    </div>
  )
}

function MindNodeList({ depth, node }: { depth: number; node: MindNode }) {
  const seek = usePlayerStore((state) => state.seek)
  const heading = depth === 0 ? 'text-subhead font-semibold text-text-strong' : depth === 1 ? 'text-body font-medium text-foreground' : 'text-note text-text-muted'

  return (
    <div className={cn(depth > 0 && 'border-l border-border/60 pl-4', depth === 0 ? 'mb-2' : 'mt-2')}>
      <div className="flex items-baseline gap-2">
        <span className={heading}>{node.label}</span>
        {node.start !== undefined ? (
          <button
            type="button"
            onClick={() => seek(node.start as number)}
            className="timecode rounded px-1 text-micro text-text-subtle transition-colors hover:bg-secondary hover:text-timestamp"
          >
            {formatTimecode(node.start)}
          </button>
        ) : null}
      </div>
      {node.note ? <p className="mt-1 text-meta text-text-subtle">{node.note}</p> : null}
      {(node.children || []).map((child) => (
        <MindNodeList key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export { Network }
