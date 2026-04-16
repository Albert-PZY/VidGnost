import path from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { URL } from "node:url"

import type { OllamaServiceStatusResponse } from "@vidgnost/contracts"

import { pathExists } from "../../core/fs.js"
import type { OllamaRuntimeConfigRepository } from "./ollama-runtime-config-repository.js"

const execFileAsync = promisify(execFile)

interface OllamaProcessInfo {
  detected: boolean
  pid: number | null
}

interface OllamaProcessStartInput {
  baseUrl: string
  executablePath: string
  modelsDir: string
}

interface OllamaServiceManagerDependencies {
  findProcess?: (input: { executablePath: string }) => Promise<OllamaProcessInfo>
  listModels?: (baseUrl: string) => Promise<string[]>
  pathExists?: (targetPath: string) => Promise<boolean>
  probe?: (baseUrl: string) => Promise<boolean>
  startProcess?: (input: OllamaProcessStartInput) => Promise<void>
  stopProcess?: (input: { executablePath: string }) => Promise<void>
}

const defaultDependencies: Required<OllamaServiceManagerDependencies> = {
  findProcess: findOllamaProcess,
  listModels: listOllamaModelIds,
  pathExists,
  probe: probeOllama,
  startProcess: startOllamaProcess,
  stopProcess: stopOllamaProcess,
}

export class OllamaServiceManager {
  readonly #dependencies: Required<OllamaServiceManagerDependencies>
  readonly #repository: OllamaRuntimeConfigRepository

  constructor(
    repository: OllamaRuntimeConfigRepository,
    dependencies: OllamaServiceManagerDependencies = {},
  ) {
    this.#repository = repository
    this.#dependencies = {
      ...defaultDependencies,
      ...dependencies,
    }
  }

  async getStatus(): Promise<OllamaServiceStatusResponse> {
    const runtimeConfig = await this.#repository.get()
    const executableExists = await this.#dependencies.pathExists(runtimeConfig.executable_path)
    const [reachable, processInfo, modelIds, manifestDirExists] = await Promise.all([
      this.#dependencies.probe(runtimeConfig.base_url),
      this.#dependencies.findProcess({ executablePath: runtimeConfig.executable_path }),
      this.#dependencies.listModels(runtimeConfig.base_url),
      this.#dependencies.pathExists(path.join(runtimeConfig.models_dir, "manifests")),
    ])
    const effectiveModelsDir = (process.env.OLLAMA_MODELS || runtimeConfig.models_dir).trim() || runtimeConfig.models_dir
    const normalizedConfiguredModelsDir = path.normalize(runtimeConfig.models_dir)
    const normalizedEffectiveModelsDir = path.normalize(effectiveModelsDir)
    const modelsDirSource =
      process.env.OLLAMA_MODELS && normalizedEffectiveModelsDir === normalizedConfiguredModelsDir
        ? "env"
        : process.env.OLLAMA_MODELS
          ? "unknown"
          : "default"
    const canSelfRestart = executableExists && process.platform === "win32"
    const restartRequired = Boolean(
      canSelfRestart && processInfo.detected && reachable && manifestDirExists && modelIds.length === 0,
    )

    return {
      reachable,
      process_detected: processInfo.detected,
      process_id: processInfo.pid,
      executable_path: runtimeConfig.executable_path,
      configured_models_dir: runtimeConfig.models_dir,
      effective_models_dir: effectiveModelsDir,
      models_dir_source: modelsDirSource,
      using_configured_models_dir: normalizedConfiguredModelsDir === normalizedEffectiveModelsDir,
      restart_required: restartRequired,
      can_self_restart: canSelfRestart,
      message: buildStatusMessage({
        executableExists,
        modelCount: modelIds.length,
        processDetected: processInfo.detected,
        reachable,
        restartRequired,
      }),
    }
  }

  async restartService(): Promise<OllamaServiceStatusResponse> {
    const runtimeConfig = await this.#repository.get()
    const executableExists = await this.#dependencies.pathExists(runtimeConfig.executable_path)
    const canSelfRestart = executableExists && process.platform === "win32"
    if (!canSelfRestart) {
      const status = await this.getStatus()
      return {
        ...status,
        message: executableExists
          ? "当前平台尚未启用项目内 Ollama 自启动，请手动重启本地服务。"
          : "未检测到 Ollama 可执行文件，无法执行项目内重启。",
      }
    }

    await this.#dependencies.stopProcess({ executablePath: runtimeConfig.executable_path })
    await this.#dependencies.startProcess({
      baseUrl: runtimeConfig.base_url,
      executablePath: runtimeConfig.executable_path,
      modelsDir: runtimeConfig.models_dir,
    })
    await waitForProbe(runtimeConfig.base_url, this.#dependencies.probe)

    const status = await this.getStatus()
    return {
      ...status,
      message: status.reachable
        ? "Ollama 服务已重启并重新完成模型探测。"
        : "已发起 Ollama 重启，但服务尚未在配置地址响应。",
    }
  }

  async synchronizeRuntimeEnvironment(): Promise<OllamaServiceStatusResponse> {
    return this.getStatus()
  }
}

export async function probeOllama(baseUrl: string): Promise<boolean> {
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

export async function listOllamaModelIds(baseUrl: string): Promise<string[]> {
  try {
    const payload = await readJsonFromUrl(`${baseUrl.replace(/\/+$/, "")}/api/tags`)
    const models = Array.isArray((payload as { models?: unknown[] })?.models)
      ? (payload as { models: Array<Record<string, unknown>> }).models
      : []
    return models
      .map((item) => String(item.name || item.model || "").trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

async function readJsonFromUrl(targetUrl: string): Promise<unknown> {
  const target = new URL(targetUrl)
  const requestImpl = target.protocol === "https:" ? httpsRequest : httpRequest
  return await new Promise<unknown>((resolve, reject) => {
    const request = requestImpl(
      target,
      {
        method: "GET",
        timeout: 2000,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          if (!response.statusCode || response.statusCode >= 500) {
            reject(new Error(raw || "remote error"))
            return
          }
          try {
            resolve(raw ? JSON.parse(raw) : {})
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    request.on("timeout", () => {
      request.destroy()
      reject(new Error("request timeout"))
    })
    request.on("error", (error) => {
      reject(error)
    })
    request.end()
  })
}

async function waitForProbe(
  baseUrl: string,
  probe: (baseUrl: string) => Promise<boolean>,
  timeoutMs = 10000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await probe(baseUrl)) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 250)
    })
  }
}

async function findOllamaProcess(input: { executablePath: string }): Promise<OllamaProcessInfo> {
  if (process.platform !== "win32") {
    return {
      detected: false,
      pid: null,
    }
  }

  try {
    const executableName = path.basename(input.executablePath || "ollama.exe")
    const { stdout } = await execFileAsync(
      "tasklist",
      [
        "/FI",
        `IMAGENAME eq ${executableName}`,
        "/FO",
        "CSV",
        "/NH",
      ],
      {
        timeout: 1500,
        windowsHide: true,
      },
    )
    const firstLine = String(stdout || "").trim().split(/\r?\n/, 1)[0] || ""
    const columns = firstLine
      .split("\",\"")
      .map((item) => item.replace(/^"/, "").replace(/"$/, "").trim())
    const pid = Number.parseInt(columns[1] || "", 10)
    return {
      detected: Number.isFinite(pid) && pid > 0,
      pid: Number.isFinite(pid) && pid > 0 ? pid : null,
    }
  } catch {
    return {
      detected: false,
      pid: null,
    }
  }
}

async function stopOllamaProcess(input: { executablePath: string }): Promise<void> {
  if (process.platform !== "win32") {
    return
  }

  const executableName = path.basename(input.executablePath || "ollama.exe")
  try {
    await execFileAsync(
      "taskkill",
      ["/IM", executableName, "/F"],
      {
        timeout: 5000,
        windowsHide: true,
      },
    )
  } catch {
    // ignore when no process exists
  }
}

async function startOllamaProcess(input: OllamaProcessStartInput): Promise<void> {
  if (process.platform !== "win32") {
    return
  }

  const child = spawn(
    input.executablePath,
    ["serve"],
    {
      detached: true,
      env: {
        ...process.env,
        OLLAMA_HOST: new URL(input.baseUrl).host,
        OLLAMA_MODELS: input.modelsDir,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  )
  child.unref()
}

function buildStatusMessage(input: {
  executableExists: boolean
  modelCount: number
  processDetected: boolean
  reachable: boolean
  restartRequired: boolean
}): string {
  if (input.reachable && input.modelCount > 0) {
    return `Ollama 服务可达，已探测到 ${input.modelCount} 个模型。`
  }
  if (input.reachable && input.restartRequired) {
    return "Ollama 服务可达，但尚未加载配置目录中的模型，请执行启动/重启。"
  }
  if (input.reachable) {
    return "Ollama 服务可达，但当前未返回任何模型标签。"
  }
  if (input.executableExists && input.processDetected) {
    return "已检测到 Ollama 进程，但当前服务地址不可达。"
  }
  if (input.executableExists) {
    return "已检测到 Ollama 可执行文件，但当前服务不可达。"
  }
  return "未检测到 Ollama 可执行文件。"
}
