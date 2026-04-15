import Fastify, { type FastifyInstance } from "fastify"
import cors from "@fastify/cors"

import { createLoggerOptions } from "../core/logger.js"
import { resolveConfig, type AppConfig } from "../core/config.js"
import { registerErrorHandler } from "../core/errors.js"
import { LlmConfigRepository } from "../modules/llm/llm-config-repository.js"
import { LocalModelMigrationService } from "../modules/models/local-model-migration-service.js"
import { ModelCatalogRepository } from "../modules/models/model-catalog-repository.js"
import { OllamaRuntimeConfigRepository } from "../modules/models/ollama-runtime-config-repository.js"
import { OllamaServiceManager } from "../modules/models/ollama-service-manager.js"
import { PromptTemplateRepository } from "../modules/prompts/prompt-template-repository.js"
import { RuntimeMetricsService } from "../modules/runtime/runtime-metrics-service.js"
import { WhisperRuntimeConfigRepository } from "../modules/runtime/whisper-runtime-config-repository.js"
import { WhisperRuntimeStatusService } from "../modules/runtime/whisper-runtime-status-service.js"
import { UiSettingsRepository } from "../modules/ui/ui-settings-repository.js"
import { registerConfigRoutes } from "../routes/config.js"
import { registerHealthRoute } from "../routes/health.js"
import { registerRuntimeRoutes } from "../routes/runtime.js"

export async function buildApp(inputConfig?: Partial<AppConfig>): Promise<FastifyInstance> {
  const baseConfig = resolveConfig()
  const config: AppConfig = {
    ...baseConfig,
    ...inputConfig,
  }

  const app = Fastify({
    logger: createLoggerOptions(),
  })

  registerErrorHandler(app)
  await app.register(cors, {
    origin: config.allowOrigins,
  })

  const uiSettingsRepository = new UiSettingsRepository(config)
  const llmConfigRepository = new LlmConfigRepository(config)
  const promptTemplateRepository = new PromptTemplateRepository(config)
  const runtimeMetricsService = new RuntimeMetricsService()
  const whisperRuntimeConfigRepository = new WhisperRuntimeConfigRepository(config)
  const ollamaRuntimeConfigRepository = new OllamaRuntimeConfigRepository(config)
  const ollamaServiceManager = new OllamaServiceManager(ollamaRuntimeConfigRepository)
  const whisperRuntimeStatusService = new WhisperRuntimeStatusService(ollamaRuntimeConfigRepository)
  const modelCatalogRepository = new ModelCatalogRepository(config, ollamaRuntimeConfigRepository)
  const localModelMigrationService = new LocalModelMigrationService()

  await registerHealthRoute(app, config)
  await registerRuntimeRoutes(app, config, runtimeMetricsService)
  await registerConfigRoutes(app, config.apiPrefix, {
    uiSettingsRepository,
    llmConfigRepository,
    promptTemplateRepository,
    whisperRuntimeConfigRepository,
    whisperRuntimeStatusService,
    ollamaRuntimeConfigRepository,
    ollamaServiceManager,
    modelCatalogRepository,
    localModelMigrationService,
  })
  return app
}
