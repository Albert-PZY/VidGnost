import path from "node:path"
import { readFile } from "node:fs/promises"

import { ensureDirectory } from "../../core/fs.js"
import { runCommand } from "../../core/process.js"

export interface WhisperCliRunResult {
  outputBase: string
  rawSrt: string
  srtPath: string
}

export class WhisperCliRunner {
  async run(input: {
    audioPath: string
    executablePath: string
    language: string
    modelPath: string
    outputDir: string
    signal?: AbortSignal
  }): Promise<WhisperCliRunResult> {
    await ensureDirectory(input.outputDir)
    const outputBase = path.join(input.outputDir, "transcript")
    await runCommand({
      command: input.executablePath,
      args: [
        "-m",
        input.modelPath,
        "-f",
        input.audioPath,
        "-l",
        input.language,
        "-osrt",
        "-of",
        outputBase,
      ],
      signal: input.signal,
    })

    const srtPath = `${outputBase}.srt`
    return {
      outputBase,
      rawSrt: await readFile(srtPath, "utf8").catch(() => ""),
      srtPath,
    }
  }
}
