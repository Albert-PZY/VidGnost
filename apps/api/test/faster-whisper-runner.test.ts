import { describe, expect, it } from "vitest"

import type { TranscriptSegment } from "@vidgnost/contracts"

import { FasterWhisperRunner } from "../src/modules/asr/faster-whisper-runner.js"

describe("FasterWhisperRunner", () => {
  it("reuses a persistent worker bridge across sequential transcriptions and streams segments", async () => {
    const createdBridgeIds: string[] = []
    const streamedSegments: TranscriptSegment[] = []

    const runner = new FasterWhisperRunner(
      {
        runtimeBinDir: "runtime",
        whisperPythonExecutable: "python",
      },
      {
        async resolveRuntime() {
          return {
            libraryPaths: ["C:/runtime/lib"],
            pythonExecutable: "python.exe",
            scriptPath: "worker.py",
          }
        },
        createBridge(input) {
          createdBridgeIds.push(`${input.pythonExecutable}:${input.scriptPath}:${input.libraryPaths.join(";")}`)
          return {
            async shutdown() {
              return
            },
            async transcribe(request) {
              await request.onSegment?.({ start: 0, end: 1.5, text: "第一段 原始" })
              await request.onSegment?.({ start: 1.5, end: 3.2, text: "第二段 原始" })
              return {
                computeType: request.computeType,
                device: request.device,
                language: request.language,
                segments: [
                  { start: 0, end: 1.5, text: "第一段 原始" },
                  { start: 1.5, end: 3.2, text: "第二段 原始" },
                ],
                text: "第一段 原始\n第二段 原始",
              }
            },
          }
        },
      },
    )

    const firstResult = await runner.run({
      audioPath: "first.wav",
      beamSize: 5,
      computeType: "float16",
      device: "cuda",
      language: "zh",
      modelPath: "G:/Ollama_Model/whisper/faster-whisper-small",
      onSegment: async (segment) => {
        streamedSegments.push(segment)
      },
      outputDir: "out-1",
      vadFilter: true,
    })

    const secondResult = await runner.run({
      audioPath: "second.wav",
      beamSize: 5,
      computeType: "float16",
      device: "cuda",
      language: "zh",
      modelPath: "G:/Ollama_Model/whisper/faster-whisper-small",
      outputDir: "out-2",
      vadFilter: true,
    })

    expect(createdBridgeIds).toEqual([
      "python.exe:worker.py:C:/runtime/lib",
    ])
    expect(streamedSegments).toEqual([
      { start: 0, end: 1.5, text: "第一段 原始" },
      { start: 1.5, end: 3.2, text: "第二段 原始" },
    ])
    expect(firstResult.text).toBe("第一段 原始\n第二段 原始")
    expect(secondResult.segments).toEqual([
      { start: 0, end: 1.5, text: "第一段 原始" },
      { start: 1.5, end: 3.2, text: "第二段 原始" },
    ])
  })
})
