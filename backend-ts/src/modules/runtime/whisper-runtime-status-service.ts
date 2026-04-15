import path from "node:path"

import type { WhisperRuntimeLibrariesResponse } from "@vidgnost/contracts"

import { pathExists } from "../../core/fs.js"
import type { OllamaRuntimeConfigRepository } from "../models/ollama-runtime-config-repository.js"

export class WhisperRuntimeStatusService {
  readonly #ollamaRuntimeConfigRepository: OllamaRuntimeConfigRepository

  constructor(ollamaRuntimeConfigRepository: OllamaRuntimeConfigRepository) {
    this.#ollamaRuntimeConfigRepository = ollamaRuntimeConfigRepository
  }

  async getStatus(): Promise<WhisperRuntimeLibrariesResponse> {
    const ollamaConfig = await this.#ollamaRuntimeConfigRepository.get()
    const executablePath = ollamaConfig.executable_path
    const executableExists = await pathExists(executablePath)
    const installDir = ollamaConfig.install_dir
    const executableName = path.basename(executablePath)

    return {
      install_dir: installDir,
      auto_configure_env: true,
      version_label: "ollama-runtime-probe",
      platform_supported: true,
      ready: executableExists,
      status: executableExists ? "ready" : "not_ready",
      message: executableExists ? "已检测到可复用的本地运行时目录。" : "未检测到可复用的本地运行时目录。",
      bin_dir: installDir,
      missing_files: executableExists ? [] : [executableName],
      discovered_files: executableExists ? { executable: executablePath } : {},
      load_error: "",
      path_configured: executableExists,
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
