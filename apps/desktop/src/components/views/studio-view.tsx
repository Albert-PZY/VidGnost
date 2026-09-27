import { useEffect, useMemo, useState } from 'react'
import {
  Clapperboard,
  Download,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Loader2,
  Network,
  RefreshCw,
  ScrollText,
  X,
} from 'lucide-react'

import type { KeyFrame } from '@vidgnost/contracts'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatTimecode, platformLabel, statusLabel } from '@/lib/format'
import { ChapterRail } from '@/components/studio/chapter-rail'
import { CopilotPane } from '@/components/studio/copilot-pane'
import { FramesPane } from '@/components/studio/frames-pane'
import { KnowledgePane } from '@/components/studio/knowledge-pane'
import { MindMapPane } from '@/components/studio/mindmap-pane'
import { NotesPane } from '@/components/studio/notes-pane'
import { PlayerBar } from '@/components/studio/player-bar'
import { ProcessingStrip } from '@/components/studio/processing-strip'
import { StageBoard } from '@/components/studio/stage-board'
import { TranscriptPane } from '@/components/studio/transcript-pane'
import { VideoBand } from '@/components/studio/video-band'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app-store'

type StudioTab = 'notes' | 'transcript' | 'mindmap' | 'knowledge' | 'frames'

const TABS: Array<{ icon: typeof FileText; id: StudioTab; label: string }> = [
  { id: 'notes', label: '笔记', icon: ScrollText },
  { id: 'transcript', label: '原文', icon: FileText },
  { id: 'mindmap', label: '导图', icon: Network },
  { id: 'knowledge', label: '概念', icon: GitBranch },
  { id: 'frames', label: '画面', icon: ImageIcon },
]

const MENU_CLASS =
  'absolute right-0 top-9 z-30 w-44 rounded-lg border border-border-strong bg-popover p-1 shadow-xl backdrop-blur-xl'

/** 工作台：章节结构 / 内容舞台 / Copilot 三栏 + 常驻播放条。 */
export function StudioView() {
  const task = useAppStore((state) => state.task)
  const artifacts = useAppStore((state) => state.artifacts)
  const rerunTask = useAppStore((state) => state.rerunTask)
  const cancelTask = useAppStore((state) => state.cancelTask)

  const [tab, setTab] = useState<StudioTab>('notes')
  const [videoVisible, setVideoVisible] = useState(true)
  const [detail, setDetail] = useState(false)

  useEffect(() => {
    setTab('notes')
    setVideoVisible(true)
    setDetail(false)
  }, [task?.id])

  const chapters = artifacts.outline?.chapters || []
  const frames = useMemo(
    () => (artifacts.frames as { frames?: KeyFrame[] } | null)?.frames || null,
    [artifacts.frames],
  )

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-note text-text-subtle">从资产库里打开一个任务。</p>
      </div>
    )
  }

  const processing = task.status === 'running' || task.status === 'queued'
  const hasVideo = Boolean(task.source.mediaPath) && !task.source.audioOnly
  const hasContent = Boolean(artifacts.transcript)

  if (detail || (!hasContent && processing)) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {hasContent ? (
          <button
            type="button"
            onClick={() => setDetail(false)}
            className="flex items-center gap-1.5 px-5 py-2 text-meta text-text-muted transition-colors hairline-b hover:text-foreground"
          >
            <X className="size-3.5" /> 关闭处理详情
          </button>
        ) : null}
        <StageBoard task={task} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-5 pb-2.5 pt-3.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-subhead font-semibold tracking-tight text-text-strong">{task.title}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-meta text-text-subtle">
            <span>{platformLabel(task.source.platform)}</span>
            <span>·</span>
            <span className="timecode">{formatTimecode(task.source.durationSeconds)}</span>
            <span>·</span>
            <span>{chapters.length} 章</span>
            {task.stats.transcriptEngine ? (
              <>
                <span>·</span>
                <span>{task.stats.transcriptEngine === 'faster-whisper' ? '本地 Whisper' : '在线转写'}</span>
              </>
            ) : null}
            <span>·</span>
            <span
              className={
                task.status === 'failed' ? 'text-destructive' : task.status === 'succeeded' ? 'text-success' : 'text-primary'
              }
            >
              {statusLabel(task.status)}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {hasVideo ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-meta"
              onClick={() => setVideoVisible((value) => !value)}
            >
              <Clapperboard className="size-3.5" />
              {videoVisible ? '收起画面' : '显示画面'}
            </Button>
          ) : null}
          <details className="group relative">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border/70 px-3 text-meta text-text-muted transition-colors hover:border-border-strong hover:text-foreground [&::-webkit-details-marker]:hidden">
              <Download className="size-3.5" /> 导出
            </summary>
            <div className={MENU_CLASS}>
              {[
                { format: 'md', label: 'Markdown 报告' },
                { format: 'json', label: 'JSON 数据包' },
                { format: 'srt', label: 'SRT 字幕' },
                { format: 'mmd', label: 'Mermaid 导图' },
                { format: 'txt', label: '纯文本转写' },
              ].map((item) => (
                <a
                  key={item.format}
                  href={api.exportUrl(task.id, item.format)}
                  download
                  className="block rounded px-2.5 py-1.5 text-note text-text-muted transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </details>
          {processing ? (
            <Button variant="ghost" size="sm" className="h-8 text-meta" onClick={() => void cancelTask()}>
              取消
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-meta"
            onClick={() => void rerunTask()}
            disabled={processing}
          >
            {processing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            重跑
          </Button>
        </div>
      </div>

      {task.status !== 'succeeded' ? (
        <ProcessingStrip task={task} expanded={false} onToggle={() => setDetail(true)} />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[14.25rem_minmax(0,1fr)_22.25rem]">
        <ChapterRail chapters={chapters} />

        <main className="flex min-h-0 flex-col">
          {hasVideo && videoVisible ? <VideoBand chapters={chapters} taskId={task.id} /> : null}

          {/* 字号放大后中间栏会变窄，页签必须能换行，否则会横向溢出把内容挤出去。 */}
          <div className="flex shrink-0 flex-wrap items-center gap-0.5 px-5 pt-3">
            {TABS.map((item) => {
              const Icon = item.icon
              const disabled = item.id === 'frames' && !frames?.length
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-note transition-colors',
                    tab === item.id
                      ? 'bg-secondary text-foreground'
                      : 'text-text-muted hover:bg-secondary/50 hover:text-foreground',
                    disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.8} />
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === 'notes' ? (
              <div className="h-full overflow-y-auto">
                <NotesPane outline={artifacts.outline} summary={artifacts.summary} />
              </div>
            ) : null}
            {tab === 'transcript' ? <TranscriptPane transcript={artifacts.transcript} /> : null}
            {tab === 'mindmap' ? <MindMapPane mindmap={artifacts.mindmap} /> : null}
            {tab === 'knowledge' ? <KnowledgePane graph={artifacts.knowledge} /> : null}
            {tab === 'frames' ? <FramesPane frames={frames} taskId={task.id} /> : null}
          </div>
        </main>

        <CopilotPane />
      </div>

      {hasVideo ? <PlayerBar chapters={chapters} /> : null}
    </div>
  )
}
