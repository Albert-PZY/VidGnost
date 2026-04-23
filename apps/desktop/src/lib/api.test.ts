import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createTaskStudyExport,
  deleteBilibiliSession,
  deleteTask,
  downloadTaskArtifactFile,
  getBilibiliAuthStatus,
  getTaskStudyPack,
  getTaskStudyPreview,
  listKnowledgeNotes,
  pollBilibiliQrLogin,
  startBilibiliQrLogin,
  updateUiSettings,
  updateTaskStudyState,
} from "./api"

describe("apiFetch request headers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("does not send content-type for delete requests without body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
    })
    vi.stubGlobal("fetch", fetchMock)

    await deleteTask("task-delete-header")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init?.method).toBe("DELETE")
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false)
  })

  it("requests task study preview from the study route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ task_id: "task-study-preview" }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await getTaskStudyPreview("task-study-preview")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/tasks/task-study-preview/study-preview")
    expect(init?.method).toBe("GET")
  })

  it("updates task study state through the study-state route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ task_id: "task-study-state", favorite: true }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await updateTaskStudyState("task-study-state", {
      is_favorite: true,
      last_opened_at: "2026-04-20T10:30:00.000Z",
      playback_position_seconds: 92,
      selected_theme_id: "theme-1",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/tasks/task-study-state/study-state")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(String(init?.body))).toEqual({
      is_favorite: true,
      last_opened_at: "2026-04-20T10:30:00.000Z",
      playback_position_seconds: 92,
      last_position_seconds: 92,
      selected_theme_id: "theme-1",
    })
  })

  it("persists selected subtitle track through the study-state route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ task_id: "task-study-state", last_selected_subtitle_track_id: "track-2" }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await updateTaskStudyState("task-study-state", {
      last_selected_subtitle_track_id: "track-2",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/tasks/task-study-state/study-state")
    expect(init?.method).toBe("PATCH")
    expect(init?.body).toBe(JSON.stringify({
      last_selected_subtitle_track_id: "track-2",
    }))
  })

  it("persists study default translation target through the ui settings route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ language: "zh", study_default_translation_target: "en" }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await updateUiSettings({
      study_default_translation_target: "en",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/config/ui")
    expect(init?.method).toBe("PUT")
    expect(init?.body).toBe(JSON.stringify({
      study_default_translation_target: "en",
    }))
  })

  it("loads bilibili auth status from the config auth route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "active", account: { mid: "42", uname: "测试用户" } }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await getBilibiliAuthStatus()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/config/bilibili-auth")
    expect(init?.method).toBe("GET")
  })

  it("starts bilibili qr login from the qrcode start route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "pending",
        qrcode_key: "test-key",
        qrcode_url: "https://passport.bilibili.com/test",
        qr_image_data_url: "data:image/png;base64,test",
        expires_at: "2026-04-23T10:00:00.000Z",
        poll_interval_ms: 2000,
      }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await startBilibiliQrLogin()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/config/bilibili-auth/qrcode/start")
    expect(init?.method).toBe("POST")
    expect(init?.body).toBe(JSON.stringify({}))
  })

  it("polls bilibili qr login through the qrcode poll route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        account: { mid: "42", uname: "扫码用户" },
        expires_at: "2026-04-24T10:00:00.000Z",
        last_error: null,
        message: "登录成功",
      }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await pollBilibiliQrLogin("test-qrcode-key")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/config/bilibili-auth/qrcode/poll")
    expect(url).toContain("qrcode_key=test-qrcode-key")
    expect(init?.method).toBe("GET")
  })

  it("clears bilibili session from the auth session route without content-type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "missing", account: null }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await deleteBilibiliSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/config/bilibili-auth/session")
    expect(init?.method).toBe("DELETE")
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false)
  })

  it("loads study pack and knowledge notes from the new routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ task_id: "task-study-pack" }),
        headers: new Headers({ "content-type": "application/json" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0 }),
        headers: new Headers({ "content-type": "application/json" }),
      })
    vi.stubGlobal("fetch", fetchMock)

    await getTaskStudyPack("task-study-pack")
    await listKnowledgeNotes({ task_id: "task-study-pack", source_kind: "transcript", limit: 20 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("/tasks/task-study-pack/study-pack")
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain("/knowledge/notes")
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain("task_id=task-study-pack")
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain("source_kind=transcript")
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain("limit=20")
  })

  it("creates study exports through the study exports route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ export_kind: "study_pack", file_path: "D/study/exports/study-pack.md" }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await createTaskStudyExport("task-study-pack", {
      export_kind: "study_pack",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain("/tasks/task-study-pack/exports")
    expect(init?.method).toBe("POST")
    expect(init?.body).toBe(JSON.stringify({
      export_kind: "study_pack",
    }))
  })

  it("downloads study export artifacts from the artifact file route", async () => {
    const OriginalUrl = URL
    const blob = new Blob(["study export"], { type: "text/markdown" })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
      headers: new Headers(),
    })
    const createObjectURLMock = vi.fn().mockReturnValue("blob:study-export")
    const revokeObjectURLMock = vi.fn()
    const clickMock = vi.fn()
    class MockUrl extends OriginalUrl {
      static createObjectURL = createObjectURLMock
      static revokeObjectURL = revokeObjectURLMock
    }
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("URL", MockUrl)
    vi.stubGlobal("document", {
      body: {
        appendChild: vi.fn(),
      },
      createElement: vi.fn().mockImplementation((tagName: string) => {
        if (tagName === "a") {
          return {
            click: clickMock,
            remove: vi.fn(),
            href: "",
            download: "",
          }
        }
        return {}
      }),
    })

    await downloadTaskArtifactFile("task-study-pack", "D/study/exports/study-pack.md")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("/tasks/task-study-pack/artifacts/file")
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("path=D%2Fstudy%2Fexports%2Fstudy-pack.md")
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    expect(clickMock).toHaveBeenCalledTimes(1)
  })

  it("prefers response filenames when downloading knowledge export artifacts", async () => {
    const OriginalUrl = URL
    const blob = new Blob(["knowledge export"], { type: "application/zip" })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
      headers: new Headers({
        "content-disposition": "attachment; filename=\"knowledge-notes-20260420.zip\"",
      }),
    })
    const createObjectURLMock = vi.fn().mockReturnValue("blob:knowledge-export")
    const revokeObjectURLMock = vi.fn()
    const anchor = {
      click: vi.fn(),
      remove: vi.fn(),
      href: "",
      download: "",
    }
    class MockUrl extends OriginalUrl {
      static createObjectURL = createObjectURLMock
      static revokeObjectURL = revokeObjectURLMock
    }
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("URL", MockUrl)
    vi.stubGlobal("document", {
      body: {
        appendChild: vi.fn(),
      },
      createElement: vi.fn().mockReturnValue(anchor),
    })

    await downloadTaskArtifactFile("task-study-pack", "D/study/exports/knowledge-notes")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe("knowledge-notes-20260420.zip")
    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1)
  })

  it("passes study theme filters when loading knowledge notes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], total: 0 }),
      headers: new Headers({ "content-type": "application/json" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await listKnowledgeNotes({
      task_id: "task-study-pack",
      study_theme_id: "theme-1",
      tag: "重点",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain("/knowledge/notes")
    expect(url).toContain("task_id=task-study-pack")
    expect(url).toContain("study_theme_id=theme-1")
    expect(url).toContain("tag=%E9%87%8D%E7%82%B9")
  })
})
