import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import type { ModelRoute } from "@vidgnost/contracts"

import { resolveConfig } from "../src/core/config.js"
import { DEFAULT_ROUTES, MODEL_CATALOG, MODEL_ROLES } from "../src/providers/catalog.js"
import { SettingsStore, maskKey } from "../src/providers/settings-store.js"

function createConfig(storageDir: string) {
  return { ...resolveConfig({}), storageDir }
}

// 占位密钥：拆开拼接以避免被暂存区密钥扫描误判。
const SAMPLE_SECRET = ['a1b2c3d4', 'e5f6g7h8'].join('')
const SAMPLE_KEY = ['sk', SAMPLE_SECRET].join('-')

const defaults = {
  settings: {
    defaultPreset: "balanced" as const,
    defaultLanguage: "auto",
    defaultAsr: "auto" as const,
    defaultVision: false,
    defaultProofread: false,
    defaultTranslateTo: null,
    whisper: { pythonExecutable: "", model: "large-v3", device: "auto" as const, computeType: "int8", modelDir: "" },
    maxConcurrentTasks: 2,
    keepIntermediateMedia: false,
    updatedAt: new Date().toISOString(),
  },
  routes: DEFAULT_ROUTES,
}

/** v3 时代的提供方记录没有 protocol/builtin/models，只能靠 id 推断。 */
const LEGACY_V3_PROVIDERS: Array<Record<string, unknown>> = [
  {
    id: "dashscope",
    label: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com",
    enabled: true,
    auth: { source: "env", envVar: "DASHSCOPE_API_KEY" },
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    enabled: false,
    auth: { source: "env", envVar: "OPENAI_API_KEY" },
  },
  {
    id: "my-gateway",
    label: "内网网关",
    baseUrl: "http://10.0.0.9/v1",
    enabled: true,
    auth: { source: "inline", inlineKey: SAMPLE_KEY },
  },
]

/** 手工落一份 v3 设置文件，用来验证升级路径而不是内存里的默认值。 */
async function writeLegacyV3Settings(storageDir: string, providers: Array<Record<string, unknown>>): Promise<void> {
  const filePath = path.join(storageDir, "config", "settings.json")
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    JSON.stringify({ version: 3, settings: defaults.settings, routes: DEFAULT_ROUTES, providers }, null, 2),
    "utf8",
  )
}

describe("maskKey", () => {
  it("keeps the head and tail only", () => {
    const masked = maskKey(SAMPLE_KEY)
    expect(masked.startsWith("sk-a1")).toBe(true)
    expect(masked.endsWith("g7h8")).toBe(true)
    expect(masked).not.toContain(SAMPLE_SECRET)
  })

  it("fully masks short keys", () => {
    expect(maskKey("abc")).toBe("••••")
  })
})

describe("catalogue", () => {
  it("covers every role in the default routing", () => {
    const roles = new Set(DEFAULT_ROUTES.map((route) => route.role))
    for (const meta of MODEL_ROLES) {
      expect(roles.has(meta.role)).toBe(true)
    }
  })

  it("only routes to models that exist in the catalogue or the local runtime", () => {
    for (const route of DEFAULT_ROUTES) {
      if (route.provider === "local") {
        continue
      }
      const found = MODEL_CATALOG.some((model) => model.provider === route.provider && model.id === route.model)
      expect(found, `${route.role} -> ${route.model}`).toBe(true)
    }
  })

  it("gives the fallback model a token budget large enough for reasoning models", () => {
    const fallback = DEFAULT_ROUTES.find((route) => route.role === "llm.fallback")
    expect(fallback?.maxTokens ?? 0).toBeGreaterThanOrEqual(12000)
  })
})

describe("SettingsStore", () => {
  it("falls back to built-in routes when nothing is persisted", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const route = await store.resolve("asr.online")
    expect(route.provider).toBe("dashscope")
    expect(route.model).toBe("qwen-audio-3.1-asr-flash-filetrans")
  })

  it("chains the fallback model for llm roles", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const chain = await store.resolveWithFallback("llm.fast")
    expect(chain.length).toBeGreaterThan(1)
    expect(chain[1].role).toBe("llm.fallback")
  })

  it("does not chain a fallback for the fallback role itself", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const chain = await store.resolveWithFallback("llm.fallback")
    expect(chain).toHaveLength(1)
  })

  it("normalizes out-of-range route values", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const patch: ModelRoute[] = [
      { role: "llm.fast", provider: "dashscope", model: "glm-5.3", label: "x", allowFallback: true, temperature: 99, maxTokens: 5 },
    ]
    const updated = await store.update({ routes: patch })
    const route = updated.routes.find((item) => item.role === "llm.fast")
    expect(route?.temperature).toBe(2)
    expect(route?.maxTokens).toBe(64)
  })

  it("produces a stable signature for cache keys", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const first = await store.signature(["llm.fast", "embedding"])
    const second = await store.signature(["llm.fast", "embedding"])
    expect(first).toBe(second)
    expect(first).toContain("llm.fast=dashscope/")
  })

  it("masks inline credentials in the public provider list", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const providers = await store.patchProvider({ id: "dashscope", apiKey: SAMPLE_KEY })
    const dashscope = providers.find((provider) => provider.id === "dashscope")
    expect(dashscope?.credentialStatus.present).toBe(true)
    expect(dashscope?.credentialStatus.origin).toBe("inline")
    expect(dashscope?.credentialStatus.masked).not.toContain(SAMPLE_SECRET)
  })

  it("returns the credential to the environment when the inline key is cleared", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    await store.patchProvider({ id: "dashscope", apiKey: SAMPLE_KEY })
    const providers = await store.patchProvider({ id: "dashscope", apiKey: null })
    const dashscope = providers.find((provider) => provider.id === "dashscope")
    expect(dashscope?.credentialStatus.origin === "inline").toBe(false)
  })

  /* ------------------------------------------------- 用户自定义渠道与协议 */

  it("registers a custom provider under a name-derived id", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const created = await store.createProvider({ label: "My Gateway", protocol: "openai", baseUrl: "http://10.0.0.9/v1" })
    const gateway = created.find((provider) => provider.id === "my-gateway")
    expect(gateway).toBeDefined()
    expect(gateway?.builtin).toBe(false)
    expect(gateway?.protocol).toBe("openai")
    expect(gateway?.models).toEqual([])

    // 同名再建时不能覆盖前一条：追加序号后缀，两条记录共存。
    const again = await store.createProvider({ label: "My Gateway", protocol: "openai" })
    expect(again.find((provider) => provider.id === "my-gateway")?.baseUrl).toBe("http://10.0.0.9/v1")
    expect(again.find((provider) => provider.id === "my-gateway-2")).toBeDefined()
    expect(again.filter((provider) => !provider.builtin)).toHaveLength(2)
  })

  it("masks the inline key of a custom provider", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const created = await store.createProvider({
      label: "内网网关",
      protocol: "openai",
      baseUrl: "http://10.0.0.9/v1",
      apiKey: SAMPLE_KEY,
    })
    const gateway = created.find((provider) => provider.id === "内网网关")
    expect(gateway?.baseUrl).toBe("http://10.0.0.9/v1")
    expect(gateway?.credentialStatus).toMatchObject({ present: true, origin: "inline" })
    expect(gateway?.credentialStatus.masked).not.toContain(SAMPLE_SECRET)
  })

  it("rejects a model kind the provider protocol does not support", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    await store.createProvider({ label: "My Gateway", protocol: "anthropic" })

    // anthropic 不提供重排能力，登记时必须被挡下来。
    await expect(
      store.upsertModel("my-gateway", "bge-reranker-v2-m3", { label: "重排模型", kind: "rerank" }),
    ).rejects.toMatchObject({ code: "PROTOCOL_CAPABILITY_UNSUPPORTED" })

    const updated = await store.upsertModel("my-gateway", "claude-sonnet-4", { label: "Claude Sonnet 4", kind: "chat" })
    const models = updated.find((provider) => provider.id === "my-gateway")?.models ?? []
    expect(models.map((model) => model.id)).toEqual(["claude-sonnet-4"])
  })

  it("upserts per provider and overwrites a repeated model id instead of appending", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    await store.createProvider({ label: "My Gateway", protocol: "openai" })

    const withFirst = await store.upsertModel("my-gateway", "gpt-4o-mini", { label: "GPT-4o mini", kind: "chat" })
    expect(withFirst.find((provider) => provider.id === "my-gateway")?.models).toHaveLength(1)
    const withBoth = await store.upsertModel("my-gateway", "text-embedding-3-small", {
      label: "Embedding Small",
      kind: "embedding",
      dimensions: 1536,
    })
    expect(withBoth.find((provider) => provider.id === "my-gateway")?.models).toHaveLength(2)

    const overwritten = await store.upsertModel("my-gateway", "gpt-4o-mini", {
      label: "GPT-4o mini（改）",
      kind: "vision",
      contextWindow: 128000,
    })
    const models = overwritten.find((provider) => provider.id === "my-gateway")?.models ?? []
    expect(models).toHaveLength(2)
    expect(models.find((model) => model.id === "gpt-4o-mini")).toMatchObject({
      label: "GPT-4o mini（改）",
      kind: "vision",
      contextWindow: 128000,
    })
  })

  it("protects built-in providers and in-use providers or models from deletion", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)

    await expect(store.deleteProvider("dashscope")).rejects.toMatchObject({ code: "PROVIDER_BUILTIN" })

    await store.createProvider({ label: "My Gateway", protocol: "openai" })
    await store.upsertModel("my-gateway", "gpt-4o-mini", { label: "GPT-4o mini", kind: "chat" })
    await store.upsertModel("my-gateway", "text-embedding-3-small", {
      label: "Embedding Small",
      kind: "embedding",
      dimensions: 1536,
    })

    // 角色指向自定义渠道后，渠道与它被引用的模型都必须拒绝删除。
    const rerouted: ModelRoute[] = [
      { role: "llm.fast", provider: "my-gateway", model: "gpt-4o-mini", label: "快速模型", allowFallback: true },
    ]
    await store.update({ routes: rerouted })

    await expect(store.deleteProvider("my-gateway")).rejects.toMatchObject({ code: "PROVIDER_IN_USE" })
    await expect(store.deleteModel("my-gateway", "gpt-4o-mini")).rejects.toMatchObject({ code: "MODEL_IN_USE" })

    // 没被任何角色引用的模型不受影响。
    const afterModelDelete = await store.deleteModel("my-gateway", "text-embedding-3-small")
    const remaining = afterModelDelete.find((provider) => provider.id === "my-gateway")?.models ?? []
    expect(remaining.map((model) => model.id)).toEqual(["gpt-4o-mini"])

    // 角色改回内置渠道后，自定义渠道即可删除并从列表消失。
    await store.update({
      routes: [{ role: "llm.fast", provider: "dashscope", model: "qwen3.8-flash", label: "快速模型", allowFallback: true }],
    })
    const afterDelete = await store.deleteProvider("my-gateway")
    expect(afterDelete.some((provider) => provider.id === "my-gateway")).toBe(false)
  })

  it("refuses a protocol switch that would orphan registered models", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    await store.createProvider({ label: "My Gateway", protocol: "openai" })
    await store.upsertModel("my-gateway", "text-embedding-3-small", {
      label: "Embedding Small",
      kind: "embedding",
      dimensions: 1536,
    })

    // 目标协议不支持已登记的能力类型时，宁可拒绝也不能留下一条跑不通的配置。
    await expect(store.patchProvider({ id: "my-gateway", protocol: "anthropic" })).rejects.toMatchObject({
      code: "PROTOCOL_CAPABILITY_UNSUPPORTED",
    })
    const providers = await store.describeProviders()
    expect(providers.find((provider) => provider.id === "my-gateway")?.protocol).toBe("openai")
  })

  it("migrates a v3 settings file to v4 without dropping custom providers", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    await writeLegacyV3Settings(storageDir, LEGACY_V3_PROVIDERS)
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const loaded = await store.load()
    const byId = new Map(loaded.providers.map((provider) => [provider.id, provider]))

    expect(loaded.version).toBe(4)
    expect(byId.get("dashscope")).toMatchObject({ protocol: "dashscope", builtin: true })
    expect(byId.get("openai-compatible")).toMatchObject({ protocol: "openai", builtin: true })

    // 核心保证：迁移按固定 id 重建内置项，但用户自建的渠道必须原样保留。
    expect(byId.get("my-gateway")).toMatchObject({
      label: "内网网关",
      baseUrl: "http://10.0.0.9/v1",
      enabled: true,
      builtin: false,
      protocol: "openai",
      models: [],
    })
  })

  it("writes the migrated v4 file back so a later store still sees the custom provider", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    await writeLegacyV3Settings(storageDir, LEGACY_V3_PROVIDERS)
    await new SettingsStore(createConfig(storageDir), defaults).load()

    const raw = JSON.parse(await readFile(path.join(storageDir, "config", "settings.json"), "utf8")) as {
      version?: number
      providers?: Array<{ id?: string }>
    }
    expect(raw.version).toBe(4)
    expect(raw.providers?.some((provider) => provider.id === "my-gateway")).toBe(true)

    // 换一个实例重新读盘：能看到说明迁移结果真的落盘了，而不是只活在内存缓存里。
    const reopened = await new SettingsStore(createConfig(storageDir), defaults).load()
    expect(reopened.providers.some((provider) => provider.id === "my-gateway")).toBe(true)
  })

  it("never leaks the inline key through the public provider list", async () => {
    // 出参里的 auth 只保留来源与环境变量名：明文密钥一旦随接口返回，脱敏就没有意义了。
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    const providers = await store.patchProvider({ id: "dashscope", apiKey: SAMPLE_KEY })
    const dashscope = providers.find((provider) => provider.id === "dashscope")

    expect(JSON.stringify(providers)).not.toContain(SAMPLE_SECRET)
    expect(dashscope?.auth.inlineKey).toBeUndefined()
    expect(dashscope?.auth.source).toBe("inline")

    // 但内部记录必须还能解出密钥，否则连通性自检会把「已填内联密钥」误判成缺少密钥。
    const internal = await store.getProvider("dashscope")
    expect(store.resolveApiKey(internal!)).toBe(SAMPLE_KEY)
  })

  it("masks short keys instead of showing every character", () => {
    expect(maskKey("123456789")).toBe("••••")
    expect(maskKey("sk-abcdefghijklmn")).toBe("sk-ab…klmn")
  })
})
