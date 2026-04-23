import os from "node:os"
import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import {
  knowledgeLibraryResponseSchema,
  knowledgeNoteSchema,
  studyPreviewSchema,
  studyStateSchema,
  studyWorkbenchResponseSchema,
} from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("study routes", () => {
  let app: FastifyInstance
  let storageDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-study-"))
    await seedStudyFixtures(storageDir)
    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
    })
  })

  afterAll(async () => {
    await app.close()
    if (storageDir) {
      await removeDirectoryWithRetry(storageDir)
    }
  })

  it("returns study preview and workspace payloads for completed tasks", async () => {
    const [previewResponse, workspaceResponse, subtitlesResponse] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/tasks/task-study-route/study-preview",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/task-study-route/study-pack",
      }),
      app.inject({
        method: "GET",
        url: "/api/tasks/task-study-route/subtitle-tracks",
      }),
    ])

    expect(previewResponse.statusCode).toBe(200)
    expect(workspaceResponse.statusCode).toBe(200)
    expect(subtitlesResponse.statusCode).toBe(200)

    const preview = studyPreviewSchema.parse(previewResponse.json())
    const workspace = studyWorkbenchResponseSchema.parse(workspaceResponse.json())
    const subtitles = workspace.subtitle_tracks
    expect(subtitlesResponse.json()).toEqual(subtitles)

    expect(preview).toMatchObject({
      readiness: "ready",
      generation_tier: "heuristic",
      note_count: 0,
      is_favorite: false,
    })
    expect(workspace.task).toMatchObject({
      id: "task-study-route",
      source_type: "youtube",
      workflow: "notes",
    })
    expect(workspace.study_pack.overview).toContain("学习")
    expect(workspace.study_pack.highlights.length).toBeGreaterThan(0)
    expect(workspace.study_pack.questions.length).toBeGreaterThan(0)
    expect(workspace.study_state.playback_position_seconds).toBe(0)
    expect(subtitles.some((track) => track.kind === "source" && track.language === "zh")).toBe(true)
    expect(subtitles.some((track) => track.kind === "platform_translation" && track.language === "en")).toBe(true)
    expect(subtitles.some((track) => track.kind === "whisper" && track.language === "zh")).toBe(true)
  })

  it("updates study state and reflects the next workspace read", async () => {
    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/api/tasks/task-study-route/study-state",
      payload: {
        active_highlight_id: "highlight-1",
        last_position_seconds: 42,
        last_selected_subtitle_track_id: "track-whisper-primary",
        selected_theme_id: "theme-1",
      },
    })

    expect(patchResponse.statusCode).toBe(200)
    const updatedState = studyStateSchema.parse(patchResponse.json())
    expect(updatedState).toMatchObject({
      active_highlight_id: "highlight-1",
      playback_position_seconds: 42,
      selected_theme_id: "theme-1",
    })
    expect((updatedState as { last_selected_subtitle_track_id?: string | null }).last_selected_subtitle_track_id).toBe(
      "track-whisper-primary",
    )

    const workspaceResponse = await app.inject({
      method: "GET",
      url: "/api/tasks/task-study-route/study-pack",
    })
    expect(workspaceResponse.statusCode).toBe(200)
    expect(studyWorkbenchResponseSchema.parse(workspaceResponse.json())).toMatchObject({
      study_state: {
        active_highlight_id: "highlight-1",
        last_selected_subtitle_track_id: "track-whisper-primary",
        playback_position_seconds: 42,
        selected_theme_id: "theme-1",
      },
    })
  })

  it("switches subtitle tracks and persists the selected track in study state", async () => {
    const workspaceResponse = await app.inject({
      method: "GET",
      url: "/api/tasks/task-study-route/study-pack",
    })
    const workspace = studyWorkbenchResponseSchema.parse(workspaceResponse.json())
    const whisperTrack = workspace.subtitle_tracks.find((track) => track.kind === "whisper")
    expect(whisperTrack).toBeTruthy()

    const switchResponse = await app.inject({
      method: "POST",
      url: "/api/tasks/task-study-route/subtitle-switch",
      payload: {
        track_id: whisperTrack?.track_id,
      },
    })

    expect(switchResponse.statusCode).toBe(200)
    expect((switchResponse.json() as { last_selected_subtitle_track_id?: string | null }).last_selected_subtitle_track_id).toBe(
      whisperTrack?.track_id,
    )

    const nextWorkspaceResponse = await app.inject({
      method: "GET",
      url: "/api/tasks/task-study-route/study-pack",
    })
    const nextWorkspace = studyWorkbenchResponseSchema.parse(nextWorkspaceResponse.json())
    expect(
      (nextWorkspace.study_state as { last_selected_subtitle_track_id?: string | null }).last_selected_subtitle_track_id,
    ).toBe(whisperTrack?.track_id ?? null)
  })

  it("supports knowledge note list create update and delete through knowledge routes", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/knowledge/notes",
      payload: {
        excerpt: "第一段说明学习重点。",
        note_markdown: "## 笔记\n- 第一段说明学习重点。",
        source_kind: "highlight",
        source_start_seconds: 12,
        source_end_seconds: 18,
        source_reference_id: "highlight-1",
        source_reference_label: "重点片段 1",
        study_theme_id: "theme-1",
        tags: ["重点"],
        task_id: "task-study-route",
        title: "学习重点",
      },
    })

    expect(createResponse.statusCode).toBe(200)
    const created = knowledgeNoteSchema.parse(createResponse.json())

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/knowledge/notes?task_id=task-study-route&source_kind=highlight",
    })
    expect(listResponse.statusCode).toBe(200)
    const listed = knowledgeLibraryResponseSchema.parse(listResponse.json())
    const listAllResponse = await app.inject({
      method: "GET",
      url: "/api/knowledge/notes?task_id=task-study-route&source_kind=all",
    })
    expect(listAllResponse.statusCode).toBe(200)
    const listedAll = knowledgeLibraryResponseSchema.parse(listAllResponse.json())
    expect(listed.total).toBe(1)
    expect(listedAll.total).toBe(1)
    expect(listed.items[0]).toMatchObject({
      id: created.id,
      title: "学习重点",
      source_start_seconds: 12,
      source_end_seconds: 18,
      source_reference_id: "highlight-1",
      source_reference_label: "重点片段 1",
    })

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/knowledge/notes/${created.id}`,
      payload: {
        source_start_seconds: 20,
        source_end_seconds: 26,
        source_reference_id: "quote-1",
        source_reference_label: "关键引用 1",
        title: "学习重点（更新）",
        tags: ["重点", "已整理"],
      },
    })
    expect(updateResponse.statusCode).toBe(200)
    expect(knowledgeNoteSchema.parse(updateResponse.json())).toMatchObject({
      id: created.id,
      source_start_seconds: 20,
      source_end_seconds: 26,
      source_reference_id: "quote-1",
      source_reference_label: "关键引用 1",
      title: "学习重点（更新）",
      tags: ["重点", "已整理"],
    })

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/knowledge/notes/${created.id}`,
    })
    expect(deleteResponse.statusCode).toBe(204)
  })

  it("creates study export records and lists them through task export routes", async () => {
    const noteCreateResponse = await app.inject({
      method: "POST",
      url: "/api/knowledge/notes",
      payload: {
        excerpt: "导出知识卡片。",
        note_markdown: "## 导出知识卡片",
        source_kind: "manual",
        tags: ["导出"],
        task_id: "task-study-route",
        title: "导出知识卡片",
      },
    })
    expect(noteCreateResponse.statusCode).toBe(200)

    const createStudyPackExport = await app.inject({
      method: "POST",
      url: "/api/tasks/task-study-route/exports",
      payload: {
        export_kind: "study_pack",
      },
    })
    const createKnowledgeExport = await app.inject({
      method: "POST",
      url: "/api/tasks/task-study-route/exports",
      payload: {
        export_kind: "knowledge_notes",
      },
    })

    expect(createStudyPackExport.statusCode).toBe(200)
    expect(createKnowledgeExport.statusCode).toBe(200)

    const studyPackExport = createStudyPackExport.json() as { export_kind?: string; file_path?: string }
    const knowledgeExport = createKnowledgeExport.json() as { export_kind?: string; file_path?: string }

    expect(studyPackExport.export_kind).toBe("study_pack")
    expect(knowledgeExport.export_kind).toBe("knowledge_notes")

    const [studyPackContent, knowledgeContent] = await Promise.all([
      readFile(path.join(storageDir, "tasks", "stage-artifacts", "task-study-route", studyPackExport.file_path || ""), "utf8"),
      readFile(path.join(storageDir, "tasks", "stage-artifacts", "task-study-route", knowledgeExport.file_path || ""), "utf8"),
    ])
    expect(studyPackContent).toContain("## Highlights")
    expect(knowledgeContent).toContain("导出知识卡片")

    const listExportsResponse = await app.inject({
      method: "GET",
      url: "/api/tasks/task-study-route/exports",
    })
    expect(listExportsResponse.statusCode).toBe(200)
    expect(listExportsResponse.json()).toEqual([
      expect.objectContaining({
        export_kind: "knowledge_notes",
      }),
      expect.objectContaining({
        export_kind: "study_pack",
      }),
    ])
  })
})

async function seedStudyFixtures(storageDir: string): Promise<void> {
  const recordsDir = path.join(storageDir, "tasks", "records")
  const studyDir = path.join(storageDir, "tasks", "stage-artifacts", "task-study-route", "D", "study")
  const configDir = path.join(storageDir, "config")
  await mkdir(recordsDir, { recursive: true })
  await mkdir(studyDir, { recursive: true })
  await mkdir(configDir, { recursive: true })

  const record = {
    id: "task-study-route",
    source_type: "youtube",
    source_input: "https://youtu.be/study-route-demo",
    workflow: "notes",
    title: "Study Route Task",
    language: "zh",
    model_size: "small",
    status: "completed",
    progress: 100,
    transcript_text: "第一段说明学习重点。\n第二段解释如何提问与记笔记。\n第三段总结行动建议。",
    transcript_segments_json: JSON.stringify([
      { start: 0, end: 10, text: "第一段说明学习重点。" },
      { start: 10, end: 22, text: "第二段解释如何提问与记笔记。" },
      { start: 22, end: 36, text: "第三段总结行动建议。" },
    ]),
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
    created_at: "2026-04-20T00:00:00.000Z",
    updated_at: "2026-04-20T00:10:00.000Z",
  }

  await writeFile(path.join(recordsDir, "task-study-route.json"), `${JSON.stringify(record)}\n`, "utf8")
  await writeFile(path.join(studyDir, "subtitle-probe.json"), JSON.stringify({
    subtitles: {
      zh: [{ ext: "vtt", url: "https://cdn.example.com/study-route-zh.vtt", name: "中文（原始）" }],
    },
    automatic_captions: {
      en: [{ ext: "vtt", url: "https://cdn.example.com/study-route-en.vtt", name: "English (auto)" }],
    },
  }, null, 2), "utf8")
  await writeFile(path.join(configDir, "ui_settings.json"), JSON.stringify({
    auto_save: true,
    background_image: null,
    background_image_blur: 0,
    background_image_fill_mode: "cover",
    background_image_focus_x: 0.5,
    background_image_focus_y: 0.5,
    background_image_opacity: 28,
    background_image_scale: 1,
    font_size: 14,
    language: "zh",
    study_default_translation_target: "en",
    theme_hue: 220,
  }, null, 2), "utf8")
}

async function removeDirectoryWithRetry(targetPath: string, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        process.platform === "win32" &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EBUSY" &&
        index === attempts - 1
      ) {
        return
      }
      if (index === attempts - 1) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}
