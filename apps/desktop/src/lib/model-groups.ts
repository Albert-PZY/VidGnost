import type { ModelCatalogEntry, ModelKind, ModelRole, ModelRoute, ProviderConfig, ProviderId } from '@vidgnost/contracts'

/**
 * 模型页的派生视图：把「模型目录 + 角色路由 + 提供方状态」整理成
 * 「在线模型 / 本地模型 → 提供方 → 模型类型 → 模型」四层结构。
 *
 * 之所以放在这里而不是页面内：分组与角色兼容性是纯函数，可以在没有界面的情况下验证。
 */

export interface RoleMeta {
  kind: ModelKind
  label: string
  purpose: string
  role: ModelRole
}

export type ModelScope = 'online' | 'local'

export interface ModelCard {
  /** 该模型可以承担哪些角色（按能力与提供方推导，不含已被其他角色占用的限制）。 */
  assignableRoles: ModelRole[]
  /** 该模型当前承担的角色。 */
  assignedRoles: ModelRole[]
  model: ModelCatalogEntry
}

export interface KindGroup {
  kind: ModelKind
  label: string
  models: ModelCard[]
}

export interface ProviderGroup {
  /** 本地运行时没有凭据概念，因此可以为 null。 */
  provider: ProviderConfig | null
  providerId: ProviderId
  label: string
  note: string
  models: ModelCard[]
  kinds: KindGroup[]
}

export interface ScopeGroup {
  description: string
  label: string
  providers: ProviderGroup[]
  scope: ModelScope
}

export const KIND_LABELS: Record<ModelKind, string> = {
  chat: '对话模型',
  translation: '翻译模型',
  asr: '语音转文字',
  embedding: '向量化模型',
  vision: '多模态模型',
  rerank: '重排序模型',
}

export const SCOPE_LABELS: Record<ModelScope, { description: string; label: string }> = {
  online: {
    label: '在线模型',
    description: '通过 API 调用，无需本地算力；未配置密钥时对应角色会回退或失败。',
  },
  local: {
    label: '本地模型',
    description: '在本机运行，离线可用；当前仅用于语音转写兜底。',
  },
}

const SCOPE_ORDER: ModelScope[] = ['online', 'local']
const ONLINE_PROVIDER_ORDER: ProviderId[] = ['dashscope', 'openrouter', 'openai-compatible']
const KIND_ORDER: ModelKind[] = ['chat', 'vision', 'asr', 'embedding', 'translation', 'rerank']

/** 模型的稳定标识：提供方 + 模型 id。角色归属判断与列表 key 都用它对齐。 */
export function modelKey(model: Pick<ModelCatalogEntry, 'id' | 'provider'>): string {
  return `${model.provider}:${model.id}`
}

/** 只有本地运行时能承担的角色。 */
const LOCAL_ONLY_ROLES: ModelRole[] = ['asr.local']

/** 本地运行时没有提供方记录，标题与说明在此固定，避免界面上出现 `local` 这样的裸标识。 */
const LOCAL_RUNTIME = {
  label: '本地运行时（faster-whisper）',
  note: '使用本机 Python 与 CTranslate2 模型目录推理，不消耗在线额度。',
} as const

export function scopeOf(provider: ProviderId): ModelScope {
  return provider === 'local' ? 'local' : 'online'
}

/** 模型能否承担某角色：先看能力类型是否一致，再看提供方是否支持该角色。 */
export function canServe(model: ModelCatalogEntry, role: ModelRole, roleKind: ModelKind): boolean {
  if (roleKind !== model.kind) {
    return false
  }
  if (model.provider === 'local') {
    return LOCAL_ONLY_ROLES.includes(role)
  }
  return !LOCAL_ONLY_ROLES.includes(role)
}

export function assignableRolesFor(model: ModelCatalogEntry, roleMeta: RoleMeta[]): ModelRole[] {
  return roleMeta.filter((meta) => canServe(model, meta.role, meta.kind)).map((meta) => meta.role)
}

export function groupModels(input: {
  models: ModelCatalogEntry[]
  providers: ProviderConfig[]
  roleMeta: RoleMeta[]
  routes: ModelRoute[]
}): ScopeGroup[] {
  const providerById = new Map(input.providers.map((provider) => [provider.id, provider]))

  const toCard = (model: ModelCatalogEntry): ModelCard => ({
    model,
    assignableRoles: assignableRolesFor(model, input.roleMeta),
    assignedRoles: input.routes
      .filter((route) => route.provider === model.provider && route.model === model.id)
      .map((route) => route.role),
  })

  return SCOPE_ORDER.map((scope) => {
    const providerIds =
      scope === 'online'
        ? ONLINE_PROVIDER_ORDER.filter((id) => Boolean(providerById.get(id)))
        : (['local'] as ProviderId[])

    const providers: ProviderGroup[] = providerIds.map((providerId) => {
      const provider = providerById.get(providerId) ?? null
      const models = input.models.filter((model) => model.provider === providerId)
      const cards = models.map(toCard)
      const kinds: KindGroup[] = KIND_ORDER.filter((kind) => cards.some((card) => card.model.kind === kind)).map(
        (kind) => ({
          kind,
          label: KIND_LABELS[kind],
          models: cards
            .filter((card) => card.model.kind === kind)
            .sort((left, right) => left.model.label.localeCompare(right.model.label, 'zh-CN')),
        }),
      )

      return {
        provider,
        providerId,
        label: provider?.label ?? LOCAL_RUNTIME.label,
        note: provider?.note ?? LOCAL_RUNTIME.note,
        models: cards,
        kinds,
      }
    })

    return { scope, ...SCOPE_LABELS[scope], providers }
  })
}

/**
 * 把某个角色指给一个模型。角色是「谁来做这件事」，因此同一角色只保留一个模型：
 * 目标模型接管该角色，其余路由保持不变。
 */
export function assignRole(input: {
  model: ModelCatalogEntry
  role: ModelRole
  roleMeta: RoleMeta[]
  routes: ModelRoute[]
}): ModelRoute[] {
  const existing = input.routes.find((route) => route.role === input.role)
  const meta = input.roleMeta.find((item) => item.role === input.role)
  const order = (role: ModelRole) => input.roleMeta.findIndex((item) => item.role === role)

  const updated: ModelRoute[] = [
    ...input.routes.filter((route) => route.role !== input.role),
    {
      role: input.role,
      provider: input.model.provider,
      model: input.model.id,
      // label 描述的是角色本身，因此以角色元信息为准，避免与实际模型脱节。
      label: meta?.label || existing?.label || input.role,
      allowFallback: existing?.allowFallback ?? true,
      temperature: existing?.temperature ?? 0.3,
      maxTokens: existing?.maxTokens ?? 8000,
    },
  ]

  return updated.sort((left, right) => order(left.role) - order(right.role))
}
