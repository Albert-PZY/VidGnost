import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { AddressInfo } from "node:net"

import { OpenAiCompatibleClient } from "../src/modules/llm/openai-compatible-client.js"

describe("OpenAiCompatibleClient.generateVisionText", () => {
  let client: OpenAiCompatibleClient
  let server: ReturnType<typeof createServer>
  let baseUrl = ""
  let requestBodies: Array<Record<string, unknown>> = []
  let tempDir = ""

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-openai-client-"))
    server = createServer(async (request, response) => {
      if (request.url !== "/v1/chat/completions" || request.method !== "POST") {
        response.writeHead(404, { "Content-Type": "application/json" })
        response.end(JSON.stringify({ error: { message: "not found" } }))
        return
      }

      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk))
      }
      requestBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)

      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: "ok",
            },
          },
        ],
      }))
    })
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve())
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    client = new OpenAiCompatibleClient()
  })

  beforeEach(() => {
    requestBodies = []
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("converts local file URLs into data URLs before sending the vision request", async () => {
    const imagePath = path.join(tempDir, "frame-1.jpg")
    await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

    const fileUrl = `file:///${imagePath.replace(/\\/g, "/")}`
    await client.generateVisionText({
      apiKey: "ollama",
      baseUrl,
      frames: [{ imageUrl: fileUrl }],
      model: "qwen2.5vl:3b",
      userPrompt: "describe",
    })

    const body = requestBodies[0]
    const messages = Array.isArray(body?.messages) ? body.messages as Array<Record<string, unknown>> : []
    const userMessage = messages.find((item) => item.role === "user")
    const content = Array.isArray(userMessage?.content) ? userMessage.content as Array<Record<string, unknown>> : []
    const imageItem = content.find((item) => item.type === "image_url")
    const imageUrl = imageItem?.image_url && typeof imageItem.image_url === "object"
      ? String((imageItem.image_url as { url?: unknown }).url || "")
      : ""

    expect(imageUrl.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(imageUrl).not.toContain("file:///")
  })

  it("keeps an existing data URL unchanged", async () => {
    const inputUrl = "data:image/png;base64,ZmFrZS1pbWFnZQ=="
    await client.generateVisionText({
      apiKey: "ollama",
      baseUrl,
      frames: [{ imageUrl: inputUrl }],
      model: "qwen2.5vl:3b",
      userPrompt: "describe",
    })

    const body = requestBodies[0]
    const messages = Array.isArray(body?.messages) ? body.messages as Array<Record<string, unknown>> : []
    const userMessage = messages.find((item) => item.role === "user")
    const content = Array.isArray(userMessage?.content) ? userMessage.content as Array<Record<string, unknown>> : []
    const imageItem = content.find((item) => item.type === "image_url")
    const imageUrl = imageItem?.image_url && typeof imageItem.image_url === "object"
      ? String((imageItem.image_url as { url?: unknown }).url || "")
      : ""

    expect(imageUrl).toBe(inputUrl)
  })
})
