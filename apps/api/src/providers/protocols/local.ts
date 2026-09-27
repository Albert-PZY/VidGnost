import type { AppSettings, ModelKind } from "@vidgnost/contracts"

import { AppError } from "../../core/errors.js"
import { LocalWhisperProvider } from "../local-whisper.js"
import type { AsrResult, ProtocolAdapter, TranscribeInput } from "./types.js"

/**
 * 本地运行时协议。
 *
 * 只提供离线转写，参数来自设置里的 whisper 段；其余能力不实现，
 * 由网关统一报「该协议不支持」。
 */
export class LocalAdapter implements ProtocolAdapter {
  readonly protocol = "local" as const
  readonly kinds: ModelKind[] = ["asr"]
  readonly streaming = false

  constructor(
    private readonly whisper: LocalWhisperProvider,
    private readonly readSettings: () => Promise<AppSettings>,
  ) {}

  async transcribe(input: TranscribeInput): Promise<AsrResult> {
    const settings = await this.readSettings()
    if (!settings.whisper.modelDir) {
      throw AppError.unavailable("本地 Whisper 模型目录未配置。", {
        code: "PROVIDER_KEY_MISSING",
        hint: "在「模型 → 本地模型」里填写 CTranslate2 模型目录。",
      })
    }
    const result = await this.whisper.transcribe({
      audioPath: input.filePath,
      computeType: settings.whisper.computeType,
      device: settings.whisper.device,
      language: input.language,
      modelDir: settings.whisper.modelDir,
      pythonExecutable: settings.whisper.pythonExecutable,
      signal: input.signal,
    })
    return {
      language: result.language,
      sentences: result.sentences,
      durationMs: result.sentences.reduce((max, sentence) => Math.max(max, sentence.endTimeMs), 0),
      provider: "local",
    }
  }
}
