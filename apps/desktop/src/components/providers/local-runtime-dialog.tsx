import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { ApiError } from '@/lib/api'
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
import { useAppStore } from '@/stores/app-store'

/**
 * 本地运行时的转写参数。
 *
 * 这些字段属于本机运行时，与在线渠道的 Base URL、密钥无关，因此单独一个入口；
 * 五项一次提交，避免每改一个字段就落一次盘。
 */
export function LocalRuntimeDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const settings = useAppStore((state) => state.settings)
  const saveSettings = useAppStore((state) => state.saveSettings)

  const [model, setModel] = useState('')
  const [modelDir, setModelDir] = useState('')
  const [device, setDevice] = useState('auto')
  const [computeType, setComputeType] = useState('int8')
  const [pythonExecutable, setPythonExecutable] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !settings) {
      return
    }
    setError(null)
    setBusy(false)
    setModel(settings.whisper.model)
    setModelDir(settings.whisper.modelDir)
    setDevice(settings.whisper.device)
    setComputeType(settings.whisper.computeType)
    setPythonExecutable(settings.whisper.pythonExecutable)
  }, [open, settings])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await saveSettings({
        settings: {
          whisper: { computeType, device, model, modelDir, pythonExecutable },
        },
      })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">本地运行时</DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">
            faster-whisper 在本机推理，不需要密钥。模型目录指向 CTranslate2 格式的模型文件夹；
            留空表示尚未准备好离线转写。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-text-muted">模型标识</Label>
            <Input value={model} onChange={(event) => setModel(event.target.value)} className="h-8 text-[11px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-text-muted">推理设备</Label>
            <select
              value={device}
              onChange={(event) => setDevice(event.target.value)}
              className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[11px] text-foreground outline-none"
            >
              <option value="auto">自动</option>
              <option value="cpu">CPU</option>
              <option value="cuda">CUDA</option>
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[11px] text-text-muted">模型目录（CTranslate2）</Label>
            <Input
              value={modelDir}
              onChange={(event) => setModelDir(event.target.value)}
              placeholder="例如 D:\\models\\faster-whisper-large-v3"
              className="timecode h-8 text-[11px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-text-muted">计算精度</Label>
            <select
              value={computeType}
              onChange={(event) => setComputeType(event.target.value)}
              className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[11px] text-foreground outline-none"
            >
              {['int8', 'int8_float16', 'float16', 'float32'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-text-muted">Python 可执行文件</Label>
            <Input
              value={pythonExecutable}
              onChange={(event) => setPythonExecutable(event.target.value)}
              placeholder="留空则从 PATH 查找"
              className="h-8 text-[11px]"
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-foreground">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
