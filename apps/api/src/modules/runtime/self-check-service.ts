import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { statfs } from "node:fs/promises"
import { promisify } from "node:util"

import type {
  ModelDescriptor,
  ModelListResponse,
  SelfCheckIssueResponse,
  SelfCheckReportResponse,
  SelfCheckStepResponse,
} from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { ensureDirectory, pathExists } from "../../core/fs.js"
import { generateTimeKey } from "../../core/id.js"
import type { EventBus } from "../events/event-bus.js"
import type { LlmConfigRepository } from "../llm/llm-config-repository.js"
import type { ModelCatalogRepository } from "../models/model-catalog-repository.js"
import type { LlmReadinessResult, LlmReadinessService } from "./llm-readiness-service.js"
import type { WhisperRuntimeStatusService } from "./whisper-runtime-status-service.js"

const execFileAsync = promisify(execFile)
const MAX_SESSION_CACHE = 24
const LOCAL_VLM_SYNC_PROBE_BUDGET_MS = 400
const LOCAL_VLM_REACHABILITY_TIMEOUT_SECONDS = 5
const VLM_PROBE_CACHE_TTL_MS = 10 * 60 * 1000
const VLM_MINIMAL_PROBE_IMAGE_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wj8iZcAAAAASUVORK5CYII="
const STEP_IDS = [
  "env",
  "gpu",
  "whisper",
  "llm",
  "vlm",
  "embedding",
  "rerank",
  "storage",
  "ffmpeg",
  "model-cache",
] as const

type SessionStatus = "idle" | "running" | "completed" | "failed" | "fixing"
type StepStatus = "pending" | "running" | "passed" | "warning" | "failed"

interface SelfCheckOutcome {
  auto_fixable?: boolean
  check_depth?: string
  details?: Record<string, string>
  manual_action?: string
  message: string
  status: Exclude<StepStatus, "pending" | "running">
}

interface SelfCheckSession {
  auto_fix_available: boolean
  id: string
  issues: SelfCheckIssueResponse[]
  last_error: string
  progress: number
  status: SessionStatus
  steps: SelfCheckStepResponse[]
  updated_at: string
}

interface SelfCheckItem {
  id: (typeof STEP_IDS)[number]
  run: () => Promise<SelfCheckOutcome>
  title: string
}

interface VlmProbeCacheEntry {
  cachedAt: number
  result: LlmReadinessResult
}

export class SelfCheckService {
  private readonly sessions = new Map<string, SelfCheckSession>()
  private readonly vlmProbeCache = new Map<string, VlmProbeCacheEntry>()
  private readonly vlmProbeInflight = new Map<string, Promise<LlmReadinessResult>>()

  constructor(
    private readonly config: AppConfig,
    private readonly eventBus: EventBus,
    private readonly llmConfigRepository: LlmConfigRepository,
    private readonly modelCatalogRepository: ModelCatalogRepository,
    private readonly llmReadinessService: LlmReadinessService,
    private readonly whisperRuntimeStatusService: WhisperRuntimeStatusService,
  ) {}

  async startCheck(): Promise<string> {
    const sessionId = generateTimeKey("self-check", (candidate) => this.sessions.has(candidate))
    this.sessions.set(sessionId, createEmptySession(sessionId))
    this.pruneCachedSessions()
    await this.eventBus.resetTopic(this.topic(sessionId))
    void this.runCheck(sessionId)
    return sessionId
  }

  async startAutoFix(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Self-check session not found: ${sessionId}`)
    }
    if (session.status === "running" || session.status === "fixing") {
      throw new Error("Self-check is still running for this session.")
    }
    session.status = "fixing"
    session.updated_at = nowIso()
    await this.eventBus.resetTopic(this.topic(sessionId))
    void this.runAutoFixAndRecheck(sessionId)
  }

  getReport(sessionId: string): SelfCheckReportResponse | null {
    this.pruneCachedSessions()
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }
    return serializeSession(session)
  }

  private async runAutoFixAndRecheck(sessionId: string): Promise<void> {
    const topic = this.topic(sessionId)
    try {
      await this.eventBus.publish(topic, {
        type: "self_check_fix_start",
        session_id: sessionId,
        status: "fixing",
      })

      await ensureDirectory(this.config.storageDir)
      await ensureDirectory(this.config.eventLogDir)
      await ensureDirectory(this.config.uploadDir)
      await ensureDirectory(this.config.tempDir)
      const whisperPath = await this.resolveWhisperModelPath()
      if (whisperPath) {
        await ensureDirectory(whisperPath)
      }

      await this.eventBus.publish(topic, {
        type: "self_check_fix_complete",
        session_id: sessionId,
        status: "fixing",
      })
      await this.runCheck(sessionId)
    } catch (error) {
      const session = this.sessions.get(sessionId)
      if (session) {
        session.status = "failed"
        session.last_error = error instanceof Error ? error.message : String(error)
        session.updated_at = nowIso()
      }
      await this.eventBus.publish(topic, {
        type: "self_fix_failed",
        session_id: sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async runCheck(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    const topic = this.topic(sessionId)
    const modelListPromise = this.modelCatalogRepository.listModels()
    const steps = this.buildSteps(modelListPromise)
    session.status = "running"
    session.progress = 0
    session.last_error = ""
    session.issues = []
    session.auto_fix_available = false
    session.steps = steps.map((item) => ({
      id: item.id,
      title: item.title,
      status: "pending",
      check_depth: "config_only",
      message: "",
      details: {},
      auto_fixable: false,
      manual_action: "",
    }))
    session.updated_at = nowIso()

    try {
      await this.eventBus.publish(topic, {
        type: "self_check_started",
        session_id: sessionId,
        total_steps: steps.length,
        progress: 0,
      })

      for (const [index, item] of steps.entries()) {
        this.markStepRunning(session, item.id)
        await this.eventBus.publish(topic, {
          type: "self_check_step_start",
          session_id: sessionId,
          index: index + 1,
          total_steps: steps.length,
          progress: session.progress,
          step: session.steps.find((step) => step.id === item.id),
        })
        const outcome = await item.run()
        this.markStepResult(session, item.id, outcome)
        await this.eventBus.publish(topic, {
          type: "self_check_step_result",
          session_id: sessionId,
          index: index + 1,
          total_steps: steps.length,
          progress: session.progress,
          step: session.steps.find((step) => step.id === item.id),
        })
      }

      session.status = "completed"
      session.progress = 100
      session.auto_fix_available = session.issues.some((item) => item.auto_fixable)
      session.updated_at = nowIso()
      this.pruneCachedSessions()

      await this.eventBus.publish(topic, {
        type: "self_check_complete",
        session_id: sessionId,
        progress: 100,
        issues: session.issues,
        auto_fix_available: session.auto_fix_available,
        status: session.status,
      })
    } catch (error) {
      session.status = "failed"
      session.last_error = error instanceof Error ? error.message : String(error)
      session.updated_at = nowIso()
      this.pruneCachedSessions()
      await this.eventBus.publish(topic, {
        type: "self_check_failed",
        session_id: sessionId,
        error: session.last_error,
        status: session.status,
      })
    }
  }

  private markStepRunning(session: SelfCheckSession, stepId: string): void {
    const step = session.steps.find((item) => item.id === stepId)
    if (!step) {
      return
    }
    step.status = "running"
    step.message = "Checking..."
    session.updated_at = nowIso()
  }

  private markStepResult(session: SelfCheckSession, stepId: string, outcome: SelfCheckOutcome): void {
    const step = session.steps.find((item) => item.id === stepId)
    if (!step) {
      return
    }

    step.status = outcome.status
    step.check_depth = outcome.check_depth || step.check_depth || "config_only"
    step.message = outcome.message
    step.details = { ...(outcome.details || {}) }
    step.auto_fixable = Boolean(outcome.auto_fixable)
    step.manual_action = outcome.manual_action || ""

    session.issues = session.steps
      .filter((item) => item.status === "warning" || item.status === "failed")
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        check_depth: item.check_depth || "config_only",
        message: item.message,
        details: { ...item.details },
        auto_fixable: item.auto_fixable,
        manual_action: item.manual_action,
      }))
    session.progress = Math.round(
      (session.steps.filter((item) => item.status === "passed" || item.status === "warning" || item.status === "failed").length /
        Math.max(1, session.steps.length)) * 100,
    )
    session.auto_fix_available = session.issues.some((item) => item.auto_fixable)
    session.updated_at = nowIso()
  }

  private buildSteps(modelListPromise: Promise<ModelListResponse>): SelfCheckItem[] {
    return [
      { id: "env", title: "系统环境", run: () => this.checkEnv() },
      { id: "gpu", title: "GPU 加速", run: () => this.checkGpu() },
      { id: "whisper", title: "Whisper 转写", run: () => this.checkWhisper(modelListPromise) },
      { id: "llm", title: "LLM 模型", run: () => this.checkLlm() },
      { id: "vlm", title: "视觉模型", run: () => this.checkVlm(modelListPromise) },
      { id: "embedding", title: "嵌入模型", run: () => this.checkModel(modelListPromise, "embedding-default", "默认嵌入模型") },
      { id: "rerank", title: "重排序模型", run: () => this.checkModel(modelListPromise, "rerank-default", "默认重排序模型") },
      { id: "storage", title: "存储空间", run: () => this.checkStorage() },
      { id: "ffmpeg", title: "FFmpeg", run: () => this.checkFfmpeg() },
      { id: "model-cache", title: "Whisper 模型缓存", run: () => this.checkModelCache(modelListPromise) },
    ]
  }

  private async checkEnv(): Promise<SelfCheckOutcome> {
    const pnpmPath = await findCommand("pnpm")
    const details = {
      操作系统: `${os.type()} ${os.release()}`,
      Node: process.version,
      pnpm: pnpmPath || "missing",
    }
    if (!pnpmPath) {
      return {
        status: "warning",
        message: "pnpm 未安装，桌面开发链路不可用。",
        details,
        manual_action: "请先安装 pnpm，再重新执行系统自检。",
      }
    }
    return {
      status: "passed",
      message: "系统环境可用。",
      details,
    }
  }

  private async checkGpu(): Promise<SelfCheckOutcome> {
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
      ], {
        timeout: 2000,
        windowsHide: true,
      })
      const line = stdout.trim().split(/\r?\n/, 1)[0]?.trim()
      if (!line) {
        throw new Error("no gpu output")
      }
      const [name = "unknown", memory = "unknown", driver = "unknown"] = line.split(",").map((item) => item.trim())
      return {
        status: "passed",
        message: "GPU 加速可用。",
        details: {
          显卡: name,
          "显存(MB)": memory,
          驱动版本: driver,
        },
      }
    } catch {
      return {
        status: "warning",
        message: "未检测到可用的 NVIDIA GPU 遥测。",
        details: {
          显卡: "未检测到 NVIDIA GPU",
        },
      }
    }
  }

  private async checkWhisper(modelListPromise?: Promise<ModelListResponse>): Promise<SelfCheckOutcome> {
    const [runtime, models] = await Promise.all([
      this.whisperRuntimeStatusService.getStatus(),
      modelListPromise || this.modelCatalogRepository.listModels(),
    ])
    const whisperModel = models.items.find((item) => item.id === "whisper-default")
    const details = {
      运行时状态: runtime.status,
      运行时目录: runtime.install_dir || runtime.bin_dir || "未配置",
      模型目录: whisperModel?.path || whisperModel?.default_path || "未配置",
      模型状态: whisperModel?.status || "unknown",
    }
    if (runtime.ready && whisperModel?.is_installed) {
      return {
        status: "passed",
        message: "Whisper 转写运行时和模型缓存已就绪。",
        details,
      }
    }
    return {
      status: "warning",
      message: "Whisper 转写链路尚未完全就绪。",
      details,
      manual_action: "请确认 Whisper 模型缓存和本地运行时目录均已准备完成。",
    }
  }

  private async checkLlm(): Promise<SelfCheckOutcome> {
    const config = await this.llmConfigRepository.get()
    const readiness = await this.llmReadinessService.verifyRemoteModel({
      apiKey: config.api_key,
      baseUrl: config.base_url,
      label: "LLM 服务",
      model: config.model,
      timeoutSeconds: 15,
    })
    const details = {
      ...readiness.details,
      鉴权: config.api_key_configured ? "已配置" : "未配置",
    }
    if (!readiness.ok) {
      return {
        status: "warning",
        check_depth: readiness.checkDepth,
        message: readiness.message,
        details,
        manual_action: "请在设置中心填写可用的 LLM Base URL、模型名和 API Key，并确认远程 /models 返回中包含当前模型。",
      }
    }

    return {
      status: "passed",
      check_depth: readiness.checkDepth,
      message: readiness.message,
      details: {
        ...details,
      },
    }
  }

  private async checkModel(
    modelListPromise: Promise<ModelListResponse> | undefined,
    modelId: string,
    label: string,
  ): Promise<SelfCheckOutcome> {
    const models = await (modelListPromise || this.modelCatalogRepository.listModels())
    const model = models.items.find((item) => item.id === modelId)
    if (!model) {
      return {
        status: "warning",
        message: `${label} 配置缺失。`,
        details: {},
        manual_action: "请在模型设置中确认该模型条目仍然存在。",
      }
    }
    const details = buildModelDetails(model)
    if (!model.enabled) {
      return {
        status: "warning",
        check_depth: "config_only",
        message: `${label} 已停用。`,
        details,
        manual_action: "请在模型设置中重新启用该模型。",
      }
    }
    if (!model.is_installed) {
      return {
        status: "warning",
        check_depth: "config_only",
        message: `${label} 尚未就绪。`,
        details,
        manual_action: "请在模型设置中确认模型路径、提供方和可用性状态。",
      }
    }

    if (model.provider === "openai_compatible" || model.api_key_configured) {
      const readiness = await this.llmReadinessService.verifyRemoteModel({
        apiKey: model.api_key,
        baseUrl: model.api_base_url,
        label,
        model: model.api_model || model.model_id,
        timeoutSeconds: model.api_timeout_seconds,
      })
      if (!readiness.ok) {
        return {
          status: "warning",
          check_depth: readiness.checkDepth,
          message: readiness.message,
          details: {
            ...details,
            ...readiness.details,
          },
          manual_action: "请确认远程模型服务可达，并且 /models 返回中包含当前模型。",
        }
      }
      return {
        status: "passed",
        check_depth: readiness.checkDepth,
        message: readiness.message,
        details: {
          ...details,
          ...readiness.details,
        },
      }
    }

    return {
      status: "passed",
      check_depth: "runtime_ready",
      message: `${label} 已就绪。`,
      details,
    }
  }

  private async checkVlm(modelListPromise?: Promise<ModelListResponse>): Promise<SelfCheckOutcome> {
    const models = await (modelListPromise || this.modelCatalogRepository.listModels())
    const target = models.items.find((item) => item.id === "vlm-default")
    if (!target) {
      return {
        status: "warning",
        check_depth: "config_only",
        message: "视觉模型配置缺失。",
        details: {},
        manual_action: "请在模型设置中恢复 vlm-default 条目。",
      }
    }

    const details = buildModelDetails(target)
    if (!target.enabled || !target.is_installed) {
      return {
        status: "warning",
        check_depth: "config_only",
        message: "视觉模型尚未就绪。",
        details,
        manual_action: "请启用并安装 vlm-default，然后重试。",
      }
    }

    const probeInput = {
      apiKey: target.api_key,
      baseUrl: target.api_base_url,
      label: "视觉模型",
      model: target.api_model || target.model_id,
      imageUrl: VLM_MINIMAL_PROBE_IMAGE_URL,
      timeoutSeconds: target.api_timeout_seconds,
    }

    if (isLoopbackBaseUrl(probeInput.baseUrl)) {
      const reachability = await this.llmReadinessService.verifyRemoteModel({
        apiKey: probeInput.apiKey,
        baseUrl: probeInput.baseUrl,
        label: probeInput.label,
        model: probeInput.model,
        timeoutSeconds: LOCAL_VLM_REACHABILITY_TIMEOUT_SECONDS,
      })
      if (!reachability.ok) {
        return this.buildVlmProbeOutcome(details, reachability)
      }

      const probeKey = buildVlmProbeCacheKey(probeInput.baseUrl, probeInput.model)
      const cachedProbe = this.getCachedVlmProbe(probeKey)
      if (cachedProbe) {
        return this.buildVlmProbeOutcome(details, cachedProbe)
      }

      const probePromise = this.getOrStartLocalVlmProbe(probeKey, probeInput)
      const fastProbe = await raceWithTimeout(probePromise, LOCAL_VLM_SYNC_PROBE_BUDGET_MS)
      if (fastProbe) {
        return this.buildVlmProbeOutcome(details, fastProbe)
      }

      return {
        status: "passed",
        check_depth: "reachability",
        message: "视觉模型服务可达，真实图像探测正在后台预热。",
        details: {
          ...details,
          ...reachability.details,
          视觉能力已验证: "预热中",
          探测模式: "快速可达性校验",
        },
      }
    }

    const probe = await this.llmReadinessService.probeVisionModel(probeInput)
    return this.buildVlmProbeOutcome(details, probe)
  }

  private buildVlmProbeOutcome(details: Record<string, string>, probe: LlmReadinessResult): SelfCheckOutcome {
    if (!probe.ok) {
      return {
        status: "warning",
        check_depth: probe.checkDepth,
        message: probe.message,
        details: {
          ...details,
          ...probe.details,
        },
        manual_action: "请确认 vlm-default 的模型名和远程服务能力，并检查 API Key 与端口可达性。",
      }
    }

    return {
      status: "passed",
      check_depth: probe.checkDepth,
      message: probe.message,
      details: {
        ...details,
        ...probe.details,
      },
    }
  }

  private getCachedVlmProbe(cacheKey: string): LlmReadinessResult | null {
    const cached = this.vlmProbeCache.get(cacheKey)
    if (!cached) {
      return null
    }
    if (Date.now() - cached.cachedAt > VLM_PROBE_CACHE_TTL_MS) {
      this.vlmProbeCache.delete(cacheKey)
      return null
    }
    return cached.result
  }

  private getOrStartLocalVlmProbe(
    cacheKey: string,
    probeInput: {
      apiKey: string
      baseUrl: string
      imageUrl: string
      label: string
      model: string
      timeoutSeconds?: number
    },
  ): Promise<LlmReadinessResult> {
    const inflight = this.vlmProbeInflight.get(cacheKey)
    if (inflight) {
      return inflight
    }

    const probePromise = this.llmReadinessService
      .probeVisionModel(probeInput)
      .then((result) => {
        if (result.ok && result.checkDepth === "model_verified") {
          this.vlmProbeCache.set(cacheKey, {
            cachedAt: Date.now(),
            result,
          })
        }
        return result
      })
      .finally(() => {
        this.vlmProbeInflight.delete(cacheKey)
      })

    this.vlmProbeInflight.set(cacheKey, probePromise)
    return probePromise
  }

  private async checkStorage(): Promise<SelfCheckOutcome> {
    await ensureDirectory(this.config.storageDir)
    try {
      const stats = await statfs(this.config.storageDir)
      const freeBytes = Number(stats.bavail) * Number(stats.bsize)
      const totalBytes = Number(stats.blocks) * Number(stats.bsize)
      const freeGb = freeBytes / (1024 ** 3)
      if (freeGb < 5) {
        return {
          status: "failed",
          message: "可用磁盘空间不足 5GB。",
          details: {
            存储目录: this.config.storageDir,
            "总空间(GB)": (totalBytes / (1024 ** 3)).toFixed(1),
            "可用空间(GB)": freeGb.toFixed(1),
          },
          manual_action: "请释放磁盘空间后再继续执行长视频处理任务。",
        }
      }
      return {
        status: "passed",
        message: "存储空间充足。",
        details: {
          存储目录: this.config.storageDir,
          "总空间(GB)": (totalBytes / (1024 ** 3)).toFixed(1),
          "可用空间(GB)": freeGb.toFixed(1),
        },
      }
    } catch {
      return {
        status: "warning",
        message: "无法读取磁盘空间统计信息。",
        details: {
          存储目录: this.config.storageDir,
        },
      }
    }
  }

  private async checkFfmpeg(): Promise<SelfCheckOutcome> {
    const ffmpegPath = await findCommand("ffmpeg")
    if (ffmpegPath) {
      return {
        status: "passed",
        message: "FFmpeg 可用。",
        details: {
          ffmpeg: ffmpegPath,
        },
      }
    }
    return {
      status: "warning",
      message: "FFmpeg 未安装或不在 PATH 中。",
      details: {
        ffmpeg: "missing",
      },
      manual_action: "请安装 FFmpeg 并将其加入 PATH。",
    }
  }

  private async checkModelCache(modelListPromise?: Promise<ModelListResponse>): Promise<SelfCheckOutcome> {
    const whisperPath = await this.resolveWhisperModelPath(modelListPromise)
    if (!whisperPath) {
      return {
        status: "warning",
        message: "Whisper 模型目录尚未配置。",
        details: {},
        auto_fixable: true,
        manual_action: "可执行自动修复创建默认模型缓存目录。",
      }
    }
    const exists = await pathExists(whisperPath)
    if (exists) {
      return {
        status: "passed",
        check_depth: "runtime_ready",
        message: "Whisper 模型缓存目录可用。",
        details: {
          缓存目录: whisperPath,
        },
      }
    }
    return {
      status: "warning",
      check_depth: "config_only",
      message: "Whisper 模型缓存目录不存在。",
      details: {
        缓存目录: whisperPath,
      },
      auto_fixable: true,
      manual_action: "可执行自动修复创建默认缓存目录，后续首个任务会继续补齐模型文件。",
    }
  }

  private async resolveWhisperModelPath(modelListPromise?: Promise<ModelListResponse>): Promise<string> {
    const models = await (modelListPromise || this.modelCatalogRepository.listModels())
    const model = models.items.find((item) => item.id === "whisper-default")
    return model?.path || model?.default_path || ""
  }

  private topic(sessionId: string): string {
    return `self-check:${sessionId}`
  }

  private pruneCachedSessions(): void {
    const removedSessionIds = pruneSessions(this.sessions)
    removedSessionIds.forEach((sessionId) => {
      this.eventBus.releaseTopic(this.topic(sessionId), { deleteEventLog: true })
    })
  }
}

function createEmptySession(sessionId: string): SelfCheckSession {
  return {
    id: sessionId,
    status: "idle",
    progress: 0,
    steps: [],
    issues: [],
    auto_fix_available: false,
    updated_at: nowIso(),
    last_error: "",
  }
}

function serializeSession(session: SelfCheckSession): SelfCheckReportResponse {
  return {
    session_id: session.id,
    status: session.status,
    progress: session.progress,
    steps: session.steps.map((item) => ({ ...item, details: { ...item.details } })),
    issues: session.issues.map((item) => ({ ...item, details: { ...item.details } })),
    auto_fix_available: session.auto_fix_available,
    updated_at: session.updated_at,
    last_error: session.last_error,
  }
}

function pruneSessions(sessions: Map<string, SelfCheckSession>): string[] {
  const overflow = sessions.size - MAX_SESSION_CACHE
  if (overflow <= 0) {
    return []
  }
  const removable = [...sessions.values()]
    .filter((item) => item.status === "completed" || item.status === "failed")
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at))
    .slice(0, overflow)
  const removedSessionIds: string[] = []
  removable.forEach((session) => {
    sessions.delete(session.id)
    removedSessionIds.push(session.id)
  })
  return removedSessionIds
}

async function findCommand(command: string): Promise<string> {
  try {
    const probe = process.platform === "win32" ? "where" : "which"
    const { stdout } = await execFileAsync(probe, [command], {
      timeout: 1500,
      windowsHide: true,
    })
    return stdout.trim().split(/\r?\n/, 1)[0]?.trim() || ""
  } catch {
    return ""
  }
}

function buildModelDetails(model: ModelDescriptor): Record<string, string> {
  return {
    模型: model.api_model || model.model_id || model.name,
    提供方: model.provider,
    路径: model.path || model.default_path || "未配置",
    加载策略: model.load_profile || "balanced",
    状态: model.status,
  }
}

function buildVlmProbeCacheKey(baseUrl: string, model: string): string {
  return `${String(baseUrl || "").trim().toLowerCase()}::${String(model || "").trim().toLowerCase()}`
}

function isLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(String(baseUrl || "").trim())
    const hostname = parsed.hostname.trim().toLowerCase()
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "0.0.0.0"
  } catch {
    return false
  }
}

async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null
  const timeoutToken = Symbol("timeout")
  const result = await Promise.race<T | typeof timeoutToken>([
    promise,
    new Promise<typeof timeoutToken>((resolve) => {
      timer = setTimeout(() => resolve(timeoutToken), Math.max(1, timeoutMs))
    }),
  ])
  if (timer) {
    clearTimeout(timer)
  }
  return result === timeoutToken ? null : result
}

function nowIso(): string {
  return new Date().toISOString()
}
