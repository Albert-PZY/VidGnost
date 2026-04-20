import { DatabaseSync } from "node:sqlite"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  knowledgeLibraryResponseSchema,
  knowledgeNoteSchema,
  studyPreviewSchema,
  studyStateSchema,
  studyWorkbenchResponseSchema,
} from "@vidgnost/contracts"

import type { AppConfig } from "../src/core/config.js"
import { resolveConfig } from "../src/core/config.js"
import { LlmConfigRepository } from "../src/modules/llm/llm-config-repository.js"
import { OpenAiCompatibleClient } from "../src/modules/llm/openai-compatible-client.js"
import { TaskRepository } from "../src/modules/tasks/task-repository.js"
import { StudyService } from "../src/modules/study/study-service.js"
import { UiSettingsRepository } from "../src/modules/ui/ui-settings-repository.js"

describe("StudyService", () => {
  let config: AppConfig
  let storageDir = ""
  let taskRepository: TaskRepository
  let studyService: StudyService

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-study-service-"))
    config = createTestConfig(storageDir)
    taskRepository = new TaskRepository(config)
    studyService = new StudyService(config, taskRepository, {
      llmClient: new OpenAiCompatibleClient(),
      llmConfigRepository: new LlmConfigRepository(config),
    })
  })

  afterEach(async () => {
    await studyService.close()
    if (storageDir && process.platform !== "win32") {
      await removeDirectoryWithRetry(storageDir)
    }
    storageDir = ""
  })

  it("prefers platform translation tracks for remote study workspaces when ui settings request a target language", async () => {
    await seedTask(taskRepository, {
      id: "task-study-youtube",
      source_input: "https://www.youtube.com/watch?v=study-demo",
      source_type: "youtube",
      title: "Study Youtube Task",
      transcript_segments_json: JSON.stringify([
        { start: 0, end: 8, text: "第一段讲学习目标和观看重点。" },
        { start: 8, end: 18, text: "第二段解释如何整理术语、问题和引用。" },
        { start: 18, end: 32, text: "第三段总结复盘方法与下一步行动。" },
      ]),
      transcript_text: "第一段讲学习目标和观看重点。\n第二段解释如何整理术语、问题和引用。\n第三段总结复盘方法与下一步行动。",
      workflow: "notes",
    })
    await seedSubtitleProbe(taskRepository, "task-study-youtube", {
      subtitles: {
        zh: [{ ext: "vtt", url: "https://cdn.example.com/source-zh.vtt", name: "中文（原始）" }],
      },
      automatic_captions: {
        en: [{ ext: "vtt", url: "https://cdn.example.com/auto-en.vtt", name: "English (auto)" }],
      },
    })
    await new UiSettingsRepository(config).update({
      study_default_translation_target: "en",
    })

    const preview = await studyService.getPreview("task-study-youtube")
    const workspace = await studyService.getWorkspace("task-study-youtube")

    const parsedPreview = studyPreviewSchema.parse(preview)
    const parsedWorkspace = studyWorkbenchResponseSchema.parse(workspace)

    expect(parsedPreview).toMatchObject({
      readiness: "ready",
      generation_tier: "heuristic",
      note_count: 0,
      is_favorite: false,
    })
    expect(parsedPreview.highlight_count).toBeGreaterThan(0)
    expect(parsedWorkspace.task).toMatchObject({
      id: "task-study-youtube",
      workflow: "notes",
      source_type: "youtube",
      language: "zh",
      status: "completed",
    })
    expect(parsedWorkspace.study_pack.task_id).toBe("task-study-youtube")
    expect(parsedWorkspace.study_pack.overview).toContain("学习")
    expect(parsedWorkspace.study_pack.highlights.length).toBeGreaterThan(0)
    expect(parsedWorkspace.study_pack.questions.length).toBeGreaterThan(0)
    expect(parsedWorkspace.study_pack.quotes.length).toBeGreaterThan(0)
    expect(parsedWorkspace.subtitle_tracks.some((track) => track.kind === "source" && track.language === "zh")).toBe(true)
    expect(parsedWorkspace.subtitle_tracks.some((track) => track.kind === "platform_translation" && track.language === "en")).toBe(true)
    expect(parsedWorkspace.subtitle_tracks.some((track) => track.kind === "whisper")).toBe(true)
    expect(parsedWorkspace.translation_records).toEqual([
      expect.objectContaining({
        source: "platform_track",
        status: "ready",
        target: expect.objectContaining({
          language: "en",
        }),
      }),
    ])
    expect(
      (parsedWorkspace.study_state as { last_selected_subtitle_track_id?: string | null }).last_selected_subtitle_track_id,
    ).toBe(parsedWorkspace.translation_records[0]?.subtitle_track_id ?? null)
    expect(parsedWorkspace.export_records).toEqual([])
  })

  it("stores and returns study state updates without mutating task records", async () => {
    await seedTask(taskRepository, {
      id: "task-study-state",
      source_input: "F:/fixtures/study-state.mp4",
      source_type: "local_file",
      title: "Study State Task",
      transcript_segments_json: JSON.stringify([{ start: 0, end: 10, text: "记录当前学习位置。" }]),
      transcript_text: "记录当前学习位置。",
      workflow: "vqa",
    })

    await studyService.getWorkspace("task-study-state")
    const updatedState = studyStateSchema.parse(await studyService.updateStudyState("task-study-state", {
      active_highlight_id: "highlight-1",
      is_favorite: true,
      playback_position_seconds: 24,
      selected_theme_id: "theme-1",
    }))
    const workspace = studyWorkbenchResponseSchema.parse(await studyService.getWorkspace("task-study-state"))
    const storedRecord = await taskRepository.getStoredRecord("task-study-state")

    expect(updatedState.playback_position_seconds).toBe(24)
    expect(updatedState.is_favorite).toBe(true)
    expect(updatedState.selected_theme_id).toBe("theme-1")
    expect(workspace.study_state.active_highlight_id).toBe("highlight-1")
    expect(workspace.study_state.is_favorite).toBe(true)
    expect(storedRecord?.workflow).toBe("vqa")
    expect(storedRecord?.source_type).toBe("local_file")
  })

  it("stores and updates knowledge notes with contracts payloads", async () => {
    await seedTask(taskRepository, {
      id: "task-study-notes",
      source_input: "F:/fixtures/study-notes.mp4",
      source_type: "local_file",
      title: "Study Notes Task",
      transcript_segments_json: JSON.stringify([{ start: 0, end: 10, text: "摘录知识点。" }]),
      transcript_text: "摘录知识点。",
      workflow: "notes",
    })

    const created = knowledgeNoteSchema.parse(await studyService.createKnowledgeNote({
      excerpt: "摘录知识点。",
      note_markdown: "## 知识点\n- 摘录知识点。",
      source_kind: "highlight",
      study_theme_id: "theme-1",
      tags: ["重点", "复习"],
      task_id: "task-study-notes",
      title: "学习重点",
    }))

    const updated = knowledgeNoteSchema.parse(await studyService.updateKnowledgeNote(created.id, {
      note_markdown: "## 知识点\n- 更新后的摘录",
      tags: ["重点", "已整理"],
      title: "学习重点（更新）",
    }))
    const library = knowledgeLibraryResponseSchema.parse(await studyService.listKnowledgeNotes({
      source_kind: "highlight",
      task_id: "task-study-notes",
    }))

    expect(created).toMatchObject({
      task_id: "task-study-notes",
      source_kind: "highlight",
      source_type: "local_file",
      title: "学习重点",
    })
    expect(updated).toMatchObject({
      id: created.id,
      title: "学习重点（更新）",
      tags: ["重点", "已整理"],
    })
    expect(library.total).toBe(1)
    expect(library.items[0]).toMatchObject({
      id: created.id,
      title: "学习重点（更新）",
    })
    expect(library.export_records).toEqual([])
  })

  it("normalizes legacy knowledge notes without persisted source context fields", async () => {
    await seedTask(taskRepository, {
      id: "task-study-legacy-notes",
      source_input: "F:/fixtures/study-legacy-notes.mp4",
      source_type: "local_file",
      title: "Study Legacy Notes Task",
      transcript_segments_json: JSON.stringify([{ start: 0, end: 10, text: "兼容旧知识卡片。" }]),
      transcript_text: "兼容旧知识卡片。",
      workflow: "notes",
    })
    await studyService.getWorkspace("task-study-legacy-notes")

    const studyDatabasePath = path.join(storageDir, "study", "study.sqlite")
    const database = new DatabaseSync(studyDatabasePath)
    database
      .prepare(`
        INSERT INTO knowledge_notes (note_id, task_id, note_json, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        "legacy-note",
        "task-study-legacy-notes",
        JSON.stringify({
          id: "legacy-note",
          task_id: "task-study-legacy-notes",
          study_theme_id: null,
          source_type: "local_file",
          source_kind: "manual",
          title: "历史知识卡片",
          excerpt: "旧数据没有上下文字段。",
          note_markdown: null,
          tags: [],
          created_at: "2026-04-20T08:00:00.000Z",
          updated_at: "2026-04-20T09:00:00.000Z",
        }),
        "2026-04-20T09:00:00.000Z",
      )
    database.close()

    const library = knowledgeLibraryResponseSchema.parse(await studyService.listKnowledgeNotes({
      task_id: "task-study-legacy-notes",
    }))

    expect(library.total).toBe(1)
    expect(library.items[0]).toMatchObject({
      id: "legacy-note",
      source_start_seconds: null,
      source_end_seconds: null,
      source_reference_id: null,
      source_reference_label: null,
    })
  })

  it("refreshes persisted study preview after knowledge note mutations", async () => {
    await seedTask(taskRepository, {
      id: "task-study-preview-refresh",
      source_input: "F:/fixtures/study-preview-refresh.mp4",
      source_type: "local_file",
      title: "Study Preview Refresh Task",
      transcript_segments_json: JSON.stringify([{ start: 0, end: 10, text: "持续学习需要最新预览。" }]),
      transcript_text: "持续学习需要最新预览。",
      workflow: "notes",
    })

    const lastOpenedAt = "2026-04-20T08:00:00.000Z"
    await studyService.updateStudyState("task-study-preview-refresh", {
      is_favorite: true,
      last_opened_at: lastOpenedAt,
    })

    const created = await studyService.createKnowledgeNote({
      excerpt: "持续学习需要最新预览。",
      note_markdown: "## 预览\n- 创建后应刷新",
      source_kind: "manual",
      tags: ["预览"],
      task_id: "task-study-preview-refresh",
      title: "预览刷新",
    })
    await studyService.updateKnowledgeNote(created.id, {
      note_markdown: "## 预览\n- 更新后仍应保持最新",
      title: "预览刷新（更新）",
    })

    const detailAfterCreate = await taskRepository.getDetail("task-study-preview-refresh")
    const previewAfterCreate = studyPreviewSchema.parse(detailAfterCreate?.study_preview)

    expect(previewAfterCreate).toMatchObject({
      note_count: 1,
      is_favorite: true,
      last_opened_at: lastOpenedAt,
    })

    await studyService.deleteKnowledgeNote(created.id)

    const detailAfterDelete = await taskRepository.getDetail("task-study-preview-refresh")
    const previewAfterDelete = studyPreviewSchema.parse(detailAfterDelete?.study_preview)

    expect(previewAfterDelete).toMatchObject({
      note_count: 0,
      is_favorite: true,
      last_opened_at: lastOpenedAt,
    })
  })

  it("returns disabled translation records when no default target language is configured", async () => {
    await seedTask(taskRepository, {
      id: "task-study-disabled-default",
      source_input: "F:/fixtures/study-disabled-default.mp4",
      source_type: "local_file",
      title: "Study Disabled Default Task",
      transcript_segments_json: JSON.stringify([{ start: 0, end: 6, text: "未配置默认目标语言。" }]),
      transcript_text: "未配置默认目标语言。",
      workflow: "notes",
    })

    const workspace = studyWorkbenchResponseSchema.parse(await studyService.getWorkspace("task-study-disabled-default"))

    expect(workspace.subtitle_tracks.some((track) => track.kind === "llm_translation")).toBe(false)
    expect(workspace.translation_records).toEqual([
      expect.objectContaining({
        source: "disabled",
        status: "disabled",
        subtitle_track_id: null,
        target: null,
      }),
    ])
  })

  it("returns disabled translation records instead of faking llm translations when llm is unavailable", async () => {
    await seedTask(taskRepository, {
      id: "task-study-llm-disabled",
      source_input: "F:/fixtures/study-llm-disabled.mp4",
      source_type: "local_file",
      title: "Study Translation Disabled Task",
      transcript_segments_json: JSON.stringify([
        { start: 0, end: 6, text: "第一段介绍学习目标。" },
        { start: 6, end: 14, text: "第二段说明如何整理知识卡片。" },
      ]),
      transcript_text: "第一段介绍学习目标。\n第二段说明如何整理知识卡片。",
      workflow: "notes",
    })
    await new UiSettingsRepository(config).update({
      study_default_translation_target: "en",
    })
    await new LlmConfigRepository(config).save({
      ...(await new LlmConfigRepository(config).get()),
      api_key: "ollama",
      base_url: "http://127.0.0.1:1/v1",
      model: "mock-unavailable-translation",
    })

    const workspace = studyWorkbenchResponseSchema.parse(await studyService.getWorkspace("task-study-llm-disabled"))

    expect(workspace.subtitle_tracks.some((track) => track.kind === "llm_translation")).toBe(false)
    expect(workspace.translation_records).toEqual([
      expect.objectContaining({
        source: "disabled",
        status: "disabled",
        subtitle_track_id: null,
        target: expect.objectContaining({
          language: "en",
        }),
      }),
    ])
  })

  it("generates and caches llm translation tracks when no platform translation is available and llm is reachable", async () => {
    const llmServer = createMockTranslationLlmServer()
    await llmServer.start()
    try {
      await seedTask(taskRepository, {
        id: "task-study-llm-translation",
        source_input: "F:/fixtures/study-llm-translation.mp4",
        source_type: "local_file",
        title: "Study Translation Task",
        transcript_segments_json: JSON.stringify([
          { start: 0, end: 6, text: "第一段介绍学习目标。" },
          { start: 6, end: 14, text: "第二段说明如何整理知识卡片。" },
        ]),
        transcript_text: "第一段介绍学习目标。\n第二段说明如何整理知识卡片。",
        workflow: "notes",
      })
      await new UiSettingsRepository(config).update({
        study_default_translation_target: "en",
      })
      await new LlmConfigRepository(config).save({
        ...(await new LlmConfigRepository(config).get()),
        api_key: "ollama",
        base_url: llmServer.baseUrl,
        model: "mock-translation",
      })

      const firstWorkspace = studyWorkbenchResponseSchema.parse(await studyService.getWorkspace("task-study-llm-translation"))
      const secondWorkspace = studyWorkbenchResponseSchema.parse(await studyService.getWorkspace("task-study-llm-translation"))
      const llmTrack = firstWorkspace.subtitle_tracks.find((track) => track.kind === "llm_translation")

      expect(firstWorkspace.subtitle_tracks.some((track) => track.kind === "source")).toBe(true)
      expect(firstWorkspace.subtitle_tracks.some((track) => track.kind === "whisper")).toBe(true)
      expect(llmTrack).toMatchObject({
        availability: "generated",
        language: "en",
        kind: "llm_translation",
      })
      expect(firstWorkspace.translation_records).toEqual([
        expect.objectContaining({
          source: "llm_generated",
          status: "ready",
          subtitle_track_id: llmTrack?.track_id,
          target: expect.objectContaining({
            language: "en",
          }),
        }),
      ])
      expect(secondWorkspace.subtitle_tracks.find((track) => track.kind === "llm_translation")?.track_id).toBe(llmTrack?.track_id)
      expect(secondWorkspace.translation_records[0]?.subtitle_track_id).toBe(llmTrack?.track_id)
    } finally {
      await llmServer.close()
    }
  })

  it("falls back to disabled translation records when remote llm config is not reachable", async () => {
    await seedTask(taskRepository, {
      id: "task-study-remote-llm-unreachable",
      source_input: "F:/fixtures/study-remote-llm-unreachable.mp4",
      source_type: "local_file",
      title: "Study Remote Translation Disabled Task",
      transcript_segments_json: JSON.stringify([
        { start: 0, end: 6, text: "远程模型不可达时不应挂起。" },
        { start: 6, end: 12, text: "应快速回退到禁用状态。" },
      ]),
      transcript_text: "远程模型不可达时不应挂起。\n应快速回退到禁用状态。",
      workflow: "notes",
    })
    await new UiSettingsRepository(config).update({
      study_default_translation_target: "en",
    })

    const llmConfigRepository = new LlmConfigRepository(config)
    await llmConfigRepository.save({
      ...(await llmConfigRepository.get()),
      api_key: "remote-key",
      base_url: "https://remote-llm.example.invalid/v1",
      model: "remote-translation-model",
    })

    const llmClient = {
      generateText: vi.fn(async () => {
        throw new Error("generateText should not run for unreachable remote LLM")
      }),
      listModels: vi.fn(async () => {
        throw new Error("remote LLM is unreachable")
      }),
    }
    const remoteStudyService = new StudyService(config, taskRepository, {
      llmClient,
      llmConfigRepository,
    })

    try {
      const workspace = studyWorkbenchResponseSchema.parse(
        await remoteStudyService.getWorkspace("task-study-remote-llm-unreachable"),
      )

      expect(llmClient.listModels).toHaveBeenCalledTimes(1)
      expect(llmClient.generateText).not.toHaveBeenCalled()
      expect(workspace.subtitle_tracks.some((track) => track.kind === "llm_translation")).toBe(false)
      expect(workspace.translation_records).toEqual([
        expect.objectContaining({
          source: "disabled",
          status: "disabled",
          subtitle_track_id: null,
          target: expect.objectContaining({
            language: "en",
          }),
        }),
      ])
    } finally {
      await remoteStudyService.close()
    }
  })
})

function createTestConfig(storageDir: string): AppConfig {
  const base = resolveConfig()
  return {
    ...base,
    eventLogDir: path.join(storageDir, "event-logs"),
    runtimeBinDir: path.join(storageDir, "runtime-bin"),
    storageDir,
    tempDir: path.join(storageDir, "tmp"),
    uploadDir: path.join(storageDir, "uploads"),
  }
}

async function seedTask(
  taskRepository: TaskRepository,
  overrides: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString()
  await taskRepository.create({
    id: String(overrides.id || "task-study"),
    source_type: String(overrides.source_type || "local_file"),
    source_input: String(overrides.source_input || ""),
    source_local_path: overrides.source_local_path ? String(overrides.source_local_path) : null,
    workflow: String(overrides.workflow || "notes"),
    title: String(overrides.title || "Study Task"),
    language: "zh",
    model_size: "small",
    status: "completed",
    progress: 100,
    transcript_segments_json: String(overrides.transcript_segments_json || "[]"),
    transcript_text: String(overrides.transcript_text || ""),
    stage_logs_json: JSON.stringify({ A: [], B: [], C: [], D: [] }),
    stage_metrics_json: JSON.stringify({
      A: { status: "completed" },
      B: { status: "completed" },
      C: { status: "completed" },
      D: {
        status: "completed",
        substage_metrics: {
          transcript_optimize: { status: "completed", optional: true },
          subtitle_resolve: { status: "completed", optional: true },
          translation_resolve: { status: "completed", optional: true },
          study_pack_generate: { status: "completed", optional: false },
          notes_mindmap_generate: { status: "completed", optional: false },
          vqa_prewarm: { status: "completed", optional: true },
          fusion_delivery: { status: "completed", optional: false },
        },
      },
    }),
    artifact_index_json: "[]",
    artifact_total_bytes: 0,
    created_at: now,
    updated_at: now,
  })

  const stageStudyDir = path.join(
    taskRepository.resolveArtifactPath(String(overrides.id || "task-study"), "D/study"),
  )
  await writeFile(path.join(stageStudyDir, ".gitkeep"), "", "utf8").catch(() => undefined)
}

async function seedSubtitleProbe(
  taskRepository: TaskRepository,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await taskRepository.writeTaskArtifactText(
    taskId,
    "D/study/subtitle-probe.json",
    JSON.stringify(payload, null, 2),
  )
}

async function removeDirectoryWithRetry(targetPath: string, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (index === attempts - 1) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}

function createMockTranslationLlmServer() {
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({
        data: [{ id: "mock-translation" }],
      }))
      return
    }

    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: { message: "not found" } }))
      return
    }

    const chunks: Buffer[] = []
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages?: Array<{ content?: string }>
      }
      const prompt = String(payload.messages?.at(-1)?.content || "")
      const match = prompt.match(/SEGMENTS_JSON:\s*(\[[\s\S]*\])\s*$/)
      const segments = match ? (JSON.parse(match[1]) as Array<{ id: string; text: string }>) : []
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                segments.map((segment) => ({
                  id: segment.id,
                  translated_text: `EN:${segment.text}`,
                })),
              ),
            },
          },
        ],
      }))
    })
  })

  return {
    get baseUrl() {
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
    async start() {
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve())
      })
    },
  }
}
