import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { AsrSentence } from "./dashscope.js"
import { AppError } from "../core/errors.js"
import { findCommand } from "../core/process.js"

export interface LocalAsrInput {
  audioPath: string
  computeType: string
  device: "auto" | "cpu" | "cuda"
  language?: string
  modelDir: string
  onSegment?: (segment: { start: number; end: number; text: string }) => void
  onStatus?: (message: string) => void
  pythonExecutable: string
  signal?: AbortSignal
}

export interface LocalAsrResult {
  language: string
  sentences: AsrSentence[]
  detail: string
}

interface WorkerLine {
  request_id?: string
  type?: string
  start?: number
  end?: number
  text?: string
  language?: string
  device?: string
  compute_type?: string
  error?: string
}

const WORKER_SCRIPT = fileURLToPath(new URL("../../python/transcribe_faster_whisper.py", import.meta.url))

/**
 * 本地 `faster-whisper` 兜底转写。
 * 走一次性子进程（非长驻 worker），避免跨任务状态残留；模型加载成本由 CTranslate2 磁盘缓存吸收。
 */
export class LocalWhisperProvider {
  async transcribe(input: LocalAsrInput): Promise<LocalAsrResult> {
    const python = await findCommand([input.pythonExecutable, "python", "python3", "py"])
    if (!python) {
      throw AppError.unavailable("未找到 Python 可执行文件，无法运行本地 Whisper。", {
        code: "WHISPER_PYTHON_MISSING",
        hint: "请安装 Python 3.10+，或通过环境变量 VIDGNOST_WHISPER_PYTHON 指定绝对路径。",
      })
    }

    const modelPath = resolveModelPath(input.modelDir)
    const scriptArgs = [WORKER_SCRIPT, "--worker"]
    input.onStatus?.(`启动本地 Whisper（${path.basename(modelPath)} / ${input.device} / ${input.computeType}）`)

    const child = spawn(python, scriptArgs, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    })

    const sentences: AsrSentence[] = []
    let language = input.language || "zh"
    let device = "cpu"
    let computeType = input.computeType
    let workerError: string | null = null

    const rl = createInterface({ input: child.stdout })
    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith("{")) {
        return
      }
      let payload: WorkerLine
      try {
        payload = JSON.parse(trimmed) as WorkerLine
      } catch {
        return
      }
      if (payload.type === "segment") {
        const start = Number(payload.start || 0)
        const end = Number(payload.end || 0)
        const text = String(payload.text || "").trim()
        if (!text) {
          return
        }
        sentences.push({
          beginTimeMs: Math.round(start * 1000),
          endTimeMs: Math.round(end * 1000),
          text,
        })
        input.onSegment?.({ start, end, text })
        return
      }
      if (payload.type === "completed") {
        language = String(payload.language || language)
        device = String(payload.device || device)
        computeType = String(payload.compute_type || computeType)
        return
      }
      if (payload.type === "error") {
        workerError = String(payload.error || "本地 Whisper 运行失败")
      }
    }

    rl.on("line", handleLine)

    const stderrChunks: string[] = []
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      if (stderrChunks.length < 40) {
        stderrChunks.push(chunk)
      }
    })

    const abortHandler = () => child.kill("SIGTERM")
    input.signal?.addEventListener("abort", abortHandler, { once: true })

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject)
      child.on("close", (code) => resolve(code))
      child.stdin.write(
        `${JSON.stringify({
          request_id: "local",
          type: "transcribe",
          audio_path: input.audioPath,
          model_path: modelPath,
          device: input.device,
          compute_type: input.computeType,
          language: input.language && input.language !== "auto" ? input.language : "",
          vad_filter: true,
          beam_size: 5,
        })}\n`,
      )
      child.stdin.end()
    }).catch((error: unknown) => {
      throw AppError.unavailable(`本地 Whisper 启动失败：${error instanceof Error ? error.message : error}`, {
        code: "WHISPER_SPAWN_FAILED",
      })
    }).finally(() => {
      input.signal?.removeEventListener("abort", abortHandler)
      rl.close()
    })

    if (input.signal?.aborted) {
      throw AppError.conflict("任务已取消。", { code: "TASK_CANCELED" })
    }
    if (workerError) {
      throw AppError.unavailable(`本地 Whisper 失败：${workerError}`, { code: "WHISPER_FAILED" })
    }
    if (exitCode !== 0 && sentences.length === 0) {
      throw AppError.unavailable(
        `本地 Whisper 退出码 ${exitCode}。${stderrChunks.join("").slice(0, 400)}`,
        {
          code: "WHISPER_EXIT_NONZERO",
          hint: "若提示缺少 faster-whisper，请在 apps/api/python 目录执行 `uv sync` 准备隔离环境。",
        },
      )
    }

    return {
      language,
      sentences,
      detail: `faster-whisper · ${path.basename(modelPath)} · ${device}/${computeType}`,
    }
  }
}

function resolveModelPath(modelDir: string): string {
  const value = String(modelDir || "").trim()
  if (!value) {
    throw AppError.conflict("未配置本地 Whisper 模型目录。", {
      code: "WHISPER_MODEL_DIR_MISSING",
      hint: "请在设置页填写 CTranslate2 模型目录，或在 .env 中设置 VIDGNOST_WHISPER_MODEL_DIR。",
    })
  }
  return path.resolve(value)
}
