import type {
  ModelCatalogEntry,
  ModelKind,
  ModelRole,
  ModelRoute,
  ProviderConfig,
  ProviderProtocol,
  ProviderProtocolInfo,
} from '@vidgnost/contracts'

/**
 * 模型页的派生视图：把「模型目录 + 渠道配置 + 角色路由」整理成
 * 「模型类别 → 协议 → 渠道 → 模型」四层。
 *
 * 之所以按类别分而不是按服务商分：用户要找的是「能向量化的模型」，
 * 服务商与协议只是达成手段；渠道（提供方记录）挂在协议下面，由用户自行接入。
 * 分组与角色兼容性都是纯函数，可以在没有界面的情况下验证。
 */

export interface RoleMeta {
  kind: ModelKind
  label: string
  purpose: string
  role: ModelRole
}

export interface ModelCard {
  /** 该模型可以承担哪些角色（按能力与渠道推导）。 */
  assignableRoles: ModelRole[]
  /** 该模型当前承担的角色。 */
  assignedRoles: ModelRole[]
  model: ModelCatalogEntry
}

export interface ChannelGroup {
  /** 渠道即提供方记录：协议 + Base URL + 凭据 + 已登记的模型。 */
  provider: ProviderConfig
  models: ModelCard[]
}

export interface ProtocolGroup {
  protocol: ProviderProtocol
  label: string
  note: string
  /** 该协议在该类别下已接入的渠道。 */
  channels: ChannelGroup[]
  modelCount: number
}

export interface KindSection {
  kind: ModelKind
  label: string
  modelCount: number
  protocols: ProtocolGroup[]
}

export const KIND_LABELS: Record<ModelKind, string> = {
  chat: '对话模型',
  vision: '多模态模型',
  embedding: '向量化模型',
  rerank: '重排序模型',
  asr: '语音转文字',
  translation: '翻译模型',
}

/** 类别顺序按流水线里的使用频率排：先对话，再视觉，其余按检索链路。 */
const KIND_ORDER: ModelKind[] = ['chat', 'vision', 'embedding', 'rerank', 'asr', 'translation']

/** 协议顺序：默认可用的 DashScope 在前，其余按通用性排。 */
const PROTOCOL_ORDER: ProviderProtocol[] = ['dashscope', 'openai', 'anthropic', 'gemini', 'openrouter', 'local']

/** 只有本地运行时能承担的角色。 */
const LOCAL_ONLY_ROLES: ModelRole[] = ['asr.local']

/** 模型的稳定标识：渠道 + 模型 id。角色归属判断与列表 key 都用它对齐。 */
export function modelKey(model: Pick<ModelCatalogEntry, 'id' | 'provider'>): string {
  return `${model.provider}:${model.id}`
}

/** 模型能否承担某角色：先看能力类型是否一致，再看它是否属于本地运行时。 */
export function canServe(model: ModelCatalogEntry, role: ModelRole, roleKind: ModelKind): boolean {
  if (roleKind !== model.kind) {
    return false
  }
  const isLocal = model.provider === 'local'
  return LOCAL_ONLY_ROLES.includes(role) ? isLocal : !isLocal
}

export function assignableRolesFor(model: ModelCatalogEntry, roleMeta: RoleMeta[]): ModelRole[] {
  return roleMeta.filter((meta) => canServe(model, meta.role, meta.kind)).map((meta) => meta.role)
}

export function groupModels(input: {
  models: ModelCatalogEntry[]
  /** 目录接口缺这个字段时按空处理：前端比后端新时要能给出提示，而不是整页抛错。 */
  protocols?: ProviderProtocolInfo[]
  providers: ProviderConfig[]
  roleMeta: RoleMeta[]
  routes: ModelRoute[]
}): KindSection[] {
  const toCard = (model: ModelCatalogEntry): ModelCard => ({
    model,
    assignableRoles: assignableRolesFor(model, input.roleMeta),
    assignedRoles: input.routes
      .filter((route) => route.provider === model.provider && route.model === model.id)
      .map((route) => route.role),
  })

  const orderedProtocols = [...(input.protocols ?? [])].sort(
    (left, right) => PROTOCOL_ORDER.indexOf(left.protocol) - PROTOCOL_ORDER.indexOf(right.protocol),
  )

  return KIND_ORDER.map((kind) => {
    const protocols: ProtocolGroup[] = orderedProtocols
      .filter((info) => info.kinds.includes(kind))
      .map((info) => {
        const channels: ChannelGroup[] = input.providers
          .filter((provider) => provider.protocol === info.protocol)
          .map((provider) => ({
            provider,
            models: input.models
              .filter((model) => model.provider === provider.id && model.kind === kind)
              .map(toCard)
              .sort((left, right) => left.model.label.localeCompare(right.model.label, 'zh-CN')),
          }))
          // 没有该类模型的渠道只在启用时保留，否则会在六个类别里重复出现。
          .filter((channel) => channel.models.length > 0 || channel.provider.enabled)

        return {
          protocol: info.protocol,
          label: info.label,
          note: info.note,
          channels,
          modelCount: channels.reduce((sum, channel) => sum + channel.models.length, 0),
        }
      })

    return {
      kind,
      label: KIND_LABELS[kind],
      modelCount: protocols.reduce((sum, group) => sum + group.modelCount, 0),
      protocols,
    }
  })
}

/** 某渠道在某类别下已登记的模型数量。 */
export function channelModelCount(providers: ProviderConfig[], providerId: string, kind: ModelKind): number {
  const provider = providers.find((item) => item.id === providerId)
  return provider ? provider.models.filter((model) => model.kind === kind).length : 0
}

/** 渠道是否被角色引用，返回占用它的角色标签。界面据此禁用删除。 */
export function rolesUsingChannel(routes: ModelRoute[], providerId: string): string[] {
  return routes.filter((route) => route.provider === providerId).map((route) => route.label || route.role)
}

/** 某个模型是否被角色引用，返回占用它的角色标签。 */
export function rolesUsingModel(routes: ModelRoute[], providerId: string, modelId: string): string[] {
  return routes
    .filter((route) => route.provider === providerId && route.model === modelId)
    .map((route) => route.label || route.role)
}

/**
 * 把某个角色指给一个模型。角色回答的是「谁来做这件事」，因此同一角色只保留一个模型：
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
