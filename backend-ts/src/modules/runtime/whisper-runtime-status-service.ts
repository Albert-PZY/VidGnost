import path from "node:path"

import type { WhisperRuntimeLibrariesResponse } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { findCommand } from "../../core/process.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"

export class WhisperRuntimeStatusService {
  constructor(
    private readonly config: AppConfig,
    private readonly modelCatalogRepository: ModelCatalogRepository,
  ) {}

  async getStatus(): Promise<WhisperRuntimeLibrariesResponse> {
    const catalog = await this.modelCatalogRepository.listModels()
    const whisperModel = catalog.items.find((item) => item.id === "whisper-default")
    const executablePath =
      await findCommand([this.config.whisperExecutable, "whisper-cli", "whisper-cli.exe"])
    const modelPath = String(whisperModel?.path || whisperModel?.default_path || "").trim()
    const discoveredFiles: Record<string, string> = {}
    const missingFiles: string[] = []

    if (executablePath) {
      discoveredFiles.executable = executablePath
    } else {
      missingFiles.push("whisper-cli")
    }

    if (modelPath) {
      discoveredFiles.model = modelPath
    } else {
      missingFiles.push("ggml model")
    }

    const ready = Boolean(executablePath && modelPath)
    return {
      install_dir: modelPath ? path.dirname(modelPath) : this.config.runtimeBinDir,
      auto_configure_env: true,
      version_label: ready ? "whisper.cpp" : "whisper.cpp-missing",
      platform_supported: true,
      ready,
      status: ready ? "ready" : "not_ready",
      message: ready
        ? "已检测到 whisper.cpp CLI 与模型目录。"
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
