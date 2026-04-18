import path from "node:path"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface, type Interface as ReadLineInterface } from "node:readline"

import type { TranscriptSegment } from "@vidgnost/contracts"

import type { FasterWhisperRunResult } from "./faster-whisper-runner.js"

export interface FasterWhisperWorkerRuntime {
  libraryPaths: string[]
  pythonExecutable: string
  scriptPath: string
}

export interface FasterWhisperWorkerTranscribeInput {
  audioPath: string
  beamSize: number
  computeType: string
  device: string
  language: string
  modelPath: string
  onSegment?: (segment: TranscriptSegment) => Promise<void> | void
  signal?: AbortSignal
  vadFilter: boolean
}

interface WorkerRequest {
  input: FasterWhisperWorkerTranscribeInput
  reject: (error: Error) => void
  requestId: string
  resolve: (result: FasterWhisperRunResult) => void
}

interface WorkerResponsePayload {
  compute_type?: string
  device?: string
  error?: string
  language?: string
  request_id?: string
  start?: number
  end?: number
  text?: string
  type?: string
}

type ActiveRequest = WorkerRequest & {
  abortError: Error | null
  abortHandler?: () => void
  segments: TranscriptSegment[]
  stderr: string[]
}

export interface FasterWhisperWorkerBridge {
  shutdown(): Promise<void>
  transcribe(input: FasterWhisperWorkerTranscribeInput): Promise<FasterWhisperRunResult>
}

export class PersistentFasterWhisperWorkerBridge implements FasterWhisperWorkerBridge {
  readonly #runtime: FasterWhisperWorkerRuntime

  #activeRequest: ActiveRequest | null = null
  #child: ChildProcessWithoutNullStreams | null = null
  #pendingRequests: WorkerRequest[] = []
  #requestSequence = 0
  #stdoutInterface: ReadLineInterface | null = null
  #stopping = false

  constructor(runtime: FasterWhisperWorkerRuntime) {
    this.#runtime = runtime
  }

  async transcribe(input: FasterWhisperWorkerTranscribeInput): Promise<FasterWhisperRunResult> {
    if (this.#stopping) {
      throw new Error("faster-whisper worker bridge shutdown")
    }

    return new Promise<FasterWhisperRunResult>((resolve, reject) => {
      this.#pendingRequests.push({
        input,
        reject,
        requestId: `fw-${Date.now()}-${++this.#requestSequence}`,
        resolve,
      })
      void this.#processQueue()
    })
  }

  async shutdown(): Promise<void> {
    this.#stopping = true
    const pendingRequests = this.#pendingRequests.splice(0)
    for (const pending of pendingRequests) {
      pending.reject(new Error("faster-whisper worker bridge shutdown"))
    }

    const activeRequest = this.#takeActiveRequest()
    if (activeRequest) {
      activeRequest.reject(new Error("faster-whisper worker bridge shutdown"))
    }

    this.#terminateProcess()
  }

  async #processQueue(): Promise<void> {
    if (this.#activeRequest || this.#stopping) {
      return
    }

    const nextRequest = this.#pendingRequests.shift()
    if (!nextRequest) {
      return
    }

    if (nextRequest.input.signal?.aborted) {
      nextRequest.reject(new Error("transcription aborted"))
      await this.#processQueue()
      return
    }

    const child = this.#ensureProcess()
    const activeRequest: ActiveRequest = {
      ...nextRequest,
      abortError: null,
      segments: [],
      stderr: [],
    }
    this.#activeRequest = activeRequest

    if (activeRequest.input.signal) {
      activeRequest.abortHandler = () => {
        activeRequest.abortError = new Error("transcription aborted")
        this.#terminateProcess()
      }
      activeRequest.input.signal.addEventListener("abort", activeRequest.abortHandler, { once: true })
    }

    child.stdin.write(`${JSON.stringify({
      request_id: activeRequest.requestId,
      type: "transcribe",
      audio_path: activeRequest.input.audioPath,
      beam_size: activeRequest.input.beamSize,
      compute_type: activeRequest.input.computeType,
      device: activeRequest.input.device,
      language: activeRequest.input.language,
      model_path: activeRequest.input.modelPath,
      vad_filter: activeRequest.input.vadFilter,
    })}\n`)
  }

  #ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.#child) {
      return this.#child
    }

    const child = spawn(this.#runtime.pythonExecutable, [this.#runtime.scriptPath, "--worker"], {
      env: buildWorkerEnv(this.#runtime.libraryPaths),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      if (this.#activeRequest) {
        this.#activeRequest.stderr.push(chunk)
      }
    })
    child.on("error", (error) => {
      const activeRequest = this.#takeActiveRequest()
      if (activeRequest) {
        activeRequest.reject(error instanceof Error ? error : new Error(String(error)))
      }
      this.#clearProcessReferences()
      if (!this.#stopping && this.#pendingRequests.length > 0) {
        void this.#processQueue()
      }
    })
    child.on("close", () => {
      const activeRequest = this.#takeActiveRequest()
      this.#clearProcessReferences()
      if (activeRequest) {
        const detail = activeRequest.stderr.join("").trim()
        activeRequest.reject(activeRequest.abortError || new Error(detail || "faster-whisper worker exited unexpectedly"))
      }
      if (!this.#stopping && this.#pendingRequests.length > 0) {
        void this.#processQueue()
      }
    })

    const stdoutInterface = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })
    stdoutInterface.on("line", (line) => {
      void this.#handleStdoutLine(line).catch((error: unknown) => {
        const activeRequest = this.#takeActiveRequest()
        if (activeRequest) {
          activeRequest.reject(error instanceof Error ? error : new Error(String(error)))
        }
        this.#terminateProcess()
      })
    })

    this.#child = child
    this.#stdoutInterface = stdoutInterface
    return child
  }

  async #handleStdoutLine(line: string): Promise<void> {
    const trimmed = String(line || "").trim()
    if (!trimmed) {
      return
    }

    let payload: WorkerResponsePayload
    try {
      payload = JSON.parse(trimmed) as WorkerResponsePayload
    } catch {
      throw new Error(`Invalid faster-whisper worker payload: ${trimmed}`)
    }

    const activeRequest = this.#activeRequest
    if (!activeRequest || payload.request_id !== activeRequest.requestId) {
      return
    }

    if (payload.type === "segment") {
      const segment = {
        start: Number(payload.start) || 0,
        end: Number(payload.end) || 0,
        text: String(payload.text || ""),
      }
      activeRequest.segments.push(segment)
      await activeRequest.input.onSegment?.(segment)
      return
    }

    if (payload.type === "error") {
      const failedRequest = this.#takeActiveRequest()
      failedRequest?.reject(new Error(String(payload.error || "faster-whisper worker error")))
      await this.#processQueue()
      return
    }

    if (payload.type === "completed") {
      const completedRequest = this.#takeActiveRequest()
      if (!completedRequest) {
        return
      }
      completedRequest.resolve({
        computeType: String(payload.compute_type || completedRequest.input.computeType),
        device: String(payload.device || completedRequest.input.device),
        language: String(payload.language || completedRequest.input.language),
        segments: completedRequest.segments,
        text: String(payload.text || completedRequest.segments.map((segment) => segment.text).join("\n")),
      })
      await this.#processQueue()
    }
  }

  #takeActiveRequest(): ActiveRequest | null {
    const activeRequest = this.#activeRequest
    if (!activeRequest) {
      return null
    }
    this.#activeRequest = null
    this.#cleanupAbortHandler(activeRequest)
    return activeRequest
  }

  #cleanupAbortHandler(activeRequest: ActiveRequest): void {
    if (activeRequest.input.signal && activeRequest.abortHandler) {
      activeRequest.input.signal.removeEventListener("abort", activeRequest.abortHandler)
    }
  }

  #terminateProcess(): void {
    const child = this.#clearProcessReferences()
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM")
    }
  }

  #clearProcessReferences(): ChildProcessWithoutNullStreams | null {
    this.#stdoutInterface?.close()
    this.#stdoutInterface = null
    const child = this.#child
    this.#child = null
    return child
  }
}

function buildWorkerEnv(libraryPaths: string[]): NodeJS.ProcessEnv {
  const pathEntries = [
    ...libraryPaths,
    ...String(process.env.PATH || "").split(path.delimiter).filter(Boolean),
  ]
  return {
    ...process.env,
    PATH: pathEntries.join(path.delimiter),
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
  }
}
