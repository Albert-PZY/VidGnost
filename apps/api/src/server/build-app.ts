import path from "node:path"

import Fastify, { type FastifyInstance } from "fastify"
import cors from "@fastify/cors"
import multipart from "@fastify/multipart"

import { createLoggerOptions } from "../core/logger.js"
import { resolveConfig, type AppConfig } from "../core/config.js"
import { registerErrorHandler } from "../core/errors.js"
import { LlmConfigRepository } from "../modules/llm/llm-config-repository.js"
import { OpenAiCompatibleClient } from "../modules/llm/openai-compatible-client.js"
import { EventBus } from "../modules/events/event-bus.js"
import { AsrService } from "../modules/asr/asr-service.js"
import { MediaPipelineService } from "../modules/media/media-pipeline-service.js"
import { VideoFrameService } from "../modules/media/video-frame-service.js"
import { LocalModelMigrationService } from "../modules/models/local-model-migration-service.js"
import { ModelCatalogRepository } from "../modules/models/model-catalog-repository.js"
import { OllamaRuntimeConfigRepository } from "../modules/models/ollama-runtime-config-repository.js"
import { OllamaServiceManager } from "../modules/models/ollama-service-manager.js"
import { PromptTemplateRepository } from "../modules/prompts/prompt-template-repository.js"
import { LlmReadinessService } from "../modules/runtime/llm-readiness-service.js"
import { RuntimeMetricsService } from "../modules/runtime/runtime-metrics-service.js"
import { SelfCheckService } from "../modules/runtime/self-check-service.js"
import { SummaryService } from "../modules/summary/summary-service.js"
import { StudyService } from "../modules/study/study-service.js"
import { TaskOrchestrator } from "../modules/tasks/task-orchestrator.js"
import { TaskRepository } from "../modules/tasks/task-repository.js"
import { VlmRuntimeService } from "../modules/vqa/vlm-runtime-service.js"
import { VqaRuntimeService } from "../modules/vqa/vqa-runtime-service.js"
import { WhisperRuntimeConfigRepository } from "../modules/runtime/whisper-runtime-config-repository.js"
import { WhisperRuntimeStatusService } from "../modules/runtime/whisper-runtime-status-service.js"
import { UiSettingsRepository } from "../modules/ui/ui-settings-repository.js"
import { registerConfigRoutes } from "../routes/config.js"
import { registerHealthRoute } from "../routes/health.js"
import { registerRuntimeRoutes } from "../routes/runtime.js"
import { registerSelfCheckRoutes } from "../routes/self-check.js"
import { registerTaskEventRoutes } from "../routes/task-events.js"
import { registerTaskExportRoutes } from "../routes/task-exports.js"
import { registerTaskMutationRoutes } from "../routes/task-mutations.js"
import { registerTaskRoutes } from "../routes/tasks.js"
import { registerStudyRoutes } from "../routes/study.js"
import { registerVqaRoutes } from "../routes/vqa.js"

export async function buildApp(inputConfig?: Partial<AppConfig>): Promise<FastifyInstance> {
  const baseConfig = resolveConfig()
  const config: AppConfig = {
    ...baseConfig,
    ...inputConfig,
  }
  if (inputConfig?.storageDir) {
    if (!inputConfig.eventLogDir) {
      config.eventLogDir = path.join(config.storageDir, "event-logs")
    }
    if (!inputConfig.runtimeBinDir) {
      config.runtimeBinDir = path.join(config.storageDir, "runtime-bin")
    }
    if (!inputConfig.uploadDir) {
      config.uploadDir = path.join(config.storageDir, "uploads")
    }
    if (!inputConfig.tempDir) {
      config.tempDir = path.join(config.storageDir, "tmp")
    }
  }

  const app = Fastify({
    logger: createLoggerOptions(),
  })

  registerErrorHandler(app)
  await app.register(cors, {
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin, config.allowOrigins))
    },
  })
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadMb * 1024 * 1024,
      files: 64,
    },
  })

  const uiSettingsRepository = new UiSettingsRepository(config)
  const llmConfigRepository = new LlmConfigRepository(config)
  const promptTemplateRepository = new PromptTemplateRepository(config)
  const runtimeMetricsService = new RuntimeMetricsService()
  const taskRepository = new TaskRepository(config)
  const eventBus = new EventBus(config.eventLogDir)
  const whisperRuntimeConfigRepository = new WhisperRuntimeConfigRepository(config)
  const ollamaRuntimeConfigRepository = new OllamaRuntimeConfigRepository(config)
  const ollamaServiceManager = new OllamaServiceManager(ollamaRuntimeConfigRepository)
  const modelCatalogRepository = new ModelCatalogRepository(config, ollamaRuntimeConfigRepository)
  const whisperRuntimeStatusService = new WhisperRuntimeStatusService(
    config,
    modelCatalogRepository,
    whisperRuntimeConfigRepository,
  )
  const openAiCompatibleClient = new OpenAiCompatibleClient()
  const mediaPipelineService = new MediaPipelineService(config)
  const videoFrameService = new VideoFrameService(config)
  const asrService = new AsrService(
    config,
    modelCatalogRepository,
    whisperRuntimeConfigRepository,
    openAiCompatibleClient,
  )
  const summaryService = new SummaryService(
    llmConfigRepository,
    promptTemplateRepository,
    openAiCompatibleClient,
  )
  const studyService = new StudyService(config, taskRepository, {
    llmClient: openAiCompatibleClient,
    llmConfigRepository,
  })
  const llmReadinessService = new LlmReadinessService(openAiCompatibleClient)
  const vlmRuntimeService = new VlmRuntimeService(modelCatalogRepository, openAiCompatibleClient)
  const taskOrchestrator = new TaskOrchestrator(taskRepository, eventBus, {
    asrService,
    mediaPipelineService,
    summaryService,
    studyService,
    videoFrameService,
    vlmRuntimeService,
  })
  const localModelMigrationService = new LocalModelMigrationService()
  const selfCheckService = new SelfCheckService(
    config,
    eventBus,
    llmConfigRepository,
    modelCatalogRepository,
    llmReadinessService,
    whisperRuntimeStatusService,
  )
  const vqaRuntimeService = new VqaRuntimeService(
    taskRepository,
    modelCatalogRepository,
    llmConfigRepository,
    openAiCompatibleClient,
    path.join(config.eventLogDir, "traces"),
  )

  app.decorate("videoFrameService", videoFrameService)

  await registerHealthRoute(app, config)
  await registerRuntimeRoutes(app, config, runtimeMetricsService)
  await registerTaskRoutes(app, config.apiPrefix, taskRepository)
  await registerTaskMutationRoutes(app, config, config.apiPrefix, taskRepository, taskOrchestrator)
  await registerTaskEventRoutes(app, config.apiPrefix, taskRepository, eventBus)
  await registerTaskExportRoutes(app, config, config.apiPrefix, taskRepository)
  await registerStudyRoutes(app, config.apiPrefix, studyService)
  await registerSelfCheckRoutes(app, config.apiPrefix, selfCheckService, eventBus)
  await registerVqaRoutes(app, config.apiPrefix, vqaRuntimeService)
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
  app.addHook("onClose", async () => {
    await studyService.close()
  })
  return app
}

function isAllowedCorsOrigin(origin: string | undefined, allowOrigins: string[]): boolean {
  if (!origin) {
    return true
  }
  if (allowOrigins.includes(origin)) {
    return true
  }

  try {
    const parsed = new URL(origin)
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1")
    )
  } catch {
    return false
  }
}
