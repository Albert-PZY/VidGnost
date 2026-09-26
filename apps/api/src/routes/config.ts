import type { FastifyInstance } from "fastify"

import { modelRouteSchema, providerPatchSchema, settingsPatchSchema } from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import { MODEL_CATALOG, MODEL_ROLES, PROVIDER_LABELS } from "../providers/catalog.js"
import { probeProviders } from "../providers/health.js"
import type { AppContext } from "../server/app-context.js"

export async function registerConfigRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  const base = `${context.config.apiPrefix}/config`

  app.get(base, async () => {
    const [settings, routes, providers] = await Promise.all([
      context.gateway.settings.getSettings(),
      context.gateway.settings.getRoutes(),
      context.gateway.settings.describeProviders(),
    ])
    return { settings, routes, providers }
  })

  app.patch(`${base}/settings`, async (request) => {
    const parsed = settingsPatchSchema.safeParse(request.body)
    if (!parsed.success) {
      throw AppError.badRequest("设置参数不合法。", {
        code: "SETTINGS_INVALID",
        detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      })
    }
    const updated = await context.gateway.settings.update({
      settings: parsed.data.settings as Parameters<typeof context.gateway.settings.update>[0]["settings"],
      routes: parsed.data.routes?.map((route) => ({
        role: route.role,
        provider: route.provider,
        model: route.model,
        label: route.label || route.role,
        allowFallback: route.allowFallback ?? true,
        temperature: route.temperature ?? 0.3,
        maxTokens: route.maxTokens ?? 8000,
      })),
    })
    if (parsed.data.settings?.maxConcurrentTasks) {
      await context.tasks.setConcurrency(parsed.data.settings.maxConcurrentTasks)
    }
    return { settings: updated.settings, routes: updated.routes }
  })

  app.patch(`${base}/providers`, async (request) => {
    const parsed = providerPatchSchema.safeParse(request.body)
    if (!parsed.success) {
      throw AppError.badRequest("提供方参数不合法。", {
        code: "PROVIDER_PATCH_INVALID",
        detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      })
    }
    const providers = await context.gateway.settings.updateProvider(parsed.data)
    return { providers }
  })

  app.put(`${base}/routes`, async (request) => {
    const body = (request.body || {}) as { routes?: unknown }
    const parsed = modelRouteSchema.array().max(32).safeParse(body.routes)
    if (!parsed.success) {
      throw AppError.badRequest("模型路由不合法。", {
        code: "ROUTES_INVALID",
        detail: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      })
    }
    const updated = await context.gateway.settings.update({
      routes: parsed.data.map((route) => ({
        role: route.role,
        provider: route.provider,
        model: route.model,
        label: route.label || route.role,
        allowFallback: route.allowFallback ?? true,
        temperature: route.temperature ?? 0.3,
        maxTokens: route.maxTokens ?? 8000,
      })),
    })
    return { routes: updated.routes }
  })

  app.get(`${base}/catalog`, async () => ({
    models: MODEL_CATALOG,
    roles: MODEL_ROLES,
    providerLabels: PROVIDER_LABELS,
  }))

  app.post(`${base}/health`, async () => probeProviders(context.gateway, context.config))
}
