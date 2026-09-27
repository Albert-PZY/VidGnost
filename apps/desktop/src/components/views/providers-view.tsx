import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

import type {
  CustomModelEntry,
  ModelKind,
  ModelRole,
  ProviderConfig,
  ProviderCreateRequest,
  ProviderModelUpsertRequest,
  ProviderPatchRequest,
  ProviderProtocolInfo,
  RuntimeHealth,
} from '@vidgnost/contracts'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  KIND_LABELS,
  assignRole,
  groupModels,
  modelKey,
  type ModelCard,
  type ProtocolGroup,
} from '@/lib/model-groups'
import { ChannelDialog } from '@/components/providers/channel-dialog'
import { LocalRuntimeDialog } from '@/components/providers/local-runtime-dialog'
import { ModelDialog } from '@/components/providers/model-dialog'
import { Button } from '@/components/ui/button'
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

/** 每个类别一句话说明它在流水线里做什么，用户据此判断自己缺哪一类模型。 */
const KIND_HINTS: Record<ModelKind, string> = {
  chat: '分段、章节、摘要、导图与问答的文字生成。',
  vision: '关键帧图注与屏上文字提取。',
  embedding: '检索切块的向量化，决定能不能按语义搜到内容。',
  rerank: '对混合召回的结果重新排序，提升引用的准确度。',
  asr: '把音频转写成带时间戳的文本，是整条管线的起点。',
  translation: '字幕与段落的批量翻译。',
}

type ChannelDialogState =
  | { mode: 'create'; protocol: ProviderProtocolInfo }
  | { mode: 'edit'; protocol: ProviderProtocolInfo; provider: ProviderConfig }
  | null

type ModelDialogState = {
  kind: ModelKind
  mode: 'create' | 'edit'
  model?: CustomModelEntry
  provider: ProviderConfig
} | null

/**
 * 模型页：先按模型类别分（对话、多模态、向量化、重排、转写、翻译），
 * 每个类别下再按协议列出已接入的渠道；渠道是协议加连接信息，模型登记在渠道下。
 * 角色分配落在模型卡片上——用户问的是「这个模型在做什么」，而不是「这个抽象角色对应谁」。
 */
export function ProvidersView() {
  const providers = useAppStore((state) => state.providers)
  const routes = useAppStore((state) => state.routes)
  const models = useAppStore((state) => state.models)
  const protocols = useAppStore((state) => state.protocols)
  const roleMeta = useAppStore((state) => state.roleMeta)
  const loadConfig = useAppStore((state) => state.loadConfig)
  const saveProvider = useAppStore((state) => state.saveProvider)
  const addProvider = useAppStore((state) => state.addProvider)
  const removeProvider = useAppStore((state) => state.removeProvider)
  const saveProviderModel = useAppStore((state) => state.saveProviderModel)
  const removeProviderModel = useAppStore((state) => state.removeProviderModel)
  const saveRoutes = useAppStore((state) => state.saveRoutes)

  const [probeState, setProbeState] = useState<'idle' | 'running' | 'done'>('idle')
  const [probeResult, setProbeResult] = useState<RuntimeHealth | null>(null)
  const [pendingModelKey, setPendingModelKey] = useState<string | null>(null)
  const [lastChange, setLastChange] = useState<string | null>(null)
  const [channelDialog, setChannelDialog] = useState<ChannelDialogState>(null)
  const [modelDialog, setModelDialog] = useState<ModelDialogState>(null)
  const [localOpen, setLocalOpen] = useState(false)

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

  const sections = useMemo(
    () => groupModels({ models, protocols, providers, roleMeta, routes }),
    [models, providers, protocols, roleMeta, routes],
  )

  /** 自检结果按渠道展示，但同一渠道可能出现在多个类别里，只在第一次出现时渲染。 */
  const healthOwner = useMemo(() => {
    const owner = new Map<string, ModelKind>()
    for (const section of sections) {
      for (const group of section.protocols) {
        for (const channel of group.channels) {
          if (!owner.has(channel.provider.id)) {
            owner.set(channel.provider.id, section.kind)
          }
        }
      }
    }
    return owner
  }, [sections])

  const healthByProvider = useMemo(() => {
    const map = new Map<string, RuntimeHealth['providers'][number]>()
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
          <p className="mt-0.5 max-w-[720px] text-[11px] leading-relaxed text-text-muted">
            先按模型类别分，每个类别下再按协议列出已接入的渠道。渠道是一份连接信息（协议 + Base URL + 密钥），
            模型登记在渠道下面；角色决定它在流水线里做什么，切换后只有相关阶段会在下次处理时重新执行。
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
        {sections.map((section) => (
          <section key={section.kind}>
            <div className="flex items-center gap-2.5">
              <span className={cn('size-1.5 rounded-full bg-current', KIND_TONE[section.kind])} />
              <h2 className="text-[15px] font-semibold tracking-tight text-text-strong">{section.label}</h2>
              <span className="text-[10px] text-text-subtle">{section.modelCount} 个模型</span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">{KIND_HINTS[section.kind]}</p>

            <div className="mt-3 space-y-3">
              {section.protocols.map((group) => (
                <ProtocolBlock
                  key={`${section.kind}-${group.protocol}`}
                  group={group}
                  health={healthByProvider}
                  healthHere={healthOwner}
                  kind={section.kind}
                  onAddChannel={() => {
                    const info = protocols.find((item) => item.protocol === group.protocol)
                    if (info) {
                      setChannelDialog({ mode: 'create', protocol: info })
                    }
                  }}
                  onAddModel={(provider) => setModelDialog({ kind: section.kind, mode: 'create', provider })}
                  onAssign={assign}
                  onDeleteModel={async (provider, model) => {
                    await removeProviderModel(provider.id, model.id)
                    setLastChange(`已移除模型：${model.label}`)
                  }}
                  onEditChannel={(provider) => {
                    const info = protocols.find((item) => item.protocol === provider.protocol)
                    if (info) {
                      setChannelDialog({ mode: 'edit', protocol: info, provider })
                    }
                  }}
                  onEditModel={(provider, model) =>
                    setModelDialog({ kind: section.kind, mode: 'edit', model, provider })
                  }
                  onOpenLocalRuntime={() => setLocalOpen(true)}
                  onToggleChannel={(provider, enabled) => void saveProvider({ id: provider.id, enabled })}
                  pendingModelKey={pendingModelKey}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {channelDialog ? (
        <ChannelDialog
          mode={channelDialog.mode}
          onDelete={
            channelDialog.mode === 'edit'
              ? async () => {
                  await removeProvider(channelDialog.provider.id)
                  setLastChange(`已移除渠道：${channelDialog.provider.label}`)
                }
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) setChannelDialog(null)
          }}
          onSubmit={async (input) => {
            if (channelDialog.mode === 'edit') {
              await saveProvider(input as ProviderPatchRequest)
              setLastChange(`已更新渠道：${channelDialog.provider.label}`)
            } else {
              await addProvider(input as ProviderCreateRequest)
              setLastChange(`已接入渠道：${(input as ProviderCreateRequest).label}`)
            }
          }}
          open
          protocol={channelDialog.protocol}
          protocols={protocols}
          provider={channelDialog.mode === 'edit' ? channelDialog.provider : undefined}
        />
      ) : null}

      {modelDialog ? (
        <ModelDialog
          kind={modelDialog.kind}
          mode={modelDialog.mode}
          model={modelDialog.model}
          onOpenChange={(open) => {
            if (!open) setModelDialog(null)
          }}
          onSubmit={async (modelId, input: ProviderModelUpsertRequest) => {
            await saveProviderModel(modelDialog.provider.id, modelId, input)
            setLastChange(
              modelDialog.mode === 'edit' ? `已更新模型：${input.label}` : `已接入模型：${input.label}`,
            )
          }}
          open
          provider={modelDialog.provider}
        />
      ) : null}

      <LocalRuntimeDialog onOpenChange={setLocalOpen} open={localOpen} />
    </div>
  )
}

function ProtocolBlock({
  group,
  health,
  healthHere,
  kind,
  onAddChannel,
  onAddModel,
  onAssign,
  onDeleteModel,
  onEditChannel,
  onEditModel,
  onOpenLocalRuntime,
  onToggleChannel,
  pendingModelKey,
}: {
  group: ProtocolGroup
  health: Map<string, RuntimeHealth['providers'][number]>
  healthHere: Map<string, ModelKind>
  kind: ModelKind
  onAddChannel: () => void
  onAddModel: (provider: ProviderConfig) => void
  onAssign: (card: ModelCard, role: ModelRole) => Promise<void>
  onDeleteModel: (provider: ProviderConfig, model: CustomModelEntry) => Promise<void>
  onEditChannel: (provider: ProviderConfig) => void
  onEditModel: (provider: ProviderConfig, model: CustomModelEntry) => void
  onOpenLocalRuntime: () => void
  onToggleChannel: (provider: ProviderConfig, enabled: boolean) => void
  pendingModelKey: string | null
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-4 py-2.5 hairline-b">
        <span className="text-[12px] font-medium text-text-strong">{group.label}</span>
        <span className="text-[10px] text-text-subtle">
          {group.channels.length === 0
            ? '还没有接入渠道'
            : group.modelCount > 0
              ? `${group.modelCount} 个模型`
              : '本类别下还没有模型'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 text-[11px]"
          onClick={onAddChannel}
        >
          ＋ 接入渠道
        </Button>
      </header>

      {group.channels.length === 0 ? (
        // 空态只说明这个协议适合接什么，不渲染无法操作的控件。
        <p className="px-4 py-3 text-[11px] leading-relaxed text-text-muted">{group.note}</p>
      ) : (
        <div className="divide-y divide-border/50">
          {group.channels.map((channel) => (
            <ChannelBlock
              key={channel.provider.id}
              health={health.get(channel.provider.id)}
              showHealth={healthHere.get(channel.provider.id) === kind}
              models={channel.models}
              onAddModel={() => onAddModel(channel.provider)}
              onAssign={onAssign}
              onDeleteModel={(model) => onDeleteModel(channel.provider, model)}
              onEditChannel={() => onEditChannel(channel.provider)}
              onEditModel={(model) => onEditModel(channel.provider, model)}
              onOpenLocalRuntime={onOpenLocalRuntime}
              onToggle={(enabled) => onToggleChannel(channel.provider, enabled)}
              pendingModelKey={pendingModelKey}
              provider={channel.provider}
            />
          ))}
        </div>
      )}
    </article>
  )
}

function ChannelBlock({
  health,
  models,
  onAddModel,
  onAssign,
  onDeleteModel,
  onEditChannel,
  onEditModel,
  onOpenLocalRuntime,
  onToggle,
  pendingModelKey,
  provider,
  showHealth,
}: {
  health: RuntimeHealth['providers'][number] | undefined
  models: ModelCard[]
  onAddModel: () => void
  onAssign: (card: ModelCard, role: ModelRole) => Promise<void>
  onDeleteModel: (model: CustomModelEntry) => Promise<void>
  onEditChannel: () => void
  onEditModel: (model: CustomModelEntry) => void
  onOpenLocalRuntime: () => void
  onToggle: (enabled: boolean) => void
  pendingModelKey: string | null
  provider: ProviderConfig
  showHealth: boolean
}) {
  const isLocal = provider.protocol === 'local'
  const credential = provider.credentialStatus

  return (
    <div className="px-4 py-3">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span className="text-[12px] text-text-strong">{provider.label}</span>

        {isLocal ? (
          <span className="rounded-full bg-secondary px-2 py-px text-[10px] text-text-muted">无需密钥</span>
        ) : (
          <span
            className={cn(
              'rounded-full px-2 py-px text-[10px]',
              credential.present ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
            )}
          >
            {credential.present ? `密钥已就绪 · ${credential.masked}` : '缺少密钥'}
          </span>
        )}

        {provider.baseUrl ? (
          <span className="timecode max-w-[300px] truncate text-[10px] text-text-subtle">{provider.baseUrl}</span>
        ) : null}
        <span className="text-[10px] text-text-subtle">{models.length} 个模型</span>

        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={provider.enabled}
            onCheckedChange={onToggle}
            aria-label={`启用 ${provider.label}`}
          />
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onAddModel}>
            ＋ 模型
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px]"
            onClick={isLocal ? onOpenLocalRuntime : onEditChannel}
          >
            {isLocal ? '转写参数' : '设置'}
          </Button>
        </div>
      </header>

      {!provider.enabled ? (
        <p className="mt-2 text-[11px] text-text-muted">
          已停用：引用它的角色会在调用时失败，重新打开开关即可恢复。
        </p>
      ) : null}

      {showHealth && health ? (
        <ul className="mt-2 space-y-1.5 rounded-lg border border-border/50 bg-background/40 px-3 py-2">
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

      <div className="mt-2 grid gap-1.5 xl:grid-cols-2">
        {models.map((card) => (
          <ModelRow
            key={modelKey(card.model)}
            card={card}
            onAssign={onAssign}
            onDelete={() => onDeleteModel({ id: card.model.id, kind: card.model.kind, label: card.model.label })}
            onEdit={() => onEditModel({ id: card.model.id, kind: card.model.kind, label: card.model.label })}
            pendingModelKey={pendingModelKey}
          />
        ))}
      </div>
    </div>
  )
}

function ModelRow({
  card,
  onAssign,
  onDelete,
  onEdit,
  pendingModelKey,
}: {
  card: ModelCard
  onAssign: (card: ModelCard, role: ModelRole) => Promise<void>
  onDelete: () => Promise<void>
  onEdit: () => void
  pendingModelKey: string | null
}) {
  const roleMeta = useAppStore((state) => state.roleMeta)
  const routes = useAppStore((state) => state.routes)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assignedLabels = card.assignedRoles.map(
    (role) => roleMeta.find((meta) => meta.role === role)?.label || role,
  )
  const available = card.assignableRoles.filter((role) => !card.assignedRoles.includes(role))
  const assigningHere = pendingModelKey === modelKey(card.model)
  // 内置模型由目录维护，用户只能对自定义模型改名或移除。
  const custom = Boolean(card.model.custom)
  const usedBy = routes.filter((route) => route.provider === card.model.provider && route.model === card.model.id)

  return (
    <div className="rounded-lg border border-border/50 bg-background/40 px-3 py-2.5 transition-colors">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className="truncate text-[12px] font-medium text-foreground">{card.model.label}</span>
            {custom ? (
              <span className="rounded bg-secondary px-1.5 py-px text-[10px] text-text-muted">自定义</span>
            ) : null}
            {card.model.free ? (
              <span className="rounded bg-success/15 px-1.5 py-px text-[10px] text-success">免费</span>
            ) : null}
          </div>
          <p className="timecode mt-0.5 truncate text-[10px] text-text-subtle">{card.model.id}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{card.model.description}</p>
          {card.model.contextWindow || card.model.dimensions ? (
            <p className="mt-1 text-[10px] text-text-subtle">
              {card.model.contextWindow ? `上下文 ${card.model.contextWindow.toLocaleString('zh-CN')}` : ''}
              {card.model.contextWindow && card.model.dimensions ? ' · ' : ''}
              {card.model.dimensions ? `${card.model.dimensions} 维` : ''}
            </p>
          ) : null}
        </div>

        {custom ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              className="rounded px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-secondary hover:text-foreground"
            >
              编辑
            </button>
            <button
              type="button"
              disabled={removing || usedBy.length > 0}
              title={
                usedBy.length > 0
                  ? `仍被角色占用：${usedBy.map((route) => route.label || route.role).join('、')}`
                  : undefined
              }
              onClick={async () => {
                setRemoving(true)
                setError(null)
                try {
                  await onDelete()
                } catch {
                  setError('移除失败：该模型仍被角色引用，请先改到别的模型。')
                } finally {
                  setRemoving(false)
                }
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:bg-destructive/15 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
            >
              移除
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.assignedRoles.length > 0 ? (
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

      {error ? (
        <p role="alert" className="mt-1.5 text-[10px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
