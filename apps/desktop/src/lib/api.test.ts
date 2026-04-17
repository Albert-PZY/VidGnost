import { afterEach, describe, expect, it, vi } from "vitest"

import { deleteTask } from "./api"

describe("apiFetch request headers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
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
})
