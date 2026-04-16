import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { AsrService } from "../src/modules/asr/asr-service.js"

describe("AsrService", () => {
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-asr-"))
  })

  afterAll(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it("normalizes local whisper srt output via runner and segment parser", async () => {
    const modelDir = path.join(storageDir, "models", "whisper")
    const executablePath = path.join(storageDir, "bin", "whisper-cli.exe")
    await mkdir(modelDir, { recursive: true })
    await mkdir(path.dirname(executablePath), { recursive: true })
    await writeFile(path.join(modelDir, "ggml-small.bin"), "fixture-model", "utf8")
    await writeFile(executablePath, "fixture-executable", "utf8")

    const runnerCalls: Array<{ executablePath: string; modelPath: string }> = []
    const service = new AsrService(
      {
        storageDir,
        tempDir: path.join(storageDir, "tmp"),
        whisperExecutable: executablePath,
      } as never,
      {
        async listModels() {
          return {
            items: [
              {
                id: "whisper-default",
                provider: "local",
                path: modelDir,
                api_base_url: "",
                api_key: "",
                api_model: "",
                api_timeout_seconds: 60,
              },
            ],
          }
        },
      } as never,
      {
        async get() {
          return {
            language: "zh",
            model_default: "small",
          }
        },
      } as never,
      {
        async transcribeAudio() {
          throw new Error("remote path should not be used")
        },
      } as never,
      {
        async run(input: {
          audioPath: string
          executablePath: string
          language: string
          modelPath: string
          outputDir: string
          signal?: AbortSignal
        }) {
          runnerCalls.push({
            executablePath: input.executablePath,
            modelPath: input.modelPath,
          })
          return {
            rawSrt: [
              "1",
              "00:00:00,000 --> 00:00:02,400",
              "第一 段  , 测试  文本",
              "",
              "2",
              "00:00:02,400 --> 00:00:05,000",
              "第二段!需要  规范化",
              "",
            ].join("\n"),
          }
        },
      } as never,
    )

    const result = await service.transcribe({
      taskId: "task-asr-local",
      audioPath: path.join(storageDir, "fixture.wav"),
    })

    expect(runnerCalls).toHaveLength(1)
    expect(result.language).toBe("zh")
    expect(result.segments).toEqual([
      { start: 0, end: 2.4, text: "第一 段, 测试 文本" },
      { start: 2.4, end: 5, text: "第二段! 需要 规范化" },
    ])
    expect(result.text).toBe("第一 段, 测试 文本\n第二段! 需要 规范化")
  })

  it("rejects remote transcription payloads with invalid timestamps", async () => {
    const service = new AsrService(
      {
        storageDir,
        tempDir: path.join(storageDir, "tmp"),
        whisperExecutable: "whisper-cli.exe",
      } as never,
      {
        async listModels() {
          return {
            items: [
              {
                id: "whisper-default",
                provider: "openai_compatible",
                path: "",
                api_base_url: "https://example.com/v1",
                api_key: "secret",
                api_model: "remote-asr",
                api_timeout_seconds: 60,
              },
            ],
          }
        },
      } as never,
      {
        async get() {
          return {
            language: "zh",
            model_default: "small",
          }
        },
      } as never,
      {
        async transcribeAudio() {
          return {
            language: "zh",
            raw: {
              text: "时间戳异常",
            },
            segments: [
              {
                start: 8,
                end: 3,
                text: "时间戳异常",
              },
            ],
            text: "时间戳异常",
          }
        },
      } as never,
    )

    await expect(
      service.transcribe({
        taskId: "task-asr-remote-invalid",
        audioPath: path.join(storageDir, "fixture.wav"),
      }),
    ).rejects.toMatchObject({
      code: "ASR_REMOTE_TIMESTAMPS_INVALID",
    })
  })

  it("rejects remote transcription payloads that contain text but no usable segments", async () => {
    const service = new AsrService(
      {
        storageDir,
        tempDir: path.join(storageDir, "tmp"),
        whisperExecutable: "whisper-cli.exe",
      } as never,
      {
        async listModels() {
          return {
            items: [
              {
                id: "whisper-default",
                provider: "openai_compatible",
                path: "",
                api_base_url: "https://example.com/v1",
                api_key: "secret",
                api_model: "remote-asr",
                api_timeout_seconds: 60,
              },
            ],
          }
        },
      } as never,
      {
        async get() {
          return {
            language: "zh",
            model_default: "small",
          }
        },
      } as never,
      {
        async transcribeAudio() {
          return {
            language: "zh",
            raw: {
              text: "只有全文，没有 segments",
            },
            segments: [],
            text: "只有全文，没有 segments",
          }
        },
      } as never,
    )

    await expect(
      service.transcribe({
        taskId: "task-asr-remote-empty",
        audioPath: path.join(storageDir, "fixture.wav"),
      }),
    ).rejects.toMatchObject({
      code: "ASR_REMOTE_SEGMENTS_EMPTY",
    })
  })
})
