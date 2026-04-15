import os from "node:os"
import path from "node:path"

import type { OllamaRuntimeConfigResponse } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"

interface StoredOllamaRuntimeConfig {
  install_dir: string
  executable_path: string
  models_dir: string
  base_url: string
}

export class OllamaRuntimeConfigRepository {
  readonly #config: AppConfig
  readonly #path: string

  constructor(config: AppConfig) {
    this.#config = config
    this.#path = path.join(config.storageDir, "ollama-runtime.json")
  }

  async get(): Promise<StoredOllamaRuntimeConfig> {
    if (!(await pathExists(this.#path))) {
      return this.#defaults()
    }
    return this.#normalize(await readJsonFile<Partial<StoredOllamaRuntimeConfig>>(this.#path, this.#defaults()))
  }

  async save(payload: Partial<StoredOllamaRuntimeConfig>): Promise<StoredOllamaRuntimeConfig> {
    const current = await this.get()
    const nextValue = this.#normalize({
      ...current,
      ...payload,
    })
    await writeJsonFile(this.#path, nextValue)
    return nextValue
  }

  #defaults(): StoredOllamaRuntimeConfig {
    const installDir = defaultInstallDir()
    return {
      install_dir: installDir,
      executable_path: defaultExecutablePath(installDir),
      models_dir: defaultModelsDir(),
      base_url: this.#config.ollamaBaseUrl.replace(/\/+$/, ""),
    }
  }

  #normalize(payload: Partial<StoredOllamaRuntimeConfig>): StoredOllamaRuntimeConfig {
    const install_dir = normalizePath(payload.install_dir, defaultInstallDir())
    return {
      install_dir,
      executable_path: normalizePath(payload.executable_path, defaultExecutablePath(install_dir)),
      models_dir: normalizePath(payload.models_dir, defaultModelsDir()),
      base_url: String(payload.base_url || "").trim().replace(/\/+$/, "") || this.#config.ollamaBaseUrl.replace(/\/+$/, ""),
    }
  }
}

export type { StoredOllamaRuntimeConfig as OllamaRuntimeConfig }

function defaultInstallDir(): string {
  if (process.platform === "win32") {
    return path.resolve(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "Ollama")
  }
  return "/usr/local/bin"
}

function defaultExecutablePath(installDir: string): string {
  return path.join(installDir, process.platform === "win32" ? "ollama.exe" : "ollama")
}

function defaultModelsDir(): string {
  return path.resolve(os.homedir(), ".ollama", "models")
}

function normalizePath(rawValue: unknown, fallback: string): string {
  const candidate = String(rawValue || "").trim()
  if (!candidate) {
    return path.normalize(fallback)
  }
  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(process.cwd(), candidate)
}
