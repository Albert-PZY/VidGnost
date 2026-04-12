"use client"

import * as React from "react"
import { ClipboardList, Eraser, MapPin, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatSecondsAsClock } from "@/lib/format"
import {
  clearResearchBoardItems,
  listResearchBoardItems,
  removeResearchBoardItem,
  subscribeResearchBoard,
} from "@/lib/research-board"

interface ResearchBoardPanelProps {
  onSeek?: (seconds: number) => void
}

export function ResearchBoardPanel({ onSeek }: ResearchBoardPanelProps) {
  const [items, setItems] = React.useState(listResearchBoardItems)

  React.useEffect(() => subscribeResearchBoard(() => setItems(listResearchBoardItems())), [])

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <ClipboardList className="h-10 w-10 text-primary/45" />
        <p>研究板还是空的。你可以把转写片段、问答证据和笔记片段随时加入这里，跨任务复盘时会更顺手。</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-medium">跨任务研究板</h3>
          <p className="text-xs text-muted-foreground">集中保留值得继续追问的片段、证据和笔记。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => clearResearchBoardItems()}>
          <Eraser className="mr-1.5 h-3.5 w-3.5" />
          清空
        </Button>
      </div>
      <ScrollArea className="themed-thin-scrollbar flex-1">
        <div className="space-y-3 p-4">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{item.title}</span>
                    <Badge variant="outline">{item.type}</Badge>
                    <Badge variant="secondary">{item.workflow === "notes" ? "笔记整理" : "视频问答"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.taskTitle}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeResearchBoardItem(item.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {typeof item.start === "number" && (
                  <Button variant="outline" size="sm" onClick={() => onSeek?.(item.start || 0)}>
                    <MapPin className="mr-1.5 h-3.5 w-3.5" />
                    {formatSecondsAsClock(item.start)}
                  </Button>
                )}
                {item.source ? <Badge variant="outline">{item.source}</Badge> : null}
                {item.sourceSet?.map((entry) => (
                  <Badge key={`${item.id}-${entry}`} variant="secondary">
                    {entry}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
