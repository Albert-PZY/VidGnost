import { describe, expect, it } from 'vitest'

import type { ModelCatalogEntry, ModelRoute, ProviderConfig, ProviderProtocolInfo } from '@vidgnost/contracts'

import {
  assignRole,
  assignableRolesFor,
  canServe,
  channelModelCount,
  groupModels,
  modelKey,
  rolesUsingChannel,
  rolesUsingModel,
  type RoleMeta,
} from './model-groups'

const ROLE_META: RoleMeta[] = [
  { role: 'llm.fast', label: '快速模型', purpose: '', kind: 'chat' },
  { role: 'llm.balanced', label: '均衡模型', purpose: '', kind: 'chat' },
  { role: 'llm.fallback', label: '兜底模型', purpose: '', kind: 'chat' },
  { role: 'vision.primary', label: '视觉模型', purpose: '', kind: 'vision' },
  { role: 'asr.online', label: '在线转写', purpose: '', kind: 'asr' },
  { role: 'asr.local', label: '本地转写', purpose: '', kind: 'asr' },
  { role: 'embedding', label: '向量模型', purpose: '', kind: 'embedding' },
  { role: 'rerank', label: '重排模型', purpose: '', kind: 'rerank' },
  { role: 'translate', label: '翻译模型', purpose: '', kind: 'translation' },
]

const PROTOCOLS: ProviderProtocolInfo[] = [
  {
    protocol: 'dashscope',
    label: 'DashScope 原生',
    kinds: ['chat', 'vision', 'embedding', 'asr', 'translation'],
    streaming: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    note: '',
  },
  {
    protocol: 'openai',
    label: 'OpenAI 兼容',
    kinds: ['chat', 'vision', 'embedding', 'rerank', 'asr', 'translation'],
    streaming: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    note: '自建端点也走这里',
  },
  {
    protocol: 'anthropic',
    label: 'Anthropic Messages',
    kinds: ['chat', 'vision', 'translation'],
    streaming: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    note: '不提供向量化与重排',
  },
  {
    protocol: 'gemini',
    label: 'Google Gemini',
    kinds: ['chat', 'vision', 'embedding', 'translation'],
    streaming: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    note: '还没有接入任何渠道',
  },
  {
    protocol: 'local',
    label: '本地运行时',
    kinds: ['asr'],
    streaming: false,
    defaultBaseUrl: '',
    note: '离线转写',
  },
]

const MODELS: ModelCatalogEntry[] = [
  { id: 'qwen3.8-flash', provider: 'dashscope', kind: 'chat', label: 'Qwen3.8 Flash', description: '', tags: [], free: true },
  { id: 'qwen3.8-27b', provider: 'dashscope', kind: 'chat', label: 'Qwen3.8 27B', description: '', tags: [], free: true },
  { id: 'qwen3.8-omni-flash', provider: 'dashscope', kind: 'vision', label: 'Omni Flash', description: '', tags: [] },
  { id: 'qwen-audio-asr', provider: 'dashscope', kind: 'asr', label: 'Qwen Audio ASR', description: '', tags: [] },
  { id: 'embedding-flash', provider: 'dashscope', kind: 'embedding', label: 'Embedding Flash', description: '', tags: [] },
  { id: 'nemotron-rerank', provider: 'openrouter', kind: 'rerank', label: 'Nemotron Rerank', description: '', tags: [] },
  { id: 'bge-m3', provider: 'my-gateway', kind: 'embedding', label: 'BGE M3', description: '', tags: [], dimensions: 1024, custom: true },
  { id: 'claude-sonnet', provider: 'anthropic-cn', kind: 'chat', label: 'Claude Sonnet', description: '', tags: [], custom: true },
  { id: 'faster-whisper', provider: 'local', kind: 'asr', label: 'Faster Whisper', description: '', tags: [] },
]

function provider(
  id: string,
  label: string,
  protocol: ProviderConfig['protocol'],
  models: ProviderConfig['models'] = [],
  enabled = true,
): ProviderConfig {
  return {
    id,
    label,
    protocol,
    builtin: !models.length && id !== 'my-gateway',
    baseUrl: `https://${id}.example.com`,
    enabled,
    auth: { source: 'env', envVar: 'X' },
    credentialStatus: { present: true, masked: 'sk-…1234', origin: 'env' },
    models,
  }
}

const PROVIDERS: ProviderConfig[] = [
  provider('dashscope', '阿里云百炼', 'dashscope'),
  provider('openrouter', 'OpenRouter', 'openrouter'),
  provider('my-gateway', '内网网关', 'openai', [
    { id: 'bge-m3', label: 'BGE M3', kind: 'embedding', dimensions: 1024 },
  ]),
  provider('anthropic-cn', 'Claude 中转', 'anthropic', [
    { id: 'claude-sonnet', label: 'Claude Sonnet', kind: 'chat' },
  ]),
  provider('local', '本地运行时（faster-whisper）', 'local'),
]

const ROUTES: ModelRoute[] = [
  { role: 'llm.fast', provider: 'dashscope', model: 'qwen3.8-flash', label: '快速模型', allowFallback: true },
  { role: 'llm.balanced', provider: 'dashscope', model: 'qwen3.8-27b', label: '均衡模型', allowFallback: true },
  { role: 'rerank', provider: 'openrouter', model: 'nemotron-rerank', label: '重排模型', allowFallback: false },
  { role: 'asr.local', provider: 'local', model: 'faster-whisper', label: '本地转写', allowFallback: false },
]

const SECTIONS = groupModels({
  models: MODELS,
  protocols: PROTOCOLS,
  providers: PROVIDERS,
  roleMeta: ROLE_META,
  routes: ROUTES,
})

function section(kind: ModelCatalogEntry['kind']) {
  const found = SECTIONS.find((item) => item.kind === kind)
  if (!found) {
    throw new Error(`缺少类别：${kind}`)
  }
  return found
}

function protocolGroup(kind: ModelCatalogEntry['kind'], protocol: ProviderConfig['protocol']) {
  const found = section(kind).protocols.find((item) => item.protocol === protocol)
  if (!found) {
    throw new Error(`类别 ${kind} 下缺少协议：${protocol}`)
  }
  return found
}

describe('modelKey', () => {
  it('combines channel and model so同名模型不会互相覆盖', () => {
    expect(modelKey({ id: 'bge-m3', provider: 'my-gateway' })).toBe('my-gateway:bge-m3')
    expect(modelKey({ id: 'bge-m3', provider: 'other' })).not.toBe(modelKey({ id: 'bge-m3', provider: 'my-gateway' }))
  })
})

describe('canServe', () => {
  it('keeps local transcription to the local runtime', () => {
    const localModel = MODELS.find((model) => model.id === 'faster-whisper')!
    const onlineModel = MODELS.find((model) => model.id === 'qwen-audio-asr')!
    expect(canServe(localModel, 'asr.local', 'asr')).toBe(true)
    expect(canServe(onlineModel, 'asr.local', 'asr')).toBe(false)
    expect(canServe(localModel, 'asr.online', 'asr')).toBe(false)
    expect(canServe(onlineModel, 'asr.online', 'asr')).toBe(true)
  })

  it('requires the capability kind to match', () => {
    const chatModel = MODELS.find((model) => model.id === 'qwen3.8-flash')!
    expect(canServe(chatModel, 'embedding', 'embedding')).toBe(false)
  })
})

describe('assignableRolesFor', () => {
  it('lists only the roles of the same kind', () => {
    const embedding = MODELS.find((model) => model.id === 'bge-m3')!
    expect(assignableRolesFor(embedding, ROLE_META)).toEqual(['embedding'])
  })
})

describe('groupModels', () => {
  it('orders sections by category, not by provider', () => {
    expect(SECTIONS.map((item) => item.kind)).toEqual([
      'chat',
      'vision',
      'embedding',
      'rerank',
      'asr',
      'translation',
    ])
  })

  it('groups everything of one kind under its protocol', () => {
    // 对话模型下同时出现内置的 DashScope 渠道与自定义的 Anthropic 渠道。
    expect(protocolGroup('chat', 'dashscope').modelCount).toBe(2)
    expect(protocolGroup('chat', 'anthropic').modelCount).toBe(1)
    expect(protocolGroup('chat', 'anthropic').channels[0].provider.label).toBe('Claude 中转')
  })

  it('drops protocols that cannot serve the kind', () => {
    const embeddingProtocols = section('embedding').protocols.map((item) => item.protocol)
    expect(embeddingProtocols).not.toContain('anthropic')
    expect(embeddingProtocols).not.toContain('local')

    // 本地运行时只出现在转写类别里。
    const asrProtocols = section('asr').protocols.map((item) => item.protocol)
    expect(asrProtocols).toContain('local')
    expect(section('rerank').protocols.map((item) => item.protocol)).not.toContain('dashscope')
  })

  it('keeps protocols without any channel so one can be added there', () => {
    const gemini = protocolGroup('chat', 'gemini')
    expect(gemini.channels).toHaveLength(0)
    expect(gemini.modelCount).toBe(0)
    expect(gemini.note).toBe('还没有接入任何渠道')
  })

  it('lists an enabled channel under every kind its protocol supports', () => {
    // 内网网关是 OpenAI 兼容渠道：它在转写类别下没有模型，但仍要出现，才能继续接入转写模型。
    const asr = protocolGroup('asr', 'openai')
    expect(asr.channels.map((channel) => channel.provider.id)).toEqual(['my-gateway'])
    expect(asr.modelCount).toBe(0)
  })

  it('counts models per section from the channels below it', () => {
    expect(section('chat').modelCount).toBe(3)
    expect(section('embedding').modelCount).toBe(2)
    expect(section('translation').modelCount).toBe(0)
  })

  it('marks custom models and reports the roles each one carries', () => {
    const custom = protocolGroup('embedding', 'openai').channels[0].models[0]
    expect(custom.model.custom).toBe(true)
    expect(custom.model.dimensions).toBe(1024)

    const flash = protocolGroup('chat', 'dashscope').channels[0].models.find(
      (card) => card.model.id === 'qwen3.8-flash',
    )!
    expect(flash.assignedRoles).toEqual(['llm.fast'])
  })

  it('hides a disabled channel that has nothing to show in this kind', () => {
    const sections = groupModels({
      models: MODELS,
      protocols: PROTOCOLS,
      providers: [...PROVIDERS, provider('idle', '停用的渠道', 'openai', [], false)],
      roleMeta: ROLE_META,
      routes: ROUTES,
    })
    const openai = sections.find((item) => item.kind === 'chat')!.protocols.find((item) => item.protocol === 'openai')!
    expect(openai.channels.map((channel) => channel.provider.id)).not.toContain('idle')
  })

  it('keeps a disabled channel that still owns models', () => {
    const sections = groupModels({
      models: MODELS,
      protocols: PROTOCOLS,
      providers: PROVIDERS.map((item) =>
        item.id === 'my-gateway' ? { ...item, enabled: false } : item,
      ),
      roleMeta: ROLE_META,
      routes: ROUTES,
    })
    const openai = sections.find((item) => item.kind === 'embedding')!.protocols.find((item) => item.protocol === 'openai')!
    expect(openai.channels.map((channel) => channel.provider.id)).toContain('my-gateway')
  })
})

describe('rolesUsingChannel / rolesUsingModel', () => {
  it('reports which roles block a deletion', () => {
    expect(rolesUsingChannel(ROUTES, 'dashscope')).toEqual(['快速模型', '均衡模型'])
    expect(rolesUsingChannel(ROUTES, 'anthropic-cn')).toEqual([])
    expect(rolesUsingModel(ROUTES, 'dashscope', 'qwen3.8-flash')).toEqual(['快速模型'])
    expect(rolesUsingModel(ROUTES, 'dashscope', 'qwen3.8-27b')).toEqual(['均衡模型'])
  })
})

describe('channelModelCount', () => {
  it('counts only the requested kind', () => {
    expect(channelModelCount(PROVIDERS, 'my-gateway', 'embedding')).toBe(1)
    expect(channelModelCount(PROVIDERS, 'my-gateway', 'chat')).toBe(0)
    expect(channelModelCount(PROVIDERS, 'missing', 'chat')).toBe(0)
  })
})

describe('assignRole', () => {
  it('moves the role to the new model and keeps every other route', () => {
    const target = MODELS.find((model) => model.id === 'claude-sonnet')!
    const next = assignRole({ model: target, role: 'llm.fast', roleMeta: ROLE_META, routes: ROUTES })

    const fast = next.find((route) => route.role === 'llm.fast')!
    expect(fast.provider).toBe('anthropic-cn')
    expect(fast.model).toBe('claude-sonnet')
    // label 描述角色本身，不跟着模型走。
    expect(fast.label).toBe('快速模型')
    expect(next).toHaveLength(ROUTES.length)
  })

  it('keeps the previous generation parameters of the role', () => {
    const routes: ModelRoute[] = [
      { role: 'llm.fast', provider: 'dashscope', model: 'a', label: '快速模型', allowFallback: false, temperature: 1.1, maxTokens: 4096 },
    ]
    const target = MODELS.find((model) => model.id === 'claude-sonnet')!
    const next = assignRole({ model: target, role: 'llm.fast', roleMeta: ROLE_META, routes })
    expect(next[0].temperature).toBe(1.1)
    expect(next[0].maxTokens).toBe(4096)
    expect(next[0].allowFallback).toBe(false)
  })

  it('returns routes ordered by the role table', () => {
    const target = MODELS.find((model) => model.id === 'claude-sonnet')!
    const next = assignRole({ model: target, role: 'llm.fallback', roleMeta: ROLE_META, routes: ROUTES })
    expect(next.map((route) => route.role)).toEqual([
      'llm.fast',
      'llm.balanced',
      'llm.fallback',
      'asr.local',
      'rerank',
    ])
  })
})
