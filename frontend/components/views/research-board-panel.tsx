"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import { ClipboardList, Copy, Download, Eraser, MapPin, MessageSquarePlus, NotebookPen, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatSecondsAsClock } from "@/lib/format"
import {
  buildResearchBoardMarkdown,
  clearResearchBoardItems,
  listResearchBoardItems,
  removeResearchBoardItem,
  type ResearchBoardItem,
  subscribeResearchBoard,
} from "@/lib/research-board"

interface ResearchBoardPanelProps {
  onSeek?: (seconds: number) => void
  onUseAsQuestion?: (item: ResearchBoardItem) => void
  onAppendToNotes?: (item: ResearchBoardItem) => void
}

export function ResearchBoardPanel({ onSeek, onUseAsQuestion, onAppendToNotes }: ResearchBoardPanelProps) {
  const [items, setItems] = React.useState(listResearchBoardItems)

  React.useEffect(() => subscribeResearchBoard(() => setItems(listResearchBoardItems())), [])

  const handleCopyMarkdown = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildResearchBoardMarkdown(items))
      toast.success("线索篮 Markdown 已复制")
    } catch {
      toast.error("复制线索篮 Markdown 失败")
    }
  }, [items])

  const handleDownloadMarkdown = React.useCallback(() => {
    const blob = new Blob([buildResearchBoardMarkdown(items)], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "vidgnost-clue-basket.md"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    toast.success("线索篮已导出为 Markdown")
  }, [items])

  if (items.length === 0) {
    return (
      <div className="research-board-pane flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <ClipboardList className="h-10 w-10 text-primary/45" />
        <p>线索篮还是空的。把值得继续追问、写进笔记或回跳视频的片段先收在这里，后面就不用反复翻找。</p>
      </div>
    )
  }

  return (
    <div className="research-board-pane flex h-full flex-col">
      <div className="research-board-header flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-medium">跨任务线索篮</h3>
          <p className="text-xs text-muted-foreground">统一收集证据、转写片段和笔记线索，方便继续提问、写回笔记或导出复盘。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void handleCopyMarkdown()}>
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制 Markdown
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDownloadMarkdown}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            导出
          </Button>
          <Button variant="ghost" size="sm" onClick={() => clearResearchBoardItems()}>
            <Eraser className="mr-1.5 h-3.5 w-3.5" />
            清空
          </Button>
        </div>
      </div>
      <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
        <div className="space-y-3 p-4">
          {items.map((item) => (
            <div key={item.id} className="workbench-collection-item rounded-2xl border border-border/70 bg-card/70 p-4">
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
                {onAppendToNotes ? (
                  <Button variant="outline" size="sm" onClick={() => onAppendToNotes(item)}>
                    <NotebookPen className="mr-1.5 h-3.5 w-3.5" />
                    写入笔记
                  </Button>
                ) : null}
                {onUseAsQuestion ? (
                  <Button variant="outline" size="sm" onClick={() => onUseAsQuestion(item)}>
                    <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
                    继续追问
                  </Button>
                ) : null}
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
