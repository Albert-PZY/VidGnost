import { describe, expect, it } from 'vitest'

import type { ModelCatalogEntry, ModelRoute, ProviderConfig } from '@vidgnost/contracts'

import { assignRole, assignableRolesFor, canServe, groupModels, modelKey, scopeOf, type RoleMeta } from './model-groups'

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

const MODELS: ModelCatalogEntry[] = [
  { id: 'qwen3.8-flash', provider: 'dashscope', kind: 'chat', label: 'Qwen3.8 Flash', description: '', tags: [], free: true },
  { id: 'qwen3.8-27b', provider: 'dashscope', kind: 'chat', label: 'Qwen3.8 27B', description: '', tags: [], free: true },
  { id: 'qwen3.8-omni-flash', provider: 'dashscope', kind: 'vision', label: 'Omni Flash', description: '', tags: [] },
  { id: 'qwen-audio-asr', provider: 'dashscope', kind: 'asr', label: 'Qwen Audio ASR', description: '', tags: [] },
  { id: 'embedding-flash', provider: 'dashscope', kind: 'embedding', label: 'Embedding Flash', description: '', tags: [] },
  { id: 'nemotron-rerank', provider: 'openrouter', kind: 'rerank', label: 'Nemotron Rerank', description: '', tags: [] },
  { id: 'faster-whisper', provider: 'local', kind: 'asr', label: 'Faster Whisper', description: '', tags: [] },
]

function provider(id: ProviderConfig['id'], label: string): ProviderConfig {
  return {
    id,
    label,
    baseUrl: `https://${id}.example.com`,
    enabled: true,
    auth: { source: 'env', envVar: 'X' },
    credentialStatus: { present: true, masked: 'sk-…1234', origin: 'env' },
  }
}

const PROVIDERS: ProviderConfig[] = [
  provider('dashscope', '阿里云百炼'),
  provider('openrouter', 'OpenRouter'),
  provider('openai-compatible', 'OpenAI 兼容'),
]

const ROUTES: ModelRoute[] = [
  { role: 'llm.fast', provider: 'dashscope', model: 'qwen3.8-flash', label: '快速模型', allowFallback: true },
  { role: 'llm.balanced', provider: 'dashscope', model: 'qwen3.8-27b', label: '均衡模型', allowFallback: true },
  { role: 'rerank', provider: 'openrouter', model: 'nemotron-rerank', label: '重排模型', allowFallback: false },
  { role: 'asr.local', provider: 'local', model: 'faster-whisper', label: '本地转写', allowFallback: false },
]

describe('scopeOf', () => {
  it('splits local from online providers', () => {
    expect(scopeOf('local')).toBe('local')
    expect(scopeOf('dashscope')).toBe('online')
    expect(scopeOf('openrouter')).toBe('online')
    expect(scopeOf('openai-compatible')).toBe('online')
  })
})

describe('modelKey', () => {
  it('identifies a model by provider and id together', () => {
    expect(modelKey({ provider: 'dashscope', id: 'qwen3.8-flash' })).toBe('dashscope:qwen3.8-flash')
    expect(modelKey({ provider: 'local', id: 'faster-whisper' })).toBe('local:faster-whisper')
  })

  it('keeps the same model id on different providers apart', () => {
    expect(modelKey({ provider: 'openrouter', id: 'qwen3.8-flash' })).not.toBe(
      modelKey({ provider: 'dashscope', id: 'qwen3.8-flash' }),
    )
  })
})

describe('canServe', () => {
  const chat = MODELS[0]
  const localAsr = MODELS[6]

  it('requires a matching capability kind', () => {
    expect(canServe(chat, 'llm.fast', 'chat')).toBe(true)
    expect(canServe(chat, 'vision.primary', 'vision')).toBe(false)
  })

  it('lets online models take online roles only', () => {
    expect(canServe(chat, 'asr.online', 'asr')).toBe(false)
    expect(canServe(MODELS[3], 'asr.online', 'asr')).toBe(true)
    expect(canServe(MODELS[3], 'asr.local', 'asr')).toBe(false)
  })

  it('lets the local runtime take only the local transcription role', () => {
    expect(canServe(localAsr, 'asr.local', 'asr')).toBe(true)
    expect(canServe(localAsr, 'asr.online', 'asr')).toBe(false)
    expect(canServe(localAsr, 'embedding', 'embedding')).toBe(false)
  })
})

describe('assignableRolesFor', () => {
  it('lists every chat role for a chat model', () => {
    expect(assignableRolesFor(MODELS[0], ROLE_META)).toEqual(['llm.fast', 'llm.balanced', 'llm.fallback'])
  })

  it('gives the local runtime a single option', () => {
    expect(assignableRolesFor(MODELS[6], ROLE_META)).toEqual(['asr.local'])
  })
})

describe('groupModels', () => {
  const groups = groupModels({ models: MODELS, providers: PROVIDERS, roleMeta: ROLE_META, routes: ROUTES })

  it('returns exactly two top-level scopes in order', () => {
    expect(groups.map((group) => group.scope)).toEqual(['online', 'local'])
    expect(groups[0].label).toBe('在线模型')
    expect(groups[1].label).toBe('本地模型')
  })

  it('keeps only online providers under the online scope', () => {
    expect(groups[0].providers.map((group) => group.providerId)).toEqual(['dashscope', 'openrouter', 'openai-compatible'])
    expect(groups[1].providers.map((group) => group.providerId)).toEqual(['local'])
  })

  it('assigns each model to its provider', () => {
    const dashscope = groups[0].providers.find((group) => group.providerId === 'dashscope')
    expect(dashscope?.models.map((card) => card.model.id)).toEqual([
      'qwen3.8-flash',
      'qwen3.8-27b',
      'qwen3.8-omni-flash',
      'qwen-audio-asr',
      'embedding-flash',
    ])
  })

  it('subdivides models by capability kind', () => {
    const dashscope = groups[0].providers.find((group) => group.providerId === 'dashscope')
    expect(dashscope?.kinds.map((kind) => kind.kind)).toEqual(['chat', 'vision', 'asr', 'embedding'])
    expect(dashscope?.kinds[0].label).toBe('对话模型')
  })

  it('reports the roles each model currently serves', () => {
    const dashscope = groups[0].providers.find((group) => group.providerId === 'dashscope')
    const flash = dashscope?.models.find((card) => card.model.id === 'qwen3.8-flash')
    const omni = dashscope?.models.find((card) => card.model.id === 'qwen3.8-omni-flash')
    expect(flash?.assignedRoles).toEqual(['llm.fast'])
    expect(omni?.assignedRoles).toEqual([])
  })

  it('keeps a provider with no models visible so its credentials stay reachable', () => {
    const compatible = groups[0].providers.find((group) => group.providerId === 'openai-compatible')
    expect(compatible?.models).toEqual([])
    expect(compatible?.provider).not.toBeNull()
  })

  it('names the local runtime instead of exposing the raw provider id', () => {
    const local = groups[1].providers[0]
    expect(local.label).toBe('本地运行时（faster-whisper）')
    expect(local.note).not.toBe('')
  })

  it('carries the provider record for credential rendering', () => {
    const dashscope = groups[0].providers.find((group) => group.providerId === 'dashscope')
    expect(dashscope?.provider?.credentialStatus.present).toBe(true)
    const local = groups[1].providers[0]
    expect(local.provider).toBeNull()
  })
})

describe('assignRole', () => {
  it('moves a role to the target model and keeps the canonical role order', () => {
    const next = assignRole({ model: MODELS[1], role: 'llm.fast', roleMeta: ROLE_META, routes: ROUTES })
    const fast = next.find((route) => route.role === 'llm.fast')
    expect(fast?.model).toBe('qwen3.8-27b')
    expect(fast?.provider).toBe('dashscope')
    // 顺序按角色元信息排列，与输入路由的书写顺序无关。
    expect(next.map((route) => route.role)).toEqual(['llm.fast', 'llm.balanced', 'asr.local', 'rerank'])
  })

  it('never lets two models claim the same role', () => {
    const next = assignRole({ model: MODELS[1], role: 'llm.fast', roleMeta: ROLE_META, routes: ROUTES })
    expect(next.filter((route) => route.role === 'llm.fast')).toHaveLength(1)
    expect(next.some((route) => route.role === 'llm.fast' && route.model === 'qwen3.8-flash')).toBe(false)
  })

  it('keeps the role label describing the role, not the model', () => {
    const next = assignRole({ model: MODELS[0], role: 'vision.primary', roleMeta: ROLE_META, routes: ROUTES })
    expect(next.find((route) => route.role === 'vision.primary')?.label).toBe('视觉模型')
  })

  it('preserves fallback and sampling settings of the route it replaces', () => {
    const withOptions: ModelRoute[] = [{ role: 'llm.fast', provider: 'dashscope', model: 'qwen3.8-flash', label: '快速模型', allowFallback: false, temperature: 0.9, maxTokens: 1234 }]
    const next = assignRole({ model: MODELS[1], role: 'llm.fast', roleMeta: ROLE_META, routes: withOptions })
    expect(next[0].allowFallback).toBe(false)
    expect(next[0].temperature).toBe(0.9)
    expect(next[0].maxTokens).toBe(1234)
  })

  it('starts a brand new role with safe defaults', () => {
    const next = assignRole({ model: MODELS[6], role: 'asr.local', roleMeta: ROLE_META, routes: [] })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ role: 'asr.local', provider: 'local', model: 'faster-whisper', allowFallback: true })
  })

  it('lets the local runtime take over local transcription', () => {
    const next = assignRole({ model: MODELS[6], role: 'asr.local', roleMeta: ROLE_META, routes: ROUTES })
    expect(next.find((route) => route.role === 'asr.local')?.model).toBe('faster-whisper')
    expect(next).toHaveLength(ROUTES.length)
  })
})
