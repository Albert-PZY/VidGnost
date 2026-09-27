import type { FastifyInstance } from "fastify"

import {
  modelRouteSchema,
  providerCreateSchema,
  providerModelSchema,
  providerPatchSchema,
  settingsPatchSchema,
} from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import { MODEL_ROLES, PROTOCOL_INFO } from "../providers/catalog.js"
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
      throw badRequest("设置参数不合法。", "SETTINGS_INVALID", parsed.error.issues)
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

  app.put(`${base}/routes`, async (request) => {
    const body = (request.body || {}) as { routes?: unknown }
    const parsed = modelRouteSchema.array().max(32).safeParse(body.routes)
    if (!parsed.success) {
      throw badRequest("模型路由不合法。", "ROUTES_INVALID", parsed.error.issues)
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

  /* ------------------------------------------------------------- 渠道 */

  app.post(`${base}/providers`, async (request, reply) => {
    const parsed = providerCreateSchema.safeParse(request.body)
    if (!parsed.success) {
      throw badRequest("渠道参数不合法。", "PROVIDER_CREATE_INVALID", parsed.error.issues)
    }
    const providers = await context.gateway.settings.createProvider(parsed.data)
    reply.code(201)
    return { providers }
  })

  app.patch(`${base}/providers`, async (request) => {
    const parsed = providerPatchSchema.safeParse(request.body)
    if (!parsed.success) {
      throw badRequest("提供方参数不合法。", "PROVIDER_PATCH_INVALID", parsed.error.issues)
    }
    const providers = await context.gateway.settings.patchProvider(parsed.data)
    return { providers }
  })

  app.delete(`${base}/providers/:id`, async (request) => {
    const { id } = request.params as { id: string }
    const providers = await context.gateway.settings.deleteProvider(id)
    return { providers }
  })

  /* ------------------------------------------------------------- 模型 */

  app.put(`${base}/providers/:id/models/:modelId`, async (request) => {
    const { id, modelId } = request.params as { id: string; modelId: string }
    const parsed = providerModelSchema.safeParse(request.body)
    if (!parsed.success) {
      throw badRequest("模型参数不合法。", "PROVIDER_MODEL_INVALID", parsed.error.issues)
    }
    const providers = await context.gateway.settings.upsertModel(id, decodeURIComponent(modelId), parsed.data)
    return { providers }
  })

  app.delete(`${base}/providers/:id/models/:modelId`, async (request) => {
    const { id, modelId } = request.params as { id: string; modelId: string }
    const providers = await context.gateway.settings.deleteModel(id, decodeURIComponent(modelId))
    return { providers }
  })

  /* --------------------------------------------------------- 目录与自检 */

  app.get(`${base}/catalog`, async () => ({
    models: await context.gateway.catalogue(),
    roles: MODEL_ROLES,
    protocols: PROTOCOL_INFO,
  }))

  app.post(`${base}/health`, async () => probeProviders(context.gateway))
}

function badRequest(message: string, code: string, issues: Array<{ path: PropertyKey[]; message: string }>): AppError {
  return AppError.badRequest(message, {
    code,
    detail: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
  })
}
