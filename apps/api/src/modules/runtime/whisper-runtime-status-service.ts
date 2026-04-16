import path from "node:path"

import type { WhisperRuntimeLibrariesResponse } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { WhisperRuntimeConfigRepository } from "./whisper-runtime-config-repository.js"
import { resolveWhisperExecutable, resolveWhisperModelPath } from "../asr/whisper-runtime-paths.js"

export class WhisperRuntimeStatusService {
  constructor(
    private readonly config: AppConfig,
    private readonly modelCatalogRepository: ModelCatalogRepository,
    private readonly whisperRuntimeConfigRepository: WhisperRuntimeConfigRepository,
  ) {}

  async getStatus(): Promise<WhisperRuntimeLibrariesResponse> {
    const whisperConfig = await this.whisperRuntimeConfigRepository.get()
    const catalog = await this.modelCatalogRepository.listModels()
    const whisperModel = catalog.items.find((item) => item.id === "whisper-default")
    const configuredModelPath = String(whisperModel?.path || whisperModel?.default_path || "").trim()
    const executablePath = await resolveWhisperExecutable(this.config)
    const modelPath = await resolveWhisperModelPath(configuredModelPath, whisperConfig.model_default)
    const discoveredFiles: Record<string, string> = {}
    const missingFiles: string[] = []

    if (executablePath) {
      discoveredFiles.executable = executablePath
    } else {
      missingFiles.push("whisper-cli")
    }

    if (configuredModelPath) {
      discoveredFiles.model_dir = configuredModelPath
    }

    if (modelPath) {
      discoveredFiles.model = modelPath
    } else {
      missingFiles.push("ggml model")
    }

    const ready = Boolean(executablePath && modelPath)
    return {
      install_dir: modelPath ? path.dirname(modelPath) : configuredModelPath || this.config.runtimeBinDir,
      auto_configure_env: true,
      version_label: ready ? "whisper.cpp" : "whisper.cpp-missing",
      platform_supported: true,
      ready,
      status: ready ? "ready" : "not_ready",
      message: ready
        ? "已检测到 whisper.cpp CLI 与模型文件。"
        : "未检测到完整的 whisper.cpp 运行时，请在设置中配置本地模型并安装 whisper-cli。",
      bin_dir: executablePath ? path.dirname(executablePath) : this.config.runtimeBinDir,
      missing_files: missingFiles,
      discovered_files: discoveredFiles,
      load_error: "",
      path_configured: Boolean(executablePath),
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
