import { useEffect, useState } from 'react'
import { FileVideo, Link2, Loader2, Plus } from 'lucide-react'

import type { TaskOptions } from '@vidgnost/contracts'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const PRESETS: Array<{ description: string; id: TaskOptions['preset']; label: string }> = [
  { id: 'fast', label: '快速', description: '只要转写、章节与摘要，跳过画面理解' },
  { id: 'balanced', label: '均衡', description: '默认档，产出完整知识资产' },
  { id: 'deep', label: '深度', description: '开启校对与画面理解，耗时更长' },
]

/**
 * 新建任务：一个输入框承接本地路径与远程链接两种来源，
 * 一次提交只创建一个任务，失败时保留已填内容。
 */
export function NewTaskDialog({
  onOpenChange,
  onSubmit,
  open,
  submitting,
}: {
  onOpenChange: (open: boolean) => void
  onSubmit: (input: { source: string; options: Partial<TaskOptions> }) => Promise<void>
  open: boolean
  submitting: boolean
}) {
  const [source, setSource] = useState('')
  const [preset, setPreset] = useState<TaskOptions['preset']>('balanced')
  const [asr, setAsr] = useState<TaskOptions['asr']>('auto')
  const [vision, setVision] = useState(false)
  const [proofread, setProofread] = useState(false)
  const [language, setLanguage] = useState('auto')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setError(null)
    }
  }, [open])

  const bridge = typeof window !== 'undefined' ? window.vidGnostDesktop : undefined

  const submit = async () => {
    const value = source.trim()
    if (!value) {
      setError('请填写本地文件路径或视频链接。')
      return
    }
    try {
      await onSubmit({
        source: value,
        options: { preset, asr, vision, proofread, language, translateTo: null },
      })
      setSource('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,94vw)] gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pb-3 pt-4">
          <DialogTitle className="text-[15px] font-semibold">新建处理任务</DialogTitle>
          <DialogDescription className="text-[12px] text-text-muted">
            支持本地视频 / 音频文件的绝对路径，也支持 YouTube、Bilibili 与直链视频地址。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 pb-4">
          <div className="space-y-2">
            <Label htmlFor="task-source" className="text-[12px] text-text-muted">
              来源
            </Label>
            <Textarea
              id="task-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void submit()
                }
              }}
              rows={2}
              placeholder="F:\videos\lecture.mp4 或 https://www.bilibili.com/video/BV..."
              className="resize-none text-[12px]"
            />
            <div className="flex flex-wrap items-center gap-2">
              {bridge ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={async () => {
                    const result = await bridge.pickMediaFile()
                    if (!result.canceled && result.path) {
                      setSource(result.path)
                    }
                  }}
                >
                  <FileVideo className="size-3.5" /> 选择本地文件
                </Button>
              ) : null}
              <span className="inline-flex items-center gap-1 text-[11px] text-text-subtle">
                <Link2 className="size-3" /> 链接会先由 yt-dlp 下载再处理
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[12px] text-text-muted">处理预设</span>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setPreset(item.id)
                    if (item.id === 'deep') {
                      setVision(true)
                      setProofread(true)
                    }
                  }}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition-colors',
                    preset === item.id
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-border/70 hover:border-border-strong hover:bg-secondary/50',
                  )}
                >
                  <span className="block text-[12px] font-medium text-foreground">{item.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-text-subtle">{item.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="space-y-2">
              <Label htmlFor="task-language" className="text-[12px] text-text-muted">
                语言
              </Label>
              <Input
                id="task-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                placeholder="auto / zh / en"
                className="h-8 text-[12px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-asr" className="text-[12px] text-text-muted">
                转写引擎
              </Label>
              <div className="flex h-8 items-center gap-1 rounded-md border border-border/70 p-0.5">
                {(['auto', 'online', 'local'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setAsr(item)}
                    className={cn(
                      'h-full flex-1 rounded text-[11px] transition-colors',
                      asr === item ? 'bg-secondary text-foreground' : 'text-text-muted hover:text-foreground',
                    )}
                  >
                    {item === 'auto' ? '自动' : item === 'online' ? '在线' : '本地'}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <span>
                <span className="block text-[12px] text-foreground">画面理解</span>
                <span className="block text-[10px] text-text-subtle">抽关键帧并做多模态图注</span>
              </span>
              <Switch checked={vision} onCheckedChange={setVision} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
              <span>
                <span className="block text-[12px] text-foreground">转写校对</span>
                <span className="block text-[10px] text-text-subtle">修正同音错字与术语写法</span>
              </span>
              <Switch checked={proofread} onCheckedChange={setProofread} />
            </label>
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 px-5 py-3 hairline-t sm:justify-between">
          <span className="text-[10px] text-text-subtle">Ctrl/⌘ + Enter 快速提交</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-8 text-[12px]">
              取消
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={submitting} className="h-8 gap-1.5 text-[12px]">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              开始处理
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
