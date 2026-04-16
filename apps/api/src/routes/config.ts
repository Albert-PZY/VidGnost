import type { FastifyInstance, FastifyRequest } from "fastify"

import {
  llmConfigUpdateRequestSchema,
  localModelsMigrationRequestSchema,
  modelReloadRequestSchema,
  modelUpdateRequestSchema,
  ollamaModelsMigrationRequestSchema,
  ollamaRuntimeConfigUpdateRequestSchema,
  promptTemplateCreateRequestSchema,
  promptTemplateSelectionUpdateRequestSchema,
  promptTemplateUpdateRequestSchema,
  uiSettingsUpdateRequestSchema,
  whisperConfigUpdateRequestSchema,
  type LLMConfigResponse,
  type LocalModelsMigrationResponse,
  type ModelListResponse,
  type OllamaModelsMigrationResponse,
  type OllamaRuntimeConfigResponse,
  type PromptTemplateBundleResponse,
  type UISettingsResponse,
  type WhisperConfigResponse,
} from "@vidgnost/contracts"

import { AppError } from "../core/errors.js"
import type { LlmConfigRepository } from "../modules/llm/llm-config-repository.js"
import type { LocalModelMigrationService } from "../modules/models/local-model-migration-service.js"
import type { ModelCatalogRepository } from "../modules/models/model-catalog-repository.js"
import type { OllamaRuntimeConfigRepository } from "../modules/models/ollama-runtime-config-repository.js"
import type { OllamaServiceManager } from "../modules/models/ollama-service-manager.js"
import type { PromptTemplateRepository } from "../modules/prompts/prompt-template-repository.js"
import type { UiSettingsRepository } from "../modules/ui/ui-settings-repository.js"
import {
  buildWhisperConfigResponse,
  type WhisperRuntimeConfigRepository,
} from "../modules/runtime/whisper-runtime-config-repository.js"
import type { WhisperRuntimeStatusService } from "../modules/runtime/whisper-runtime-status-service.js"

interface ConfigRouteDependencies {
  llmConfigRepository: LlmConfigRepository
  localModelMigrationService: LocalModelMigrationService
  modelCatalogRepository: ModelCatalogRepository
  ollamaRuntimeConfigRepository: OllamaRuntimeConfigRepository
  ollamaServiceManager: OllamaServiceManager
  promptTemplateRepository: PromptTemplateRepository
  uiSettingsRepository: UiSettingsRepository
  whisperRuntimeConfigRepository: WhisperRuntimeConfigRepository
  whisperRuntimeStatusService: WhisperRuntimeStatusService
}

export async function registerConfigRoutes(
  app: FastifyInstance,
  apiPrefix: string,
  dependencies: ConfigRouteDependencies,
): Promise<void> {
  app.get(`${apiPrefix}/config/ui`, async (): Promise<UISettingsResponse> => {
    return dependencies.uiSettingsRepository.get()
  })

  app.put(`${apiPrefix}/config/ui`, async (request): Promise<UISettingsResponse> => {
    const body = parseBody(request, uiSettingsUpdateRequestSchema, "UI_SETTINGS_UPDATE_INVALID", "Invalid UI settings payload")
    return dependencies.uiSettingsRepository.update(body)
  })

  app.get(`${apiPrefix}/config/llm`, async (): Promise<LLMConfigResponse> => {
    return dependencies.llmConfigRepository.get()
  })

  app.put(`${apiPrefix}/config/llm`, async (request): Promise<LLMConfigResponse> => {
    const body = parseBody(request, llmConfigUpdateRequestSchema, "LLM_CONFIG_UPDATE_INVALID", "Invalid LLM config payload")
    return dependencies.llmConfigRepository.save(body)
  })

  app.get(`${apiPrefix}/config/prompts`, async (): Promise<PromptTemplateBundleResponse> => {
    return dependencies.promptTemplateRepository.getBundle()
  })

  app.put(`${apiPrefix}/config/prompts/selection`, async (request): Promise<PromptTemplateBundleResponse> => {
    const body = parseBody(
      request,
      promptTemplateSelectionUpdateRequestSchema,
      "PROMPT_TEMPLATE_SELECTION_INVALID",
      "Invalid prompt template selection payload",
    )
    try {
      return await dependencies.promptTemplateRepository.updateSelection(body)
    } catch (error) {
      throw AppError.badRequest("Prompt template selection is invalid", {
        code: "PROMPT_TEMPLATE_SELECTION_INVALID",
        detail: toRouteErrorDetail(error),
      })
    }
  })

  app.post(`${apiPrefix}/config/prompts/templates`, async (request): Promise<PromptTemplateBundleResponse> => {
    const body = parseBody(
      request,
      promptTemplateCreateRequestSchema,
      "PROMPT_TEMPLATE_CREATE_INVALID",
      "Invalid prompt template create payload",
    )
    try {
      return await dependencies.promptTemplateRepository.createTemplate(body)
    } catch (error) {
      throw AppError.badRequest("Prompt template create is invalid", {
        code: "PROMPT_TEMPLATE_CREATE_INVALID",
        detail: toRouteErrorDetail(error),
      })
    }
  })

  app.patch(`${apiPrefix}/config/prompts/templates/:templateId`, async (request): Promise<PromptTemplateBundleResponse> => {
    const body = parseBody(
      request,
      promptTemplateUpdateRequestSchema,
      "PROMPT_TEMPLATE_UPDATE_INVALID",
      "Invalid prompt template update payload",
    )
    try {
      return await dependencies.promptTemplateRepository.updateTemplate(String((request.params as { templateId?: string }).templateId || ""), body)
    } catch (error) {
      throw AppError.badRequest("Prompt template update is invalid", {
        code: "PROMPT_TEMPLATE_UPDATE_INVALID",
        detail: toRouteErrorDetail(error),
      })
    }
  })

  app.delete(`${apiPrefix}/config/prompts/templates/:templateId`, async (request): Promise<PromptTemplateBundleResponse> => {
    try {
      return await dependencies.promptTemplateRepository.deleteTemplate(String((request.params as { templateId?: string }).templateId || ""))
    } catch (error) {
      throw AppError.badRequest("Prompt template delete is invalid", {
        code: "PROMPT_TEMPLATE_DELETE_INVALID",
        detail: toRouteErrorDetail(error),
      })
    }
  })

  app.get(`${apiPrefix}/config/whisper`, async (): Promise<WhisperConfigResponse> => {
    const [config, runtimeLibraries] = await Promise.all([
      dependencies.whisperRuntimeConfigRepository.get(),
      dependencies.whisperRuntimeStatusService.getStatus(),
    ])
    return buildWhisperConfigResponse(config, runtimeLibraries)
  })

  app.put(`${apiPrefix}/config/whisper`, async (request): Promise<WhisperConfigResponse> => {
    const body = parseBody(
      request,
      whisperConfigUpdateRequestSchema,
      "WHISPER_CONFIG_UPDATE_INVALID",
      "Invalid whisper config payload",
    )
    const [config, runtimeLibraries] = await Promise.all([
      dependencies.whisperRuntimeConfigRepository.save(body),
      dependencies.whisperRuntimeStatusService.getStatus(),
    ])
    return buildWhisperConfigResponse(config, runtimeLibraries)
  })

  app.get(`${apiPrefix}/config/ollama`, async (): Promise<OllamaRuntimeConfigResponse> => {
    return buildOllamaRuntimeConfigResponse(dependencies)
  })

  app.put(`${apiPrefix}/config/ollama`, async (request): Promise<OllamaRuntimeConfigResponse> => {
    const body = parseBody(
      request,
      ollamaRuntimeConfigUpdateRequestSchema,
      "OLLAMA_RUNTIME_CONFIG_UPDATE_INVALID",
      "Invalid Ollama config payload",
    )
    await dependencies.ollamaRuntimeConfigRepository.save(body)
    await dependencies.ollamaServiceManager.synchronizeRuntimeEnvironment()
    await synchronizeManagedLlmRuntime(dependencies)
    return buildOllamaRuntimeConfigResponse(dependencies)
  })

  app.post(`${apiPrefix}/config/ollama/restart-service`, async (): Promise<OllamaRuntimeConfigResponse> => {
    const service = await dependencies.ollamaServiceManager.restartService()
    const config = await dependencies.ollamaRuntimeConfigRepository.get()
    return {
      ...config,
      service,
    }
  })

  app.post(`${apiPrefix}/config/ollama/migrate-models`, async (request): Promise<OllamaModelsMigrationResponse> => {
    const body = parseBody(
      request,
      ollamaModelsMigrationRequestSchema,
      "OLLAMA_MODELS_MIGRATION_INVALID",
      "Invalid Ollama models migration payload",
    )
    const current = await dependencies.ollamaRuntimeConfigRepository.get()
    const normalizedTargetDir = body.target_dir.trim()
    if (normalizedTargetDir && normalizedTargetDir !== current.models_dir) {
      await dependencies.ollamaRuntimeConfigRepository.save({
        models_dir: normalizedTargetDir,
      })
      await dependencies.ollamaServiceManager.synchronizeRuntimeEnvironment()
    }
    const service = await dependencies.ollamaServiceManager.getStatus()
    return {
      service,
      source_dir: current.models_dir,
      target_dir: normalizedTargetDir || current.models_dir,
      moved: false,
      message:
        normalizedTargetDir === current.models_dir
          ? "Ollama 模型目录已指向目标路径，无需额外迁移。"
          : "已更新 Ollama 模型目录配置；现有模型文件请按需手动迁移。",
      warnings:
        normalizedTargetDir === current.models_dir
          ? []
          : ["当前 TS 运行时不会直接搬运 Ollama 模型文件，请在目标目录完成文件迁移后再刷新状态。"],
    }
  })

  app.get(`${apiPrefix}/config/models`, async (): Promise<ModelListResponse> => {
    return dependencies.modelCatalogRepository.listModels()
  })

  app.post(`${apiPrefix}/config/models/reload`, async (request): Promise<ModelListResponse> => {
    const body = parseBody(request, modelReloadRequestSchema, "MODEL_RELOAD_INVALID", "Invalid model reload payload")
    return dependencies.modelCatalogRepository.reloadModels(body)
  })

  app.patch(`${apiPrefix}/config/models/:modelId`, async (request): Promise<ModelListResponse> => {
    const body = parseBody(request, modelUpdateRequestSchema, "MODEL_UPDATE_INVALID", "Invalid model update payload")
    try {
      const modelId = String((request.params as { modelId?: string }).modelId || "")
      const response = await dependencies.modelCatalogRepository.updateModel(modelId, body)
      if (modelId === "llm-default") {
        await synchronizeManagedLlmRuntime(dependencies, response)
      }
      return response
    } catch (error) {
      throw AppError.badRequest("Model update is invalid", {
        code: "MODEL_UPDATE_INVALID",
        detail: toRouteErrorDetail(error),
      })
    }
  })

  app.post(`${apiPrefix}/config/models/:modelId/download`, async (request): Promise<ModelListResponse> => {
    const modelId = String((request.params as { modelId?: string }).modelId || "").trim()
    const models = await dependencies.modelCatalogRepository.listModels()
    const target = models.items.find((item) => item.id === modelId)
    if (!target) {
      throw AppError.notFound("Model not found", {
        code: "MODEL_NOT_FOUND",
      })
    }

    if (target.is_installed) {
      return dependencies.modelCatalogRepository.updateDownloadState(modelId, {
        state: "completed",
        message: "当前模型已经就绪，无需重复下载。",
        percent: 100,
      })
    }

    return dependencies.modelCatalogRepository.updateDownloadState(modelId, {
      state: "failed",
      message: buildManagedDownloadUnavailableMessage(target),
      percent: 0,
    })
  })

  app.delete(`${apiPrefix}/config/models/:modelId/download`, async (request): Promise<ModelListResponse> => {
    const modelId = String((request.params as { modelId?: string }).modelId || "").trim()
    const models = await dependencies.modelCatalogRepository.listModels()
    const target = models.items.find((item) => item.id === modelId)
    if (!target) {
      throw AppError.notFound("Model not found", {
        code: "MODEL_NOT_FOUND",
      })
    }

    return dependencies.modelCatalogRepository.updateDownloadState(modelId, {
      state: "cancelled",
      message: "当前模型下载任务已取消。",
      percent: 0,
    })
  })

  app.post(`${apiPrefix}/config/models/migrate-local`, async (request): Promise<LocalModelsMigrationResponse> => {
    const body = parseBody(
      request,
      localModelsMigrationRequestSchema,
      "LOCAL_MODEL_MIGRATION_INVALID",
      "Invalid local model migration payload",
    )
    return dependencies.localModelMigrationService.migrate(body.target_root)
  })
}

async function buildOllamaRuntimeConfigResponse(
  dependencies: Pick<ConfigRouteDependencies, "ollamaRuntimeConfigRepository" | "ollamaServiceManager">,
): Promise<OllamaRuntimeConfigResponse> {
  const [config, service] = await Promise.all([
    dependencies.ollamaRuntimeConfigRepository.get(),
    dependencies.ollamaServiceManager.getStatus(),
  ])
  return {
    ...config,
    service,
  }
}

async function synchronizeManagedLlmRuntime(
  dependencies: Pick<
    ConfigRouteDependencies,
    "llmConfigRepository" | "modelCatalogRepository" | "ollamaRuntimeConfigRepository"
  >,
  modelListResponse?: ModelListResponse,
): Promise<LLMConfigResponse | null> {
  const models = modelListResponse || await dependencies.modelCatalogRepository.listModels()
  const llmModel = models.items.find((item) => item.id === "llm-default")
  if (!llmModel) {
    return null
  }

  const current = await dependencies.llmConfigRepository.get()
  if (llmModel.provider === "ollama") {
    const ollamaRuntimeConfig = await dependencies.ollamaRuntimeConfigRepository.get()
    return dependencies.llmConfigRepository.save({
      ...current,
      load_profile: llmModel.load_profile === "memory_first" ? "memory_first" : "balanced",
      local_model_id: llmModel.model_id,
      api_key: "",
      base_url: `${ollamaRuntimeConfig.base_url.replace(/\/+$/, "")}/v1`,
      model: llmModel.model_id,
    })
  }

  return dependencies.llmConfigRepository.save({
    ...current,
    load_profile: llmModel.load_profile === "memory_first" ? "memory_first" : "balanced",
    local_model_id: llmModel.model_id,
    api_key: llmModel.api_key,
    base_url: llmModel.api_base_url.trim() || current.base_url,
    model: llmModel.api_model.trim() || llmModel.model_id,
  })
}

function parseBody<T>(
  request: FastifyRequest,
  schema: { parse: (value: unknown) => T },
  code: string,
  message: string,
): T {
  try {
    return schema.parse(request.body)
  } catch (error) {
    throw AppError.badRequest(message, {
      code,
      detail: toRouteErrorDetail(error),
    })
  }
}

function toRouteErrorDetail(error: unknown): unknown {
  if (error instanceof Error) {
    return error.message
  }
  return error
}

function buildManagedDownloadUnavailableMessage(
  model: Awaited<ReturnType<ModelCatalogRepository["listModels"]>>["items"][number],
): string {
  if (model.component === "whisper") {
    return "当前 TS 全栈版本不内置 Whisper 模型托管下载，请在 storage/models/whisper 放置 ggml 模型文件，或切换为远程转写提供方。"
  }
  if (model.provider === "ollama") {
    return "当前 TS 全栈版本不接管 Ollama 模型拉取，请先在 Ollama 侧执行 pull，或切换为在线 API 提供方。"
  }
  if (model.provider === "openai_compatible") {
    return "当前模型使用在线 API，请直接配置 Base URL、模型名和 API Key。"
  }
  return "当前模型提供方不支持托管下载，请手动完成模型准备。"
}
