import type { CheckResult, RuntimeHealth } from "@vidgnost/contracts"

import { describeError } from "../core/errors.js"
import type { ModelGateway } from "./gateway.js"

/**
 * 提供方连通性自检。检查项都是真实网络请求，覆盖所有启用的渠道，
 * 包括用户自己接入的渠道。
 */
export async function probeProviders(gateway: ModelGateway): Promise<RuntimeHealth> {
  const checkedAt = new Date().toISOString()
  // 用内部记录而不是对外描述：后者为安全起见省略了内联密钥，会让自检误判成「缺少密钥」。
  const configured = await gateway.settings.getProviders()
  const providers: RuntimeHealth["providers"] = []

  for (const provider of configured.filter((item) => item.enabled)) {
    let checks: CheckResult[]
    try {
      checks = await gateway.probeProvider(provider)
    } catch (error) {
      checks = [{ name: "连通性", ok: false, detail: describeError(error) }]
    }
    providers.push({
      provider: provider.id,
      ok: checks.some((check) => check.ok),
      checkedAt,
      checks,
    })
  }

  return {
    ok: providers.some((provider) => provider.ok),
    checkedAt,
    providers,
    toolchain: [],
  }
}
