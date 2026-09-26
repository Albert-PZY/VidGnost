import type { CheckResult, RuntimeHealth } from "@vidgnost/contracts"

import type { AppConfig } from "../core/config.js"
import { describeError } from "../core/errors.js"
import type { ModelGateway } from "./gateway.js"

/** 提供方与模型连通性自检。检查项全部为真实网络调用。 */
export async function probeProviders(gateway: ModelGateway, config: AppConfig): Promise<RuntimeHealth> {
  const checkedAt = new Date().toISOString()
  const providers: RuntimeHealth["providers"] = []

  /* ------------------------------------------------------------- 百炼 */

  const dashscopeChecks: CheckResult[] = []
  try {
    const apiKey = await gateway.apiKeyFor("dashscope")
    const started = Date.now()
    const result = await gateway.dashscope.chat({
      apiKey,
      baseUrl: config.dashscopeBaseUrl,
      model: "qwen3.8-flash",
      messages: [{ role: "user", content: "回复 ok" }],
      maxTokens: 16,
    })
    dashscopeChecks.push({
      name: "对话模型",
      ok: result.content.length > 0,
      detail: `qwen3.8-flash → ${result.content.slice(0, 40) || "(空)"}`,
      latencyMs: Date.now() - started,
    })
  } catch (error) {
    dashscopeChecks.push({ name: "对话模型", ok: false, detail: describeError(error) })
  }

  try {
    const started = Date.now()
    await gateway.embed({ inputs: ["连通性检查"] })
    dashscopeChecks.push({ name: "向量模型", ok: true, detail: "embedding 调用成功", latencyMs: Date.now() - started })
  } catch (error) {
    dashscopeChecks.push({ name: "向量模型", ok: false, detail: describeError(error) })
  }

  try {
    const started = Date.now()
    const apiKey = await gateway.apiKeyFor("dashscope")
    const policy = await fetch(`${config.dashscopeBaseUrl}/api/v1/uploads?action=getPolicy&model=qwen-audio-3.1-asr-flash-filetrans`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    dashscopeChecks.push({
      name: "文件转写通道",
      ok: policy.ok,
      detail: policy.ok ? "已获取临时上传策略" : `HTTP ${policy.status}`,
      latencyMs: Date.now() - started,
    })
  } catch (error) {
    dashscopeChecks.push({ name: "文件转写通道", ok: false, detail: describeError(error) })
  }

  providers.push({
    provider: "dashscope",
    ok: dashscopeChecks.some((check) => check.ok),
    checkedAt,
    checks: dashscopeChecks,
  })

  /* --------------------------------------------------------- OpenRouter */

  const openrouterChecks: CheckResult[] = []
  try {
    const apiKey = await gateway.apiKeyFor("openrouter")
    const probe = await gateway.openrouter.probe(apiKey)
    openrouterChecks.push({
      name: "重排服务",
      ok: probe.modelCount > 0,
      detail: `可用模型 ${probe.modelCount} 个`,
      latencyMs: probe.latencyMs,
    })
  } catch (error) {
    openrouterChecks.push({ name: "重排服务", ok: false, detail: describeError(error) })
  }
  providers.push({
    provider: "openrouter",
    ok: openrouterChecks.some((check) => check.ok),
    checkedAt,
    checks: openrouterChecks,
  })

  /* --------------------------------------------------------------- 本地 */

  const settings = await gateway.settings.getSettings()
  const localChecks: CheckResult[] = [
    {
      name: "Whisper 模型目录",
      ok: Boolean(settings.whisper.modelDir),
      detail: settings.whisper.modelDir || "未配置",
    },
  ]
  providers.push({
    provider: "local",
    ok: localChecks.every((check) => check.ok),
    checkedAt,
    checks: localChecks,
  })

  return {
    ok: providers.some((provider) => provider.provider !== "local" && provider.ok),
    checkedAt,
    providers,
    toolchain: [],
  }
}
