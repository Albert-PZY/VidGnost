import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { TranscriptSegment } from "@vidgnost/contracts"

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

  it("normalizes local faster-whisper segments via runner output", async () => {
    const modelDir = path.join(storageDir, "models", "whisper")
    await mkdir(modelDir, { recursive: true })
    await writeFile(path.join(modelDir, "config.json"), "{\"model_type\":\"whisper\"}\n", "utf8")
    await writeFile(path.join(modelDir, "model.bin"), "fixture-model", "utf8")

    const runnerCalls: Array<{
      audioPath: string
      beamSize: number
      computeType: string
      device: string
      language: string
      modelPath: string
      vadFilter: boolean
    }> = []
    const service = new AsrService(
      {
        storageDir,
        tempDir: path.join(storageDir, "tmp"),
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
            beam_size: 5,
            chunk_seconds: 30,
            compute_type: "float16",
            device: "cuda",
            language: "zh",
            model_default: "small",
            vad_filter: true,
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
          beamSize: number
          computeType: string
          device: string
          language: string
          modelPath: string
          vadFilter: boolean
          signal?: AbortSignal
        }) {
          runnerCalls.push(input)
          return {
            language: "zh",
            segments: [
              { start: 0, end: 2.4, text: "第一 段  , 测试  文本" },
              { start: 2.4, end: 5, text: "第二段!需要  规范化" },
            ],
          }
        },
      } as never,
    )

    const result = await service.transcribe({
      taskId: "task-asr-local",
      audioPath: path.join(storageDir, "fixture.wav"),
    })

    expect(runnerCalls).toHaveLength(1)
    expect(runnerCalls[0]).toMatchObject({
      beamSize: 5,
      computeType: "float16",
      device: "cuda",
      language: "zh",
      modelPath: modelDir,
      vadFilter: true,
    })
    expect(result.language).toBe("zh")
    expect(result.segments).toEqual([
      { start: 0, end: 2.4, text: "第一 段, 测试 文本" },
      { start: 2.4, end: 5, text: "第二段! 需要 规范化" },
    ])
    expect(result.text).toBe("第一 段, 测试 文本\n第二段! 需要 规范化")
  })

  it("streams local faster-whisper segments from a single full-audio pass", async () => {
    const modelDir = path.join(storageDir, "models", "whisper")
    await mkdir(modelDir, { recursive: true })
    await writeFile(path.join(modelDir, "config.json"), "{\"model_type\":\"whisper\"}\n", "utf8")
    await writeFile(path.join(modelDir, "model.bin"), "fixture-model", "utf8")

    const streamedSegments: TranscriptSegment[] = []
    const streamLogs: string[] = []
    const runnerAudioPaths: string[] = []
    const sourceAudioPath = path.join(storageDir, "fixture-full.wav")

    const service = new AsrService(
      {
        storageDir,
        tempDir: path.join(storageDir, "tmp"),
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
            beam_size: 3,
            compute_type: "int8_float16",
            device: "cuda",
            language: "zh",
            model_default: "small",
            chunk_seconds: 180,
            vad_filter: false,
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
          beamSize: number
          computeType: string
          device: string
          language: string
          modelPath: string
          onSegment?: (segment: TranscriptSegment) => Promise<void> | void
          vadFilter: boolean
          signal?: AbortSignal
        }) {
          runnerAudioPaths.push(input.audioPath)
          expect(input.beamSize).toBe(3)
          expect(input.computeType).toBe("int8_float16")
          expect(input.device).toBe("cuda")
          expect(input.modelPath).toBe(modelDir)
          expect(input.vadFilter).toBe(true)
          await input.onSegment?.({ start: 0, end: 1.5, text: "第一段  流式" })
          await input.onSegment?.({ start: 30.3, end: 32, text: "第二段  流式" })
          return {
            language: "zh",
            segments: [
              { start: 0, end: 1.5, text: "第一段  流式" },
              { start: 30.3, end: 32, text: "第二段  流式" },
            ],
          }
        },
      } as never,
    )

    const result = await service.transcribe({
      taskId: "task-asr-chunked",
      audioPath: sourceAudioPath,
      onLog: async (message) => {
        streamLogs.push(message)
      },
      onSegment: async (segment) => {
        streamedSegments.push(segment)
      },
    })

    expect(runnerAudioPaths).toEqual([sourceAudioPath])
    expect(streamLogs).toEqual([
      "Streaming transcription started",
      "Streaming transcription completed",
    ])
    expect(streamedSegments).toEqual([
      { start: 0, end: 1.5, text: "第一段 流式" },
      { start: 30.3, end: 32, text: "第二段 流式" },
    ])
    expect(result.chunks).toEqual([
      {
        index: 0,
        startSeconds: 0,
        durationSeconds: 32,
        segments: [
          { start: 0, end: 1.5, text: "第一段 流式" },
          { start: 30.3, end: 32, text: "第二段 流式" },
        ],
      },
    ])
    expect(result.segments).toEqual(streamedSegments)
    expect(result.text).toBe("第一段 流式\n第二段 流式")
  })

  it("rejects remote transcription payloads with invalid timestamps", async () => {
    const service = new AsrService(
      {
        storageDir,
        tempDir: path.join(storageDir, "tmp"),
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

  it("prefers the remote detected language when openai-compatible ASR returns it", async () => {
    const service = new AsrService(
      {
        storageDir,
        tempDir: path.join(storageDir, "tmp"),
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
            language: "en",
            raw: {
              language: "en",
              text: "remote transcript",
            },
            segments: [
              {
                start: 0,
                end: 1.5,
                text: "remote transcript",
              },
            ],
            text: "remote transcript",
          }
        },
      } as never,
    )

    const result = await service.transcribe({
      taskId: "task-asr-remote-language",
      audioPath: path.join(storageDir, "fixture.wav"),
    })

    expect(result.language).toBe("en")
    expect(result.segments).toEqual([{ start: 0, end: 1.5, text: "remote transcript" }])
  })
})
