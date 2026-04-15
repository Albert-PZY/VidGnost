import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { URL } from "node:url"

import type { OllamaServiceStatusResponse } from "@vidgnost/contracts"

import { pathExists } from "../../core/fs.js"
import type { OllamaRuntimeConfigRepository } from "./ollama-runtime-config-repository.js"

export class OllamaServiceManager {
  readonly #repository: OllamaRuntimeConfigRepository

  constructor(repository: OllamaRuntimeConfigRepository) {
    this.#repository = repository
  }

  async getStatus(): Promise<OllamaServiceStatusResponse> {
    const runtimeConfig = await this.#repository.get()
    const executableExists = await pathExists(runtimeConfig.executable_path)
    const reachable = await probeOllama(runtimeConfig.base_url)

    return {
      reachable,
      process_detected: false,
      process_id: null,
      executable_path: runtimeConfig.executable_path,
      configured_models_dir: runtimeConfig.models_dir,
      effective_models_dir: runtimeConfig.models_dir,
      models_dir_source: "unknown",
      using_configured_models_dir: true,
      restart_required: false,
      can_self_restart: false,
      message: buildStatusMessage({ executableExists, reachable }),
    }
  }

  async restartService(): Promise<OllamaServiceStatusResponse> {
    const status = await this.getStatus()
    return {
      ...status,
      message: status.reachable ? "已刷新 Ollama 服务状态。" : "当前仅完成状态探测，尚未接入自动重启能力。",
    }
  }

  async synchronizeRuntimeEnvironment(): Promise<OllamaServiceStatusResponse> {
    return this.getStatus()
  }
}

async function probeOllama(baseUrl: string): Promise<boolean> {
  try {
    const target = new URL(`${baseUrl.replace(/\/+$/, "")}/api/tags`)
    const requestImpl = target.protocol === "https:" ? httpsRequest : httpRequest
    return await new Promise<boolean>((resolve) => {
      const request = requestImpl(
        target,
        {
          method: "GET",
          timeout: 1500,
        },
        (response) => {
          resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 500))
          response.resume()
        },
      )
      request.on("timeout", () => {
        request.destroy()
        resolve(false)
      })
      request.on("error", () => {
        resolve(false)
      })
      request.end()
    })
  } catch {
    return false
  }
}

function buildStatusMessage(input: { executableExists: boolean; reachable: boolean }): string {
  if (input.reachable) {
    return "Ollama 服务可达。"
  }
  if (input.executableExists) {
    return "已检测到 Ollama 可执行文件，但当前服务不可达。"
  }
  return "未检测到 Ollama 可执行文件。"
}
