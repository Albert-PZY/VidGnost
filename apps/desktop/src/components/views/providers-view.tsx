import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Cpu, KeyRound, Loader2, PlugZap } from 'lucide-react'

import type { ModelKind, ModelRole, ProviderConfig, ProviderId, RuntimeHealth } from '@vidgnost/contracts'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  assignRole,
  groupModels,
  modelKey,
  type ModelCard,
  type ProviderGroup,
  type ScopeGroup,
} from '@/lib/model-groups'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useAppStore } from '@/stores/app-store'

const KIND_TONE: Record<ModelKind, string> = {
  chat: 'text-primary',
  vision: 'text-info',
  asr: 'text-success',
  embedding: 'text-warning',
  translation: 'text-timestamp',
  rerank: 'text-destructive',
}

/**
 * 模型页：按「在线模型 / 本地模型 → 提供方 → 模型类型 → 模型」组织。
 * 角色分配落在模型卡片上——用户问的是「这个模型在做什么」，而不是「这个抽象角色对应谁」。
 */
export function ProvidersView() {
  const providers = useAppStore((state) => state.providers)
  const routes = useAppStore((state) => state.routes)
  const models = useAppStore((state) => state.models)
  const roleMeta = useAppStore((state) => state.roleMeta)
  const settings = useAppStore((state) => state.settings)
  const loadConfig = useAppStore((state) => state.loadConfig)
  const saveProvider = useAppStore((state) => state.saveProvider)
  const saveRoutes = useAppStore((state) => state.saveRoutes)
  const saveSettings = useAppStore((state) => state.saveSettings)

  const [probeState, setProbeState] = useState<'idle' | 'running' | 'done'>('idle')
  const [probeResult, setProbeResult] = useState<RuntimeHealth | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [pendingModelKey, setPendingModelKey] = useState<string | null>(null)
  const [lastChange, setLastChange] = useState<string | null>(null)

  useEffect(() => {
    if (providers.length === 0) {
      void loadConfig()
    }
  }, [loadConfig, providers.length])

  useEffect(() => {
    if (!lastChange) {
      return
    }
    const timer = setTimeout(() => setLastChange(null), 6000)
    return () => clearTimeout(timer)
  }, [lastChange])

  const scopes: ScopeGroup[] = useMemo(
    () => groupModels({ models, providers, roleMeta, routes }),
    [models, providers, roleMeta, routes],
  )

  const healthByProvider = useMemo(() => {
    const map = new Map<ProviderId, RuntimeHealth['providers'][number]>()
    for (const entry of probeResult?.providers ?? []) {
      map.set(entry.provider, entry)
    }
    return map
  }, [probeResult])

  const runProbe = async () => {
    setProbeState('running')
    try {
      setProbeResult(await api.runHealth())
    } finally {
      setProbeState('done')
    }
  }

  const assign = async (card: ModelCard, role: ModelRole) => {
    // 只让被点击的卡片进入等待态：同一角色可能被多个模型承担，按角色高亮会连累无关卡片。
    setPendingModelKey(modelKey(card.model))
    try {
      await saveRoutes(assignRole({ model: card.model, role, roleMeta, routes }))
      const meta = roleMeta.find((item) => item.role === role)
      setLastChange(`${meta?.label || role} → ${card.model.label}`)
    } finally {
      setPendingModelKey(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto px-6 pb-10 pt-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-text-strong">模型</h1>
          <p className="mt-0.5 text-[11px] text-text-muted">
            在线模型开箱即用，本地模型离线兜底。每个角色只由一个模型承担，切换后仅相关阶段会在下次处理时重跑。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => void runProbe()}
          disabled={probeState === 'running'}
        >
          {probeState === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
          运行时自检
        </Button>
      </header>

      {lastChange ? (
        <p
          role="status"
          className="reveal mt-3 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] text-foreground"
        >
          <CheckCircle2 className="size-3.5 text-primary" />
          已切换：{lastChange}
        </p>
      ) : null}

      <div className="mt-5 space-y-8">
        {scopes.map((scope) => (
          <section key={scope.scope}>
            <div className="flex items-baseline gap-2.5">
              {scope.scope === 'local' ? (
                <Cpu className="size-3.5 self-center text-text-muted" strokeWidth={1.8} />
              ) : (
                <PlugZap className="size-3.5 self-center text-text-muted" strokeWidth={1.8} />
              )}
              <h2 className="text-[15px] font-semibold tracking-tight text-text-strong">{scope.label}</h2>
              <span className="text-[10px] text-text-subtle">
                {scope.providers.reduce((sum, group) => sum + group.models.length, 0)} 个模型
              </span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">{scope.description}</p>

            <div className="mt-3 space-y-3">
              {scope.providers.map((group) => (
                <ProviderBlock
                  key={`${scope.scope}-${group.providerId}`}
                  group={group}
                  health={healthByProvider.get(group.providerId)}
                  draft={drafts[group.providerId] ?? ''}
                  onDraftChange={(value) => setDrafts((state) => ({ ...state, [group.providerId]: value }))}
                  onSaveProvider={async (patch) => {
                    await saveProvider(patch)
                    setDrafts((state) => ({ ...state, [group.providerId]: '' }))
                  }}
                  onAssign={assign}
                  pendingModelKey={pendingModelKey}
                  whisper={settings?.whisper}
                  onSaveWhisper={async (patch) => {
                    await saveSettings({ settings: { whisper: patch } })
                  }}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function ProviderBlock({
  draft,
  group,
  health,
  onAssign,
  onDraftChange,
  onSaveProvider,
  onSaveWhisper,
  pendingModelKey,
  whisper,
}: {
  draft: string
  group: ProviderGroup
  health: RuntimeHealth['providers'][number] | undefined
  onAssign: (card: ModelCard, role: ModelRole) => Promise<void>
  onDraftChange: (value: string) => void
  onSaveProvider: (patch: { id: string; apiKey?: string | null; baseUrl?: string; enabled?: boolean }) => Promise<void>
  onSaveWhisper: (patch: Record<string, string>) => Promise<void>
  pendingModelKey: string | null
  whisper: { computeType: string; device: string; model: string; modelDir: string; pythonExecutable: string } | undefined
}) {
  const [editingKey, setEditingKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const provider: ProviderConfig | null = group.provider

  return (
    <article className="overflow-hidden rounded-xl border border-border/60 bg-card/50">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hairline-b">
        <span className="text-[13px] font-medium text-text-strong">{group.label}</span>

        {provider ? (
          <span
            className={cn(
              'rounded-full px-2 py-px text-[10px]',
              provider.credentialStatus.present ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
            )}
          >
            {provider.credentialStatus.present ? `密钥已就绪 · ${provider.credentialStatus.masked}` : '缺少密钥'}
          </span>
        ) : (
          <span className="rounded-full bg-secondary px-2 py-px text-[10px] text-text-muted">无需密钥</span>
        )}

        {group.models.length > 0 ? (
          <span className="text-[10px] text-text-subtle">{group.models.length} 个模型</span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {provider && provider.credentialStatus.origin === 'env' ? (
            <span className="timecode text-[10px] text-text-subtle">{provider.auth.envVar}</span>
          ) : null}
          {provider ? (
            <Switch
              checked={provider.enabled}
              onCheckedChange={(checked) => void onSaveProvider({ id: provider.id, enabled: checked })}
              aria-label={`启用 ${group.label}`}
            />
          ) : null}
        </div>
      </header>

      <div className="space-y-3 px-4 py-3">
        {provider ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              defaultValue={provider.baseUrl}
              onBlur={(event) => {
                if (event.target.value !== provider.baseUrl) {
                  void onSaveProvider({ id: provider.id, baseUrl: event.target.value })
                }
              }}
              aria-label={`${group.label} Base URL`}
              className="h-8 max-w-[420px] flex-1 text-[11px]"
            />
            {editingKey ? (
              <>
                <Input
                  autoFocus
                  type="password"
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  placeholder="粘贴 API Key"
                  className="h-8 w-[220px] text-[12px]"
                />
                <Button
                  size="sm"
                  className="h-8 text-[11px]"
                  disabled={busy || !draft.trim()}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await onSaveProvider({ id: provider.id, apiKey: draft.trim() })
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
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-[11px]"
                  onClick={() => setEditingKey(true)}
                >
                  <KeyRound className="size-3" /> {provider.credentialStatus.present ? '替换密钥' : '填写密钥'}
                </Button>
                {provider.credentialStatus.origin === 'inline' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[11px]"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await onSaveProvider({ id: provider.id, apiKey: null })
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    改回环境变量
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {group.providerId === 'local' && whisper ? (
          <WhisperConfig onSave={onSaveWhisper} whisper={whisper} />
        ) : null}

        {health ? (
          <ul className="space-y-1.5 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
            {health.checks.map((check) => (
              <li key={check.name} className="flex items-center gap-2 text-[11px]">
                {check.ok ? (
                  <CheckCircle2 className="size-3 shrink-0 text-success" />
                ) : (
                  <AlertTriangle className="size-3 shrink-0 text-destructive" />
                )}
                <span className="shrink-0 text-text-muted">{check.name}</span>
                <span className="min-w-0 flex-1 truncate text-text-subtle">{check.detail}</span>
                {check.latencyMs !== undefined ? (
                  <span className="timecode shrink-0 text-[10px] text-text-subtle">{check.latencyMs}ms</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {group.kinds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-2.5 text-[11px] text-text-subtle">
            该提供方未登记可用模型，暂时无法被角色引用。
          </p>
        ) : (
          <div className="space-y-3">
            {group.kinds.map((kindGroup) => (
              <div key={kindGroup.kind}>
                <div className="flex items-center gap-2 px-0.5 pb-1.5">
                  <span className={cn('size-1.5 rounded-full bg-current', KIND_TONE[kindGroup.kind])} />
                  <span className="text-[11px] font-medium text-text-muted">{kindGroup.label}</span>
                </div>
                <div className="grid gap-1.5 xl:grid-cols-2">
                  {kindGroup.models.map((card) => (
                    <ModelRow
                      key={modelKey(card.model)}
                      card={card}
                      onAssign={onAssign}
                      pendingModelKey={pendingModelKey}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function ModelRow({
  card,
  onAssign,
  pendingModelKey,
}: {
  card: ModelCard
  onAssign: (card: ModelCard, role: ModelRole) => Promise<void>
  pendingModelKey: string | null
}) {
  const roleMeta = useAppStore((state) => state.roleMeta)
  const assignedLabels = card.assignedRoles.map(
    (role) => roleMeta.find((meta) => meta.role === role)?.label || role,
  )
  const serving = card.assignedRoles.length > 0
  const available = card.assignableRoles.filter((role) => !card.assignedRoles.includes(role))
  const assigningHere = pendingModelKey === modelKey(card.model)

  return (
    // 是否在服务由角色 chip 单独表达；卡片本身保持中性，避免整页都在发光。
    <div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2.5 transition-colors">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="truncate text-[12px] font-medium text-foreground">{card.model.label}</span>
            {card.model.free ? (
              <span className="rounded bg-success/15 px-1.5 py-px text-[10px] text-success">免费</span>
            ) : null}
          </div>
          <p className="timecode mt-0.5 truncate text-[10px] text-text-subtle">{card.model.id}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{card.model.description}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {serving ? (
          assignedLabels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary"
              title="该角色由本模型承担"
            >
              {label}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-text-subtle">未承担任何角色</span>
        )}

        {available.length > 0 ? (
          <label className="relative ml-auto inline-flex items-center">
            <select
              value=""
              onChange={(event) => {
                const role = event.target.value
                if (role) {
                  void onAssign(card, role as ModelRole)
                }
              }}
              disabled={pendingModelKey !== null}
              aria-label={`把某个角色分配给 ${card.model.label}`}
              className="h-6 cursor-pointer rounded-md border border-border/70 bg-background/70 pl-2 pr-6 text-[10px] text-text-muted outline-none transition-colors hover:border-border-strong hover:text-foreground focus-visible:border-primary/60 disabled:opacity-60"
            >
              <option value="">＋ 分配角色</option>
              {available.map((role) => (
                <option key={role} value={role}>
                  {roleMeta.find((meta) => meta.role === role)?.label || role}
                </option>
              ))}
            </select>
            {assigningHere ? (
              <Loader2 className="pointer-events-none absolute right-1.5 size-3 animate-spin text-text-subtle" />
            ) : null}
          </label>
        ) : null}
      </div>
    </div>
  )
}

function WhisperConfig({
  onSave,
  whisper,
}: {
  onSave: (patch: Record<string, string>) => Promise<void>
  whisper: { computeType: string; device: string; model: string; modelDir: string; pythonExecutable: string }
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2.5 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="模型标识">
        <Input
          defaultValue={whisper.model}
          onBlur={(event) => {
            if (event.target.value !== whisper.model) {
              void onSave({ model: event.target.value })
            }
          }}
          className="h-8 text-[11px]"
        />
      </Field>
      <Field label="模型目录（CTranslate2）">
        <Input
          defaultValue={whisper.modelDir}
          placeholder="留空表示未配置"
          onBlur={(event) => {
            if (event.target.value !== whisper.modelDir) {
              void onSave({ modelDir: event.target.value })
            }
          }}
          className="h-8 text-[11px]"
        />
      </Field>
      <Field label="推理设备">
        <select
          value={whisper.device}
          onChange={(event) => void onSave({ device: event.target.value })}
          className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[11px] text-foreground outline-none"
        >
          <option value="auto">自动</option>
          <option value="cpu">CPU</option>
          <option value="cuda">CUDA</option>
        </select>
      </Field>
      <Field label="计算精度">
        <select
          value={whisper.computeType}
          onChange={(event) => void onSave({ computeType: event.target.value })}
          className="h-8 w-full rounded-md border border-border/70 bg-background/60 px-2 text-[11px] text-foreground outline-none"
        >
          {['int8', 'int8_float16', 'float16', 'float32'].map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2 lg:col-span-4">
        <Field label="Python 可执行文件">
          <Input
            defaultValue={whisper.pythonExecutable}
            placeholder="留空则从 PATH 查找 python"
            onBlur={(event) => {
              if (event.target.value !== whisper.pythonExecutable) {
                void onSave({ pythonExecutable: event.target.value })
              }
            }}
            className="h-8 text-[11px]"
          />
        </Field>
      </div>
    </div>
  )
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wider text-text-subtle">{label}</span>
      {children}
    </label>
  )
}
