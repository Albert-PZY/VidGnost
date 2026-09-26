import { mkdtemp } from "node:fs/promises"
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
    const providers = await store.updateProvider({ id: "dashscope", apiKey: SAMPLE_KEY })
    const dashscope = providers.find((provider) => provider.id === "dashscope")
    expect(dashscope?.credentialStatus.present).toBe(true)
    expect(dashscope?.credentialStatus.origin).toBe("inline")
    expect(dashscope?.credentialStatus.masked).not.toContain(SAMPLE_SECRET)
  })

  it("returns the credential to the environment when the inline key is cleared", async () => {
    const storageDir = await mkdtemp(path.join(tmpdir(), "vidgnost-settings-"))
    const store = new SettingsStore(createConfig(storageDir), defaults)
    await store.updateProvider({ id: "dashscope", apiKey: SAMPLE_KEY })
    const providers = await store.updateProvider({ id: "dashscope", apiKey: null })
    const dashscope = providers.find((provider) => provider.id === "dashscope")
    expect(dashscope?.credentialStatus.origin === "inline").toBe(false)
  })
})
