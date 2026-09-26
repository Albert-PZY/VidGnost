import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, KeyRound, Loader2, PlugZap } from 'lucide-react'

import type { ProviderConfig } from '@vidgnost/contracts'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/stores/app-store'

/**
 * 模型页：提供方密钥状态 + 角色路由。
 * 密钥只从环境变量读取或在此内联保存，界面永远只显示脱敏尾码。
 */
export function ProvidersView() {
  const providers = useAppStore((state) => state.providers)
  const routes = useAppStore((state) => state.routes)
  const models = useAppStore((state) => state.models)
  const roleMeta = useAppStore((state) => state.roleMeta)
  const loadConfig = useAppStore((state) => state.loadConfig)
  const saveProvider = useAppStore((state) => state.saveProvider)
  const saveRoutes = useAppStore((state) => state.saveRoutes)

  const [probeState, setProbeState] = useState<'idle' | 'running' | 'done'>('idle')
  const [probeResult, setProbeResult] = useState<Awaited<ReturnType<typeof api.runHealth>> | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savingRoute, setSavingRoute] = useState<string | null>(null)

  useEffect(() => {
    if (providers.length === 0) {
      void loadConfig()
    }
  }, [loadConfig, providers.length])

  const runProbe = async () => {
    setProbeState('running')
    try {
      const result = await api.runHealth()
      setProbeResult(result)
    } finally {
      setProbeState('done')
    }
  }

  const updateRoute = async (role: string, model: string) => {
    const next = routes.map((route) => (route.role === role ? { ...route, model } : route))
    setSavingRoute(role)
    try {
      await saveRoutes(next)
    } finally {
      setSavingRoute(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto px-6 pb-10 pt-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-text-strong">模型与密钥</h1>
          <p className="mt-0.5 text-[11px] text-text-muted">
            在线模型优先；密钥只从环境变量读取或在本地保存，界面仅显示脱敏尾码。
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void runProbe()} disabled={probeState === 'running'}>
          {probeState === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
          运行时自检
        </Button>
      </header>

      {probeResult ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {probeResult.providers.map((provider) => (
            <section key={provider.provider} className="rounded-xl border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2">
                {provider.ok ? (
                  <CheckCircle2 className="size-3.5 text-success" />
                ) : (
                  <AlertTriangle className="size-3.5 text-destructive" />
                )}
                <span className="text-[12px] font-medium text-text-strong">{provider.provider}</span>
                <span className="ml-auto text-[10px] text-text-subtle">
                  {new Date(provider.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {provider.checks.map((check) => (
                  <li key={check.name} className="flex gap-2 text-[11px]">
                    <span className={cn('mt-[3px] size-1.5 shrink-0 rounded-full', check.ok ? 'bg-success' : 'bg-destructive')} />
                    <span className="shrink-0 text-text-muted">{check.name}</span>
                    <span className="min-w-0 flex-1 truncate text-text-subtle">{check.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      <section className="mt-6">
        <span className="label-eyebrow">提供方</span>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              draft={drafts[provider.id] ?? ''}
              onDraftChange={(value) => setDrafts((state) => ({ ...state, [provider.id]: value }))}
              onSave={async (patch) => {
                await saveProvider(patch)
                setDrafts((state) => ({ ...state, [provider.id]: '' }))
              }}
            />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <span className="label-eyebrow">角色路由</span>
        <p className="mt-1.5 text-[11px] text-text-muted">
          流水线只依赖角色名，不依赖具体模型。切换模型后，仅相关阶段会在下次处理时按新配置重跑。
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-card/60 text-[10px] uppercase tracking-wider text-text-subtle">
                <th className="px-4 py-2 font-medium">角色</th>
                <th className="px-4 py-2 font-medium">用途</th>
                <th className="px-4 py-2 font-medium">模型</th>
              </tr>
            </thead>
            <tbody>
              {roleMeta.map((meta) => {
                const route = routes.find((item) => item.role === meta.role)
                const candidates = models.filter(
                  (model) => model.kind === meta.kind && (model.provider === 'dashscope' || model.provider === (route?.provider ?? 'dashscope')),
                )
                const options = candidates.length > 0 ? candidates : models.filter((model) => model.kind === meta.kind)
                return (
                  <tr key={meta.role} className="border-t border-border/50">
                    <td className="px-4 py-2.5 align-top">
                      <span className="block text-[12px] text-foreground">{meta.label}</span>
                      <span className="timecode block text-[10px] text-text-subtle">{meta.role}</span>
                    </td>
                    <td className="max-w-[280px] px-4 py-2.5 align-top text-[11px] leading-relaxed text-text-muted">
                      {meta.purpose}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex items-center gap-2">
                        <select
                          value={route?.model || ''}
                          onChange={(event) => void updateRoute(meta.role, event.target.value)}
                          className="h-8 w-[260px] rounded-md border border-border/70 bg-background/60 px-2 text-[12px] text-foreground outline-none transition-colors focus-visible:border-primary/60"
                        >
                          {options.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label} · {model.id}
                            </option>
                          ))}
                          {route && !options.some((model) => model.id === route.model) ? (
                            <option value={route.model}>{route.model}</option>
                          ) : null}
                        </select>
                        {savingRoute === meta.role ? <Loader2 className="size-3.5 animate-spin text-text-subtle" /> : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function ProviderCard({
  draft,
  onDraftChange,
  onSave,
  provider,
}: {
  draft: string
  onDraftChange: (value: string) => void
  onSave: (patch: { id: string; apiKey?: string | null; baseUrl?: string; enabled?: boolean }) => Promise<void>
  provider: ProviderConfig
}) {
  const [busy, setBusy] = useState(false)
  const [editingKey, setEditingKey] = useState(false)

  return (
    <section className="rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-8 place-items-center rounded-lg bg-secondary text-text-muted">
          <PlugZap className="size-4" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-text-strong">{provider.label}</span>
            <span
              className={cn(
                'rounded-full px-2 py-px text-[10px]',
                provider.credentialStatus.present ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
              )}
            >
              {provider.credentialStatus.present ? '密钥已就绪' : '缺少密钥'}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{provider.note}</p>
          <p className="timecode mt-1.5 text-[10px] text-text-subtle">
            {provider.credentialStatus.masked || '—'}
            <span className="mx-1.5 font-sans">·</span>
            来源 {provider.credentialStatus.origin === 'env' ? provider.auth.envVar : provider.credentialStatus.origin === 'inline' ? '本地保存' : '未配置'}
          </p>
        </div>
        <Switch
          checked={provider.enabled}
          onCheckedChange={(checked) => void onSave({ id: provider.id, enabled: checked })}
          aria-label={`启用 ${provider.label}`}
        />
      </div>

      <div className="mt-3 space-y-2">
        {editingKey ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              type="password"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="粘贴 API Key"
              className="h-8 flex-1 text-[12px]"
            />
            <Button
              size="sm"
              className="h-8 text-[11px]"
              disabled={busy || !draft.trim()}
              onClick={async () => {
                setBusy(true)
                try {
                  await onSave({ id: provider.id, apiKey: draft.trim() })
                  setEditingKey(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => {
                setEditingKey(false)
                onDraftChange('')
              }}
            >
              取消
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => setEditingKey(true)}>
              <KeyRound className="size-3" /> {provider.credentialStatus.present ? '替换密钥' : '填写密钥'}
            </Button>
            {provider.credentialStatus.origin === 'inline' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={async () => {
                  setBusy(true)
                  try {
                    await onSave({ id: provider.id, apiKey: null })
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy}
              >
                改回环境变量
              </Button>
            ) : null}
          </div>
        )}

        <Input
          defaultValue={provider.baseUrl}
          onBlur={(event) => {
            if (event.target.value !== provider.baseUrl) {
              void onSave({ id: provider.id, baseUrl: event.target.value })
            }
          }}
          className="h-8 text-[11px]"
          aria-label={`${provider.label} Base URL`}
        />
      </div>
    </section>
  )
}
