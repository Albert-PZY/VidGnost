"use client"

import * as React from "react"
import { toast } from "react-hot-toast"
import { BookMarked, Download, Loader2, Pencil, Plus, Save, Tag, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  createTaskStudyExport,
  createKnowledgeNote,
  deleteKnowledgeNote,
  downloadTaskArtifactFile,
  getApiErrorMessage,
  listKnowledgeNotes,
  updateKnowledgeNote,
} from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import {
  buildKnowledgeLibraryExportDocument,
  buildKnowledgeNoteCreatePayload,
  buildKnowledgeNoteUpdatePayload,
  formatStudyTimeRangeLabel,
  normalizeKnowledgeLibrary,
  resolveKnowledgeNoteContext,
  type NormalizedKnowledgeNote,
  type NormalizedStudyWorkspace,
} from "@/lib/study-workbench"
import type { KnowledgeNoteItem } from "@/lib/types"

interface KnowledgeViewProps {
  taskId?: string | null
  workspace?: NormalizedStudyWorkspace | null
  onOpenTask?: (taskId: string) => void
}

type KnowledgeSourceFilter = KnowledgeNoteItem["source_kind"] | "all"

const SOURCE_KIND_OPTIONS: Array<{ value: KnowledgeSourceFilter; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "highlight", label: "重点片段" },
  { value: "quote", label: "关键引用" },
  { value: "summary", label: "学习总结" },
  { value: "qa_answer", label: "问答回答" },
  { value: "transcript", label: "转写摘录" },
  { value: "manual", label: "手工整理" },
]

function createEmptyDraft(themeId: string | null) {
  return {
    id: "",
    title: "",
    excerpt: "",
    noteMarkdown: "",
    sourceKind: "manual" as KnowledgeNoteItem["source_kind"],
    studyThemeId: themeId,
    tags: "",
  }
}

function downloadGeneratedFile(input: {
  fileName: string
  mimeType: string
  content: string
}) {
  const blob = new Blob([input.content], { type: input.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = input.fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function renderKnowledgeContextSummary(note: Pick<
  NormalizedKnowledgeNote,
  "sourceStartSeconds" | "sourceEndSeconds" | "sourceReferenceLabel" | "sourceReferenceId"
>): string | null {
  const timeLabel = formatStudyTimeRangeLabel(note.sourceStartSeconds, note.sourceEndSeconds)
  const referenceLabel = note.sourceReferenceLabel || note.sourceReferenceId
  if (timeLabel && referenceLabel) {
    return `${referenceLabel} · ${timeLabel}`
  }
  return referenceLabel || timeLabel
}

export function KnowledgeView({ taskId = null, workspace = null, onOpenTask }: KnowledgeViewProps) {
  const effectiveTaskId = taskId?.trim() || ""
  const defaultContext = React.useMemo(() => resolveKnowledgeNoteContext(workspace), [workspace])
  const [notes, setNotes] = React.useState<NormalizedKnowledgeNote[]>([])
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isExporting, setIsExporting] = React.useState(false)
  const [sourceFilter, setSourceFilter] = React.useState<KnowledgeSourceFilter>("all")
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(() => createEmptyDraft(workspace?.studyState.selectedThemeId || null))
  const sourceFilterLabel = React.useMemo(
    () => SOURCE_KIND_OPTIONS.find((option) => option.value === sourceFilter)?.label || "全部来源",
    [sourceFilter],
  )
  const normalizedSourceFilter = sourceFilter === "all" ? undefined : sourceFilter

  const loadNotes = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await listKnowledgeNotes({
        task_id: effectiveTaskId || undefined,
        source_kind: normalizedSourceFilter,
        limit: 100,
      })
      const normalized = normalizeKnowledgeLibrary(response)
      setNotes(normalized.items)
      setTotal(normalized.total)
    } catch (error) {
      toast.error(getApiErrorMessage(error, "加载知识卡片失败"))
    } finally {
      setIsLoading(false)
    }
  }, [effectiveTaskId, normalizedSourceFilter])

  const loadAllNotesForExport = React.useCallback(async () => {
    const collected: NormalizedKnowledgeNote[] = []
    let offset = 0
    let expectedTotal = 0

    while (offset === 0 || collected.length < expectedTotal) {
      const response = await listKnowledgeNotes({
        task_id: effectiveTaskId || undefined,
        source_kind: normalizedSourceFilter,
        limit: 200,
        offset,
      })
      const normalized = normalizeKnowledgeLibrary(response)
      expectedTotal = normalized.total
      if (normalized.items.length === 0) {
        break
      }
      collected.push(...normalized.items)
      offset += normalized.items.length
      if (normalized.items.length < 200) {
        break
      }
    }

    return collected
  }, [effectiveTaskId, normalizedSourceFilter])

  React.useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  React.useEffect(() => {
    if (!editorOpen) {
      setDraft(createEmptyDraft(workspace?.studyState.selectedThemeId || null))
    }
  }, [editorOpen, workspace?.studyState.selectedThemeId])

  const themeOptions = workspace?.studyPack.themes ?? []
  const selectableThemeOptions = React.useMemo(() => {
    if (!draft.studyThemeId || themeOptions.some((theme) => theme.id === draft.studyThemeId)) {
      return themeOptions
    }
    return [
      ...themeOptions,
      {
        id: draft.studyThemeId,
        title: draft.studyThemeId,
        summary: "",
        order: themeOptions.length,
      },
    ]
  }, [draft.studyThemeId, themeOptions])

  const openCreateDialog = React.useCallback(() => {
    setDraft(createEmptyDraft(workspace?.studyState.selectedThemeId || null))
    setEditorOpen(true)
  }, [workspace?.studyState.selectedThemeId])

  const openEditDialog = React.useCallback((note: NormalizedKnowledgeNote) => {
    setDraft({
      id: note.id,
      title: note.title,
      excerpt: note.excerpt,
      noteMarkdown: note.noteMarkdown || "",
      sourceKind: note.sourceKind as KnowledgeNoteItem["source_kind"],
      studyThemeId: note.studyThemeId,
      tags: note.tags.join(", "),
    })
    setEditorOpen(true)
  }, [])

  const handleSave = React.useCallback(async () => {
    if (!effectiveTaskId) {
      toast.error("请先打开一个具体任务，再创建知识卡片")
      return
    }
    const title = draft.title.trim()
    const excerpt = draft.excerpt.trim()
    if (!title || !excerpt) {
      toast.error("请至少填写标题和摘录")
      return
    }
    setIsSaving(true)
    try {
      const tags = draft.tags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
      if (draft.id) {
        await updateKnowledgeNote(
          draft.id,
          buildKnowledgeNoteUpdatePayload({
            title,
            excerpt,
            noteMarkdown: draft.noteMarkdown.trim() || null,
            studyThemeId: draft.studyThemeId,
            tags,
          }),
        )
        toast.success("知识卡片已更新")
      } else {
        await createKnowledgeNote(buildKnowledgeNoteCreatePayload({
          taskId: effectiveTaskId,
          title,
          excerpt,
          noteMarkdown: draft.noteMarkdown.trim() || null,
          sourceKind: draft.sourceKind,
          studyThemeId: draft.studyThemeId,
          sourceStartSeconds: defaultContext.sourceStartSeconds,
          sourceEndSeconds: defaultContext.sourceEndSeconds,
          sourceReferenceId: defaultContext.sourceReferenceId,
          sourceReferenceLabel: defaultContext.sourceReferenceLabel,
          tags,
        }))
        toast.success("知识卡片已创建")
      }
      setEditorOpen(false)
      await loadNotes()
    } catch (error) {
      toast.error(getApiErrorMessage(error, draft.id ? "更新知识卡片失败" : "创建知识卡片失败"))
    } finally {
      setIsSaving(false)
    }
  }, [defaultContext, draft, effectiveTaskId, loadNotes])

  const handleDelete = React.useCallback(async (noteId: string) => {
    try {
      await deleteKnowledgeNote(noteId)
      toast.success("知识卡片已删除")
      await loadNotes()
    } catch (error) {
      toast.error(getApiErrorMessage(error, "删除知识卡片失败"))
    }
  }, [loadNotes])

  const handleExport = React.useCallback(async () => {
    setIsExporting(true)
    try {
      if (effectiveTaskId) {
        const createdExport = await createTaskStudyExport(effectiveTaskId, {
          export_kind: "knowledge_notes",
        })
        await downloadTaskArtifactFile(effectiveTaskId, createdExport.file_path)
        await loadNotes()
        toast.success("知识笔记导出完成，文件已开始下载")
        return
      }

      const exportNotes = await loadAllNotesForExport()
      const exportDocument = buildKnowledgeLibraryExportDocument({
        exportedAt: new Date().toISOString(),
        scopeLabel: "全部任务",
        sourceFilterLabel,
        notes: exportNotes,
      })
      downloadGeneratedFile(exportDocument)
      toast.success(`已导出当前筛选结果，共 ${exportNotes.length} 张知识卡片`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, effectiveTaskId ? "创建知识笔记导出失败" : "导出当前筛选结果失败"))
    } finally {
      setIsExporting(false)
    }
  }, [effectiveTaskId, loadAllNotesForExport, loadNotes, sourceFilterLabel])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Knowledge</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {effectiveTaskId
              ? "围绕当前任务沉淀可复用的学习卡片。新建时会自动附带当前 Study 上下文。"
              : "按全部任务汇总已保存的知识卡片，可作为跨任务知识库浏览。当前筛选结果会在前端整理后直接下载。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as KnowledgeSourceFilter)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="来源过滤" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_KIND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={isExporting || isLoading}
            onClick={() => void handleExport()}
            title={effectiveTaskId ? "导出当前任务的 knowledge_notes" : "导出当前筛选结果，不写入后端导出记录"}
          >
            {isExporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            {effectiveTaskId ? "导出当前任务笔记" : "导出当前筛选结果"}
          </Button>
          {effectiveTaskId ? (
            <Button size="sm" onClick={openCreateDialog}>
              <Plus className="mr-1.5 h-4 w-4" />
              新建卡片
            </Button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="themed-thin-scrollbar h-full min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <div className="rounded-2xl border border-border/70 bg-card/65 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">{effectiveTaskId ? "当前任务" : "全部任务"}</Badge>
              <Badge variant="secondary">{total} 张知识卡片</Badge>
              {workspace?.studyPack.themes.length ? <Badge variant="secondary">{workspace.studyPack.themes.length} 个主题</Badge> : null}
              {effectiveTaskId ? <Badge variant="outline">自动附带当前 Study 上下文</Badge> : null}
            </div>
            {effectiveTaskId ? (
              <p className="mt-3 text-xs text-muted-foreground">
                当前默认上下文：
                {renderKnowledgeContextSummary({
                  sourceStartSeconds: defaultContext.sourceStartSeconds,
                  sourceEndSeconds: defaultContext.sourceEndSeconds,
                  sourceReferenceId: defaultContext.sourceReferenceId,
                  sourceReferenceLabel: defaultContext.sourceReferenceLabel,
                }) || "将使用当前任务与主题关系创建卡片。"}
              </p>
            ) : null}
          </div>

          {isLoading ? (
            <div className="workbench-pane-state flex items-center justify-center rounded-2xl border border-border/70 bg-card/65 p-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载知识卡片...
            </div>
          ) : notes.length === 0 ? (
            <div className="workbench-pane-state rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              当前还没有沉淀知识卡片。可以先从 Study 里挑出重点，再在这里创建可复用的学习记录。
            </div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded-2xl border border-border/70 bg-card/65 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 text-primary">
                        <BookMarked className="h-4 w-4" />
                      </div>
                      <div className="text-sm font-semibold">{note.title}</div>
                      {!effectiveTaskId ? <Badge variant="secondary">{note.taskId}</Badge> : null}
                      <Badge variant="outline">{note.sourceKind}</Badge>
                      {note.studyThemeId ? <Badge variant="secondary">{note.studyThemeId}</Badge> : null}
                      {note.sourceReferenceLabel ? <Badge variant="outline">{note.sourceReferenceLabel}</Badge> : null}
                    </div>
                    {renderKnowledgeContextSummary(note) ? (
                      <div className="text-xs text-muted-foreground">
                        上下文定位：{renderKnowledgeContextSummary(note)}
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{note.excerpt}</p>
                    {note.noteMarkdown ? (
                      <div className="rounded-xl border border-border/60 bg-background/55 p-3 text-sm leading-6">
                        {note.noteMarkdown}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>创建于 {formatDateTime(note.createdAt)}</span>
                      <span>更新于 {formatDateTime(note.updatedAt)}</span>
                    </div>
                    {note.tags.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {note.tags.map((tag) => (
                          <Badge key={`${note.id}-${tag}`} variant="secondary">
                            <Tag className="mr-1 h-3 w-3" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {!effectiveTaskId && onOpenTask ? (
                      <Button variant="outline" size="sm" onClick={() => onOpenTask(note.taskId)}>
                        打开任务
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(note)}>
                      <Pencil className="mr-1.5 h-4 w-4" />
                      编辑
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleDelete(note.id)}>
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft.id ? "编辑知识卡片" : "新建知识卡片"}</DialogTitle>
            <DialogDescription>
              将学习重点沉淀为可复用卡片，便于后续检索、复习与扩写。当前任务下会自动附带当前 Study 上下文。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {effectiveTaskId ? (
              <div className="rounded-xl border border-border/60 bg-background/55 p-3 text-xs text-muted-foreground">
                上下文定位：{renderKnowledgeContextSummary({
                  sourceStartSeconds: defaultContext.sourceStartSeconds,
                  sourceEndSeconds: defaultContext.sourceEndSeconds,
                  sourceReferenceId: defaultContext.sourceReferenceId,
                  sourceReferenceLabel: defaultContext.sourceReferenceLabel,
                }) || "将使用当前任务与主题关系创建卡片。"}
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium">标题</div>
                <Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="例如：这段视频的核心观点" />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">来源类型</div>
                <Select value={draft.sourceKind} onValueChange={(value) => setDraft((current) => ({ ...current, sourceKind: value as KnowledgeNoteItem["source_kind"] }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_KIND_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">摘录</div>
              <Textarea value={draft.excerpt} onChange={(event) => setDraft((current) => ({ ...current, excerpt: event.target.value }))} rows={4} placeholder="写下这张卡片的核心摘录内容" />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">补充笔记</div>
              <Textarea value={draft.noteMarkdown} onChange={(event) => setDraft((current) => ({ ...current, noteMarkdown: event.target.value }))} rows={6} placeholder="可补充上下文、延伸理解或行动要点" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-medium">关联主题</div>
                <Select
                  value={draft.studyThemeId ?? "__none__"}
                  onValueChange={(value) => setDraft((current) => ({ ...current, studyThemeId: value === "__none__" ? null : value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不关联主题</SelectItem>
                    {selectableThemeOptions.map((theme) => (
                      <SelectItem key={theme.id} value={theme.id}>
                        {theme.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">标签</div>
                <Input value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="用逗号分隔，例如：重点,复习" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button disabled={isSaving} onClick={() => void handleSave()}>
              {isSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
