import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import type { CustomModelEntry, ModelKind, ProviderConfig, ProviderModelUpsertRequest } from '@vidgnost/contracts'

import { ApiError } from '@/lib/api'
import { KIND_LABELS } from '@/lib/model-groups'
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

/**
 * 在渠道下登记模型。
 *
 * 能力类型由所在的类别决定，因此不再让用户重选一次；向量维度只对向量化模型有意义，
 * 其余情况下不出现。模型 ID 是发给提供方的名称，编辑时不允许改名——
 * 改名等于换一个模型，应该新增后再移除旧的。
 */
export function ModelDialog({
  kind,
  mode,
  model,
  onOpenChange,
  onSubmit,
  open,
  provider,
}: {
  kind: ModelKind
  mode: 'create' | 'edit'
  model?: CustomModelEntry
  onOpenChange: (open: boolean) => void
  onSubmit: (modelId: string, input: ProviderModelUpsertRequest) => Promise<void>
  open: boolean
  provider: ProviderConfig
}) {
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [dimensions, setDimensions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setError(null)
    setBusy(false)
    setId(model?.id ?? '')
    setLabel(model?.label ?? '')
    setContextWindow(model?.contextWindow ? String(model.contextWindow) : '')
    setDimensions(model?.dimensions ? String(model.dimensions) : '')
  }, [model, open])

  const canSubmit = id.trim().length > 0 && !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    const parsedContext = Number(contextWindow)
    const parsedDimensions = Number(dimensions)
    try {
      await onSubmit(id.trim(), {
        label: label.trim() || id.trim(),
        kind,
        contextWindow: contextWindow.trim() && Number.isFinite(parsedContext) ? parsedContext : undefined,
        dimensions:
          kind === 'embedding' && dimensions.trim() && Number.isFinite(parsedDimensions)
            ? parsedDimensions
            : undefined,
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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{mode === 'edit' ? '编辑模型' : '接入模型'}</DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">
            登记在 {provider.label} 下，能力类型为{KIND_LABELS[kind]}。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-text-muted">模型 ID</Label>
            <Input
              autoFocus={mode === 'create'}
              readOnly={mode === 'edit'}
              value={id}
              onChange={(event) => setId(event.target.value)}
              placeholder="发给提供方的模型名，例如 qwen2.5-72b-instruct"
              className="timecode h-8 text-[11px] read-only:text-text-muted"
            />
            <p className="text-[10px] text-text-subtle">
              {mode === 'edit' ? '模型 ID 是调用时的名称，不能改名。' : '必须与提供方文档里的模型名完全一致。'}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-text-muted">显示名</Label>
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="留空则与模型 ID 相同"
              className="h-8 text-[12px]"
            />
          </div>

          <div className={kind === 'embedding' ? 'grid grid-cols-2 gap-3' : ''}>
            <div className="space-y-1">
              <Label className="text-[11px] text-text-muted">上下文长度</Label>
              <Input
                value={contextWindow}
                onChange={(event) => setContextWindow(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="可选，例如 131072"
                className="h-8 text-[11px]"
              />
            </div>
            {kind === 'embedding' ? (
              <div className="space-y-1">
                <Label className="text-[11px] text-text-muted">向量维度</Label>
                <Input
                  value={dimensions}
                  onChange={(event) => setDimensions(event.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="例如 1024"
                  className="h-8 text-[11px]"
                />
              </div>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-foreground">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
