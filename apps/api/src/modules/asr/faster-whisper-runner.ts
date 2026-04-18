import path from "node:path"

import type { TranscriptSegment } from "@vidgnost/contracts"

import { pathExists } from "../../core/fs.js"
import { runCommand } from "../../core/process.js"
import type { AppConfig } from "../../core/config.js"
import {
  buildWhisperLibraryPaths,
  resolveWhisperPythonExecutable,
  resolveWhisperWorkerScriptPath,
} from "./whisper-runtime-paths.js"
import {
  PersistentFasterWhisperWorkerBridge,
  type FasterWhisperWorkerBridge,
  type FasterWhisperWorkerRuntime,
} from "./faster-whisper-worker-bridge.js"

export interface FasterWhisperRunResult {
  computeType: string
  device: string
  language: string
  segments: TranscriptSegment[]
  text: string
}

interface FasterWhisperRunnerDependencies {
  createBridge?: (runtime: FasterWhisperWorkerRuntime) => FasterWhisperWorkerBridge
  resolveRuntime?: (
    runtimeConfig: {
      runtimeBinDir: string
      whisperPythonExecutable: string
    },
  ) => Promise<FasterWhisperWorkerRuntime>
}

export class FasterWhisperRunner {
  readonly #bridgeCache = new Map<string, FasterWhisperWorkerBridge>()
  readonly #createBridge: (runtime: FasterWhisperWorkerRuntime) => FasterWhisperWorkerBridge
  readonly #resolveRuntimeImpl: (
    runtimeConfig: {
      runtimeBinDir: string
      whisperPythonExecutable: string
    },
  ) => Promise<FasterWhisperWorkerRuntime>

  constructor(
    private readonly runtimeConfig: {
      runtimeBinDir: string
      whisperPythonExecutable: string
    },
    dependencies: FasterWhisperRunnerDependencies = {},
  ) {
    this.#createBridge = dependencies.createBridge || ((runtime) => new PersistentFasterWhisperWorkerBridge(runtime))
    this.#resolveRuntimeImpl = dependencies.resolveRuntime || resolveRuntime
  }

  async run(input: {
    audioPath: string
    beamSize: number
    computeType: string
    device: string
    language: string
    modelPath: string
    onSegment?: (segment: TranscriptSegment) => Promise<void> | void
    outputDir: string
    signal?: AbortSignal
    vadFilter: boolean
  }): Promise<FasterWhisperRunResult> {
    const runtime = await this.#resolveRuntimeImpl(this.runtimeConfig)
    const bridge = this.#getBridge(runtime)
    return bridge.transcribe({
      audioPath: input.audioPath,
      beamSize: input.beamSize,
      computeType: input.computeType,
      device: input.device,
      language: input.language,
      modelPath: input.modelPath,
      onSegment: input.onSegment,
      signal: input.signal,
      vadFilter: input.vadFilter,
    })
  }

  async probe(): Promise<{
    details: Record<string, string>
    ready: boolean
  }> {
    const pythonExecutable = await resolveWhisperPythonExecutable(this.runtimeConfig)
    if (!pythonExecutable) {
      return {
        ready: false,
        details: {
          python: "missing",
        },
      }
    }

    const scriptPath = resolveWhisperWorkerScriptPath()
    if (!(await pathExists(scriptPath))) {
      return {
        ready: false,
        details: {
          python: pythonExecutable,
          worker: "missing",
        },
      }
    }

    const libraryPaths = await buildWhisperLibraryPaths()
    try {
      const { stdout } = await runCommand({
        command: pythonExecutable,
        args: [scriptPath, "--probe"],
        env: buildWhisperRuntimeEnv(libraryPaths),
      })
      const parsed = JSON.parse(stdout || "{}") as {
        ctranslate2?: string
        faster_whisper?: string
        python?: string
        ready?: boolean
      }
      return {
        ready: Boolean(parsed.ready),
        details: {
          python: String(parsed.python || pythonExecutable),
          faster_whisper: String(parsed.faster_whisper || "missing"),
          ctranslate2: String(parsed.ctranslate2 || "missing"),
          libraries: libraryPaths.join(path.delimiter) || "none",
        },
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        ready: false,
        details: {
          python: pythonExecutable,
          probe_error: detail,
          libraries: libraryPaths.join(path.delimiter) || "none",
        },
      }
    }
  }

  async shutdown(): Promise<void> {
    const bridges = [...this.#bridgeCache.values()]
    this.#bridgeCache.clear()
    await Promise.all(bridges.map((bridge) => bridge.shutdown()))
  }

  #getBridge(runtime: FasterWhisperWorkerRuntime): FasterWhisperWorkerBridge {
    const cacheKey = [
      runtime.pythonExecutable,
      runtime.scriptPath,
      runtime.libraryPaths.join(path.delimiter),
    ].join("|")
    const existing = this.#bridgeCache.get(cacheKey)
    if (existing) {
      return existing
    }

    const bridge = this.#createBridge(runtime)
    this.#bridgeCache.set(cacheKey, bridge)
    return bridge
  }
}

async function resolveRuntime(
  runtimeConfig: {
    runtimeBinDir: string
    whisperPythonExecutable: string
  },
): Promise<FasterWhisperWorkerRuntime> {
  const pythonExecutable = await resolveWhisperPythonExecutable(runtimeConfig)
  if (!pythonExecutable) {
    throw new Error("未检测到可用的 Python 运行时。")
  }

  const scriptPath = resolveWhisperWorkerScriptPath()
  if (!(await pathExists(scriptPath))) {
    throw new Error(`缺少 faster-whisper worker 脚本: ${scriptPath}`)
  }

  return {
    libraryPaths: await buildWhisperLibraryPaths(),
    pythonExecutable,
    scriptPath,
  }
}

function buildWhisperRuntimeEnv(libraryPaths: string[]): NodeJS.ProcessEnv {
  const pathParts = [
    ...libraryPaths,
    ...(String(process.env.PATH || "").split(path.delimiter).filter(Boolean)),
  ]
  return {
    ...process.env,
    PATH: pathParts.join(path.delimiter),
    PYTHONIOENCODING: "utf-8",
  }
}
