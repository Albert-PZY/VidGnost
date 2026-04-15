import type { FastifyInstance, FastifyRequest } from "fastify"

import {
  llmConfigUpdateRequestSchema,
  localModelsMigrationRequestSchema,
  modelReloadRequestSchema,
  modelUpdateRequestSchema,
  ollamaRuntimeConfigUpdateRequestSchema,
  promptTemplateCreateRequestSchema,
  promptTemplateSelectionUpdateRequestSchema,
  promptTemplateUpdateRequestSchema,
  uiSettingsUpdateRequestSchema,
  whisperConfigUpdateRequestSchema,
  type LLMConfigResponse,
  type LocalModelsMigrationResponse,
  type ModelListResponse,
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
      return await dependencies.modelCatalogRepository.updateModel(String((request.params as { modelId?: string }).modelId || ""), body)
    } catch (error) {
      throw AppError.badRequest("Model update is invalid", {
        code: "MODEL_UPDATE_INVALID",
        detail: toRouteErrorDetail(error),
      })
    }
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
