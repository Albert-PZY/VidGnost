import path from "node:path"
import { execFile, spawn } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { createServer as createNetServer } from "node:net"
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

export interface OllamaModelInfo {
  modelId: string
  sizeBytes: number
}

export interface OllamaModelDiscoveryResult {
  models: OllamaModelInfo[]
  source: "remote" | "offline" | "unavailable"
}

type OllamaBaseUrlDiagnosis = "available" | "occupied" | "restricted" | "unknown"

interface OllamaProcessStartInput {
  baseUrl: string
  executablePath: string
  modelsDir: string
}

interface OllamaProcessStartResult {
  reachable: boolean
  startupError: string
}

interface OllamaServiceManagerDependencies {
  diagnoseBaseUrl?: (baseUrl: string) => Promise<OllamaBaseUrlDiagnosis>
  findPortOwnerPid?: (baseUrl: string) => Promise<number | null>
  findProcess?: (input: { executablePath: string }) => Promise<OllamaProcessInfo>
  killProcessByPid?: (pid: number) => Promise<void>
  listModels?: (baseUrl: string) => Promise<string[]>
  pathExists?: (targetPath: string) => Promise<boolean>
  probe?: (baseUrl: string) => Promise<boolean>
  startProcess?: (input: OllamaProcessStartInput) => Promise<OllamaProcessStartResult>
  stopProcess?: (input: { executablePath: string; trayExecutablePath: string }) => Promise<void>
}

const defaultDependencies: Required<OllamaServiceManagerDependencies> = {
  diagnoseBaseUrl: diagnoseOllamaBaseUrl,
  findPortOwnerPid: findPortOwnerPid,
  findProcess: findOllamaProcess,
  killProcessByPid: stopProcessByPid,
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
    const [reachable, processInfo, modelIds, manifestDirExists, baseUrlDiagnosis] = await Promise.all([
      this.#dependencies.probe(runtimeConfig.base_url),
      this.#dependencies.findProcess({ executablePath: runtimeConfig.executable_path }),
      this.#dependencies.listModels(runtimeConfig.base_url),
      this.#dependencies.pathExists(path.join(runtimeConfig.models_dir, "manifests")),
      this.#dependencies.diagnoseBaseUrl(runtimeConfig.base_url),
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
        baseUrl: runtimeConfig.base_url,
        baseUrlDiagnosis,
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

    const trayExecutablePath = resolveTrayExecutablePath(runtimeConfig.executable_path)
    await this.#dependencies.stopProcess({
      executablePath: runtimeConfig.executable_path,
      trayExecutablePath,
    })
    const startResult = await this.#dependencies.startProcess({
      baseUrl: runtimeConfig.base_url,
      executablePath: runtimeConfig.executable_path,
      modelsDir: runtimeConfig.models_dir,
    })
    let effectiveStartResult = startResult
    let restartFailureDiagnosis = diagnoseStartupFailure(runtimeConfig.base_url, startResult.startupError)
    let clearedOccupiedPort = false

    if (!startResult.reachable && restartFailureDiagnosis === "occupied") {
      const ownerPid = await this.#dependencies.findPortOwnerPid(runtimeConfig.base_url)
      if (ownerPid && ownerPid !== process.pid) {
        await this.#dependencies.killProcessByPid(ownerPid)
        clearedOccupiedPort = true
        effectiveStartResult = await this.#dependencies.startProcess({
          baseUrl: runtimeConfig.base_url,
          executablePath: runtimeConfig.executable_path,
          modelsDir: runtimeConfig.models_dir,
        })
        restartFailureDiagnosis = diagnoseStartupFailure(runtimeConfig.base_url, effectiveStartResult.startupError)
      }
    }

    const status = await this.getStatus()
    if (!effectiveStartResult.reachable || !status.reachable) {
      return {
        ...status,
        message: buildRestartFailureMessage({
          baseUrl: runtimeConfig.base_url,
          failureDiagnosis: restartFailureDiagnosis,
          clearedOccupiedPort,
          startupError: effectiveStartResult.startupError,
        }),
      }
    }
    return {
      ...status,
      message: clearedOccupiedPort
        ? `${renderBaseUrlLabel(runtimeConfig.base_url)} 原先被其他进程占用，已清退占用进程并已重启 Ollama。`
        : "Ollama 服务已重启并重新完成模型探测。",
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
  const models = await listOllamaModels(baseUrl)
  return models.map((item) => item.modelId)
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  const models = await tryListRemoteOllamaModels(baseUrl)
  return models || []
}

export async function discoverOllamaModels(input: {
  baseUrl: string
  modelsDir: string
}): Promise<OllamaModelDiscoveryResult> {
  const remoteModels = await tryListRemoteOllamaModels(input.baseUrl)
  if (remoteModels) {
    return {
      models: remoteModels,
      source: "remote",
    }
  }

  const offlineModels = await listOfflineOllamaModels(input.modelsDir)
  if (offlineModels.length > 0) {
    return {
      models: offlineModels,
      source: "offline",
    }
  }

  return {
    models: [],
    source: "unavailable",
  }
}

async function tryListRemoteOllamaModels(baseUrl: string): Promise<OllamaModelInfo[] | null> {
  try {
    const payload = await readJsonFromUrl(`${baseUrl.replace(/\/+$/, "")}/api/tags`)
    const models = Array.isArray((payload as { models?: unknown[] })?.models)
      ? (payload as { models: Array<Record<string, unknown>> }).models
      : []
    return models
      .map((item) => ({
        modelId: String(item.name || item.model || "").trim(),
        sizeBytes: normalizeOllamaModelSize(item.size),
      }))
      .filter((item) => Boolean(item.modelId))
  } catch {
    return null
  }
}

function normalizeOllamaModelSize(rawValue: unknown): number {
  const value = Number(rawValue)
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.trunc(value)
}

async function listOfflineOllamaModels(modelsDir: string): Promise<OllamaModelInfo[]> {
  const normalizedModelsDir = String(modelsDir || "").trim()
  if (!normalizedModelsDir) {
    return []
  }

  const manifestsDir = path.join(normalizedModelsDir, "manifests")
  if (!(await pathExists(manifestsDir))) {
    return []
  }

  const manifestPaths = await collectFilesRecursively(manifestsDir)
  const discovered = new Map<string, number>()
  for (const manifestPath of manifestPaths) {
    try {
      const raw = await readFile(manifestPath, "utf8")
      const manifest = JSON.parse(raw) as {
        config?: { digest?: unknown; size?: unknown }
        layers?: Array<{ digest?: unknown; size?: unknown }>
      }
      const modelId = buildModelIdFromManifestPath(path.relative(manifestsDir, manifestPath))
      if (!modelId) {
        continue
      }
      discovered.set(
        modelId,
        await measureManifestBlobSizeBytes(path.join(normalizedModelsDir, "blobs"), manifest),
      )
    } catch {
      // ignore malformed local manifest files during best-effort offline discovery
    }
  }

  return Array.from(discovered.entries())
    .map(([modelId, sizeBytes]) => ({ modelId, sizeBytes }))
    .sort((left, right) => left.modelId.localeCompare(right.modelId))
}

async function collectFilesRecursively(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFilesRecursively(entryPath))
      continue
    }
    if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

function buildModelIdFromManifestPath(relativeManifestPath: string): string {
  const segments = String(relativeManifestPath || "").split(/[\\/]+/).filter(Boolean)
  if (segments.length < 4) {
    return ""
  }

  const [, namespace, ...repositoryAndTag] = segments
  const tag = repositoryAndTag.pop()
  const repository = repositoryAndTag.join("/")
  if (!namespace || !repository || !tag) {
    return ""
  }

  return namespace === "library" ? `${repository}:${tag}` : `${namespace}/${repository}:${tag}`
}

async function measureManifestBlobSizeBytes(
  blobsDir: string,
  manifest: {
    config?: { digest?: unknown; size?: unknown }
    layers?: Array<{ digest?: unknown; size?: unknown }>
  },
): Promise<number> {
  const blobDescriptors = [
    manifest.config ? [manifest.config] : [],
    Array.isArray(manifest.layers) ? manifest.layers : [],
  ].flat()
  const seenDigests = new Set<string>()
  let totalBytes = 0

  for (const descriptor of blobDescriptors) {
    const digest = normalizeOllamaDigest(descriptor.digest)
    if (!digest || seenDigests.has(digest)) {
      continue
    }
    seenDigests.add(digest)

    const blobPath = path.join(blobsDir, digest.replace(":", "-"))
    try {
      totalBytes += (await stat(blobPath)).size
      continue
    } catch {
      totalBytes += normalizeOllamaModelSize(descriptor.size)
    }
  }

  return totalBytes
}

function normalizeOllamaDigest(rawValue: unknown): string {
  const digest = String(rawValue || "").trim().toLowerCase()
  if (!digest.startsWith("sha256:")) {
    return ""
  }
  return digest
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
): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await probe(baseUrl)) {
      return true
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 250)
    })
  }
  return false
}

async function diagnoseOllamaBaseUrl(baseUrl: string): Promise<OllamaBaseUrlDiagnosis> {
  const endpoint = parseLoopbackBaseUrl(baseUrl)
  if (!endpoint) {
    return "unknown"
  }

  return await new Promise<OllamaBaseUrlDiagnosis>((resolve) => {
    const server = createNetServer()
    server.once("error", (error) => {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : ""
      resolve(code === "EADDRINUSE" ? "occupied" : code === "EACCES" ? "restricted" : "unknown")
    })
    server.listen(endpoint.port, endpoint.hostname, () => {
      server.close(() => {
        resolve("available")
      })
    })
  })
}

async function findPortOwnerPid(baseUrl: string): Promise<number | null> {
  if (process.platform !== "win32") {
    return null
  }

  const endpoint = parseLoopbackBaseUrl(baseUrl)
  if (!endpoint) {
    return null
  }

  try {
    const { stdout } = await execFileAsync(
      "netstat",
      ["-ano", "-p", "tcp"],
      {
        timeout: 3000,
        windowsHide: true,
      },
    )
    const lines = String(stdout || "").split(/\r?\n/)
    let fallbackPid: number | null = null
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("TCP")) {
        continue
      }
      const columns = trimmed.split(/\s+/)
      if (columns.length < 5) {
        continue
      }
      const localPort = extractPortFromNetstatAddress(columns[1] || "")
      const state = String(columns[3] || "").toUpperCase()
      const pid = Number.parseInt(columns[4] || "", 10)
      if (localPort !== endpoint.port || !Number.isFinite(pid) || pid <= 0) {
        continue
      }
      if (state === "LISTENING") {
        return pid
      }
      fallbackPid = pid
    }
    return fallbackPid
  } catch {
    return null
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

async function stopOllamaProcess(input: { executablePath: string; trayExecutablePath: string }): Promise<void> {
  if (process.platform !== "win32") {
    return
  }

  const processNames = [
    path.basename(input.trayExecutablePath || "ollama app.exe"),
    path.basename(input.executablePath || "ollama.exe"),
  ]

  for (const processName of new Set(processNames.filter(Boolean))) {
    try {
      await execFileAsync(
        "taskkill",
        ["/IM", processName, "/F"],
        {
          timeout: 5000,
          windowsHide: true,
        },
      )
    } catch {
      // ignore when no process exists
    }
  }
}

async function startOllamaProcess(input: OllamaProcessStartInput): Promise<OllamaProcessStartResult> {
  if (process.platform !== "win32") {
    return {
      reachable: false,
      startupError: "当前平台尚未启用项目内 Ollama 自启动。",
    }
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
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  )
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  let spawnError = ""
  let exited = false
  let exitCode: number | null = null
  let exitSignal: NodeJS.Signals | null = null

  child.stdout?.on("data", (chunk) => {
    appendDiagnosticChunk(stdoutChunks, chunk)
  })
  child.stderr?.on("data", (chunk) => {
    appendDiagnosticChunk(stderrChunks, chunk)
  })
  child.once("error", (error) => {
    spawnError = error instanceof Error ? error.message : String(error || "")
  })
  child.once("exit", (code, signal) => {
    exited = true
    exitCode = typeof code === "number" ? code : null
    exitSignal = signal
  })

  const reachable = await waitForProbe(input.baseUrl, probeOllama, 10000)
  if (reachable) {
    child.unref()
    return {
      reachable: true,
      startupError: "",
    }
  }

  if (!exited && child.pid) {
    await stopProcessByPid(child.pid)
  }

  return {
    reachable: false,
    startupError: buildStartupFailureMessage({
      baseUrl: input.baseUrl,
      exitCode,
      exitSignal,
      spawnError,
      stderr: stderrChunks.join(""),
      stdout: stdoutChunks.join(""),
    }),
  }
}

function buildStatusMessage(input: {
  baseUrl: string
  baseUrlDiagnosis: OllamaBaseUrlDiagnosis
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
  if (input.baseUrlDiagnosis === "restricted") {
    return `${renderBaseUrlLabel(input.baseUrl)} 当前无法绑定：本机系统限制了这个端口，请解除端口保留或访问限制后重试。`
  }
  if (input.baseUrlDiagnosis === "occupied") {
    return `${renderBaseUrlLabel(input.baseUrl)} 已被其他进程占用，可使用启动/重启操作自动清退占用进程后重试。`
  }
  if (input.executableExists && input.processDetected) {
    return "已检测到 Ollama 进程，但当前服务地址不可达。"
  }
  if (input.executableExists) {
    return "已检测到 Ollama 可执行文件，但当前服务不可达。"
  }
  return "未检测到 Ollama 可执行文件。"
}

function resolveTrayExecutablePath(executablePath: string): string {
  const directory = path.dirname(executablePath || "")
  return path.join(directory, "ollama app.exe")
}

function parseLoopbackBaseUrl(baseUrl: string): { hostname: string; port: number; protocol: string } | null {
  try {
    const target = new URL(baseUrl)
    const hostname = target.hostname
    const port = Number.parseInt(target.port || (target.protocol === "https:" ? "443" : "80"), 10)
    if (!Number.isFinite(port) || port <= 0) {
      return null
    }
    if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
      return null
    }
    return {
      hostname,
      port,
      protocol: target.protocol,
    }
  } catch {
    return null
  }
}

function diagnoseStartupFailure(baseUrl: string, startupError: string): OllamaBaseUrlDiagnosis {
  if (!parseLoopbackBaseUrl(baseUrl)) {
    return "unknown"
  }
  const normalized = String(startupError || "").toLowerCase()
  if (
    normalized.includes("forbidden by its access permissions") ||
    normalized.includes("permission denied") ||
    normalized.includes("eacces")
  ) {
    return "restricted"
  }
  if (
    normalized.includes("already in use") ||
    normalized.includes("only one usage of each socket address is normally permitted") ||
    normalized.includes("eaddrinuse")
  ) {
    return "occupied"
  }
  return "unknown"
}

function renderBaseUrlLabel(baseUrl: string): string {
  const endpoint = parseLoopbackBaseUrl(baseUrl)
  if (!endpoint) {
    return baseUrl
  }
  return `${endpoint.hostname}:${endpoint.port}`
}

function buildRestartFailureMessage(input: {
  baseUrl: string
  clearedOccupiedPort: boolean
  failureDiagnosis: OllamaBaseUrlDiagnosis
  startupError: string
}): string {
  const detail = String(input.startupError || "").trim() || `已发起 Ollama 重启，但 ${renderBaseUrlLabel(input.baseUrl)} 尚未返回响应。`
  if (input.failureDiagnosis === "restricted") {
    return `${renderBaseUrlLabel(input.baseUrl)} 当前无法绑定：本机系统限制了这个端口，请解除端口保留或访问限制后重试。`
  }
  if (input.failureDiagnosis === "occupied" && input.clearedOccupiedPort) {
    return `${renderBaseUrlLabel(input.baseUrl)} 原先被其他进程占用，已尝试清退占用进程并重启 Ollama，但服务仍未就绪。 ${detail}`.trim()
  }
  if (input.failureDiagnosis === "occupied") {
    return `${renderBaseUrlLabel(input.baseUrl)} 已被其他进程占用，请先释放该端口后重试。`
  }
  return detail
}

function buildStartupFailureMessage(input: {
  baseUrl: string
  exitCode: number | null
  exitSignal: NodeJS.Signals | null
  spawnError: string
  stderr: string
  stdout: string
}): string {
  const stderr = input.stderr.trim()
  if (stderr) {
    return stderr
  }
  const stdout = input.stdout.trim()
  if (stdout) {
    return stdout
  }
  if (input.spawnError.trim()) {
    return input.spawnError.trim()
  }
  if (input.exitCode !== null) {
    return `Ollama 进程已退出，退出码 ${input.exitCode}，服务地址 ${renderBaseUrlLabel(input.baseUrl)} 未就绪。`
  }
  if (input.exitSignal) {
    return `Ollama 进程被信号 ${input.exitSignal} 终止，服务地址 ${renderBaseUrlLabel(input.baseUrl)} 未就绪。`
  }
  return `已发起 Ollama 重启，但 ${renderBaseUrlLabel(input.baseUrl)} 尚未返回响应。`
}

function appendDiagnosticChunk(chunks: string[], chunk: Buffer | string): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
  if (!text) {
    return
  }
  chunks.push(text)
  const joined = chunks.join("")
  if (joined.length > 8192) {
    chunks.splice(0, chunks.length, joined.slice(-8192))
  }
}

function extractPortFromNetstatAddress(address: string): number | null {
  const bracketMatch = /\]:(\d+)$/.exec(address)
  if (bracketMatch) {
    const port = Number.parseInt(bracketMatch[1] || "", 10)
    return Number.isFinite(port) && port > 0 ? port : null
  }
  const match = /:(\d+)$/.exec(address)
  if (!match) {
    return null
  }
  const port = Number.parseInt(match[1] || "", 10)
  return Number.isFinite(port) && port > 0 ? port : null
}

async function stopProcessByPid(pid: number): Promise<void> {
  if (process.platform !== "win32" || !Number.isFinite(pid) || pid <= 0) {
    return
  }
  try {
    await execFileAsync(
      "taskkill",
      ["/PID", String(pid), "/F", "/T"],
      {
        timeout: 5000,
        windowsHide: true,
      },
    )
  } catch {
    // ignore when the spawned process already exited
  }
}
