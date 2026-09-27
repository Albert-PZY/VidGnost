import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import type { ProviderConfig, ProviderCreateRequest, ProviderPatchRequest, ProviderProtocolInfo } from '@vidgnost/contracts'

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

/** 名称的占位示例按协议给，避免在 Gemini 的表单里提示「Claude 官方」。 */
const NAME_HINTS: Record<ProviderProtocolInfo['protocol'], string> = {
  openai: '例如：内网 vLLM',
  anthropic: '例如：Claude 官方',
  gemini: '例如：Gemini 官方',
  dashscope: '例如：百炼（备用账号）',
  openrouter: '例如：OpenRouter（备用）',
  local: '例如：本机 whisper',
}

/**
 * 接入渠道 / 渠道设置。
 *
 * 渠道是「协议 + Base URL + 密钥」这一份连接信息，协议在接入时选定。
 * 接入入口挂在协议分组下，因此新建时协议已经确定，不再让用户重填一遍。
 */
export function ChannelDialog({
  mode,
  onDelete,
  onOpenChange,
  onSubmit,
  open,
  protocol,
  protocols,
  provider,
}: {
  mode: 'create' | 'edit'
  /** 仅编辑自定义渠道时提供：移除渠道并连同其模型。 */
  onDelete?: () => Promise<void>
  onOpenChange: (open: boolean) => void
  onSubmit: (input: ProviderCreateRequest | ProviderPatchRequest) => Promise<void>
  open: boolean
  protocol: ProviderProtocolInfo
  protocols: ProviderProtocolInfo[]
  provider?: ProviderConfig
}) {
  const [label, setLabel] = useState('')
  const [selected, setSelected] = useState(protocol.protocol)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    setError(null)
    setBusy(false)
    setConfirmRemove(false)
    setApiKey('')
    setClearKey(false)
    if (mode === 'edit' && provider) {
      setLabel(provider.label)
      setSelected(provider.protocol)
      setBaseUrl(provider.baseUrl)
      setEnabled(provider.enabled)
    } else {
      setLabel('')
      setSelected(protocol.protocol)
      setBaseUrl(protocol.defaultBaseUrl)
      setEnabled(true)
    }
  }, [mode, open, protocol, provider])

  const current = protocols.find((item) => item.protocol === selected) ?? protocol
  const isBuiltin = Boolean(provider?.builtin)
  const canSubmit = label.trim().length > 0 && !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'edit' && provider) {
        const patch: ProviderPatchRequest = {
          id: provider.id,
          label: label.trim(),
          baseUrl: baseUrl.trim(),
          enabled,
        }
        if (!isBuiltin) {
          patch.protocol = selected
        }
        if (apiKey.trim()) {
          patch.apiKey = apiKey.trim()
        } else if (clearKey) {
          patch.apiKey = null
        }
        await onSubmit(patch)
      } else {
        await onSubmit({
          label: label.trim(),
          protocol: selected,
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
        })
      }
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{mode === 'edit' ? '渠道设置' : '接入渠道'}</DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">
            {mode === 'edit'
              ? 'Base URL 与密钥属于整个渠道，这里的改动会影响该渠道下的所有模型。'
              : `填写 ${protocol.label} 端点的连接信息。密钥只保存在本机配置里，界面上只显示尾码。`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="名称">
            <Input
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={NAME_HINTS[protocol.protocol]}
              className="h-8 text-[12px]"
            />
          </Field>

          <Field label="协议">
            {isBuiltin ? (
              <p className="text-[11px] text-text-muted">
                {current.label}（内置渠道的协议固定）
              </p>
            ) : (
              <select
                value={selected}
                onChange={(event) => {
                  const next = protocols.find((item) => item.protocol === event.target.value)
                  setSelected(event.target.value as ProviderProtocolInfo['protocol'])
                  if (next && !baseUrl.trim()) {
                    setBaseUrl(next.defaultBaseUrl)
                  }
                }}
                className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[12px] text-foreground outline-none"
              >
                {protocols.map((item) => (
                  <option key={item.protocol} value={item.protocol}>
                    {item.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {selected !== 'local' ? (
            <>
              <Field label="Base URL">
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={current.defaultBaseUrl}
                  className="timecode h-8 text-[11px]"
                />
              </Field>

              <Field label="API Key">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value)
                    setClearKey(false)
                  }}
                  placeholder={
                    provider?.credentialStatus.origin === 'inline'
                      ? `已保存 ${provider.credentialStatus.masked}，留空表示不改动`
                      : provider?.auth.envVar
                        ? `留空则读取环境变量 ${provider.auth.envVar}`
                        : '粘贴密钥'
                  }
                  className="h-8 text-[12px]"
                />
              </Field>

              {provider?.credentialStatus.origin === 'inline' && !apiKey.trim() ? (
                <button
                  type="button"
                  onClick={() => setClearKey((value) => !value)}
                  className="text-[11px] text-text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  {clearKey ? '已选择清除内联密钥，提交后改读环境变量' : '清除内联密钥，改读环境变量'}
                </button>
              ) : null}
            </>
          ) : (
            <p className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-[11px] text-text-muted">
              本地运行时不需要 Base URL 与密钥，转写参数在下方「本地运行时」块里设置。
            </p>
          )}

          {mode === 'edit' ? (
            <label className="flex items-center gap-2 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="size-3.5 accent-[var(--primary)]"
              />
              启用该渠道（停用后引用它的角色会调用失败）
            </label>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-foreground">
              {error}
            </p>
          ) : null}

          {mode === 'edit' && onDelete && !isBuiltin ? (
            <div className="hairline-t pt-3">
              {confirmRemove ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-text-muted">
                    该渠道下已登记的模型会一起消失，引用它们的角色需要重新分配。
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      setError(null)
                      try {
                        await onDelete()
                        onOpenChange(false)
                      } catch (cause) {
                        setError(cause instanceof ApiError ? cause.message : '移除失败，请重试。')
                        setConfirmRemove(false)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    确认移除
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setConfirmRemove(false)}
                  >
                    取消
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-0 text-[11px] text-destructive hover:bg-transparent hover:underline"
                  onClick={() => setConfirmRemove(true)}
                >
                  移除渠道
                </Button>
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-[12px]" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {mode === 'edit' ? '保存' : '接入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ children, label, hint }: { children: React.ReactNode; hint?: string; label: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-text-muted">{label}</Label>
      {children}
      {hint ? <p className="text-[10px] text-text-subtle">{hint}</p> : null}
    </div>
  )
}
