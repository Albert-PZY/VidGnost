import path from "node:path"

import type { WhisperRuntimeLibrariesResponse } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { FasterWhisperRunner } from "../asr/faster-whisper-runner.js"
import { resolveWhisperModelPath, resolveWhisperPythonExecutable } from "../asr/whisper-runtime-paths.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { WhisperRuntimeConfigRepository } from "./whisper-runtime-config-repository.js"

export class WhisperRuntimeStatusService {
  constructor(
    private readonly config: AppConfig,
    private readonly modelCatalogRepository: ModelCatalogRepository,
    private readonly whisperRuntimeConfigRepository: WhisperRuntimeConfigRepository,
    private readonly fasterWhisperRunner: Pick<FasterWhisperRunner, "probe"> = new FasterWhisperRunner(config),
  ) {}

  async getStatus(): Promise<WhisperRuntimeLibrariesResponse> {
    const whisperConfig = await this.whisperRuntimeConfigRepository.get()
    const catalog = await this.modelCatalogRepository.listModels()
    const whisperModel = catalog.items.find((item) => item.id === "whisper-default")
    const configuredModelPath = String(whisperModel?.path || whisperModel?.default_path || "").trim()
    const pythonExecutable = await resolveWhisperPythonExecutable(this.config)
    const modelPath = await resolveWhisperModelPath(configuredModelPath, whisperConfig.model_default)
    const discoveredFiles: Record<string, string> = {}
    const missingFiles: string[] = []

    if (configuredModelPath) {
      discoveredFiles.model_dir = configuredModelPath
    }

    if (modelPath) {
      discoveredFiles.model = modelPath
    } else {
      missingFiles.push("faster-whisper model")
    }

    if (pythonExecutable) {
      discoveredFiles.python = pythonExecutable
    } else {
      missingFiles.push("python")
    }

    const runtimeProbe = pythonExecutable ? await this.fasterWhisperRunner.probe() : { ready: false, details: {} }
    const ready = Boolean(modelPath && pythonExecutable && runtimeProbe.ready)
    const loadError = runtimeProbe.ready ? "" : String(runtimeProbe.details.probe_error || "")
    return {
      install_dir: modelPath || configuredModelPath || path.resolve(process.cwd(), "apps", "api", "python"),
      auto_configure_env: true,
      version_label: ready ? "faster-whisper" : "faster-whisper-missing",
      platform_supported: true,
      ready,
      status: ready ? "ready" : "not_ready",
      message: ready
        ? "已检测到 faster-whisper Python 运行时与模型目录。"
        : "未检测到完整的 faster-whisper 运行时，请检查 Python 环境、依赖安装和本地模型目录。",
      bin_dir: pythonExecutable ? path.dirname(pythonExecutable) : this.config.runtimeBinDir,
      missing_files: missingFiles,
      discovered_files: {
        ...discoveredFiles,
        ...runtimeProbe.details,
      },
      load_error: loadError,
      path_configured: Boolean(pythonExecutable),
      progress: {
        state: "idle",
        message: "",
        current_package: "",
        downloaded_bytes: 0,
        total_bytes: 0,
        percent: 0,
        speed_bps: 0,
        resumable: false,
        updated_at: "",
      },
    }
  }
}
