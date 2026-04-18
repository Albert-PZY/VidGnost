import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { FastifyInstance } from "fastify"

import { modelListResponseSchema } from "@vidgnost/contracts"

import { buildApp } from "../src/server/build-app.js"

describe("offline Ollama manifest discovery", () => {
  let app: FastifyInstance
  let storageDir = ""
  let modelsDir = ""

  beforeAll(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "vidgnost-api-offline-ollama-"))
    modelsDir = path.join(storageDir, "ollama-models")

    await seedOllamaModel(modelsDir, {
      namespace: "library",
      repository: "qwen2.5",
      tag: "3b",
      blobs: [
        { digest: digest("1"), size: 17, kind: "config" },
        { digest: digest("2"), size: 101, kind: "layer" },
        { digest: digest("3"), size: 211, kind: "layer" },
      ],
    })
    await seedOllamaModel(modelsDir, {
      namespace: "library",
      repository: "bge-m3",
      tag: "latest",
      blobs: [
        { digest: digest("4"), size: 19, kind: "config" },
        { digest: digest("5"), size: 103, kind: "layer" },
      ],
    })
    await seedOllamaModel(modelsDir, {
      namespace: "sam860",
      repository: "qwen3-reranker",
      tag: "0.6b-q8_0",
      blobs: [
        { digest: digest("6"), size: 13, kind: "config" },
        { digest: digest("7"), size: 97, kind: "layer" },
      ],
    })
    await seedOllamaModel(modelsDir, {
      namespace: "library",
      repository: "qwen2.5vl",
      tag: "3b",
      blobs: [
        { digest: digest("8"), size: 23, kind: "config" },
        { digest: digest("9"), size: 111, kind: "layer" },
        { digest: digest("a"), size: 211, kind: "layer" },
      ],
    })

    app = await buildApp({
      apiPrefix: "/api",
      storageDir,
      ollamaBaseUrl: "http://127.0.0.1:65531",
      llmBaseUrl: "http://127.0.0.1:65531/v1",
    })

    const saveOllamaConfigResponse = await app.inject({
      method: "PUT",
      url: "/api/config/ollama",
      payload: {
        models_dir: modelsDir,
        base_url: "http://127.0.0.1:65531",
      },
    })
    expect(saveOllamaConfigResponse.statusCode).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    if (storageDir) {
      await rm(storageDir, { force: true, recursive: true })
    }
  })

  it("keeps Ollama models marked as installed with offline sizes even when the service is unreachable", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config/models",
    })

    expect(response.statusCode).toBe(200)
    const payload = modelListResponseSchema.parse(response.json())

    expect(payload.items.find((item) => item.id === "llm-default")).toMatchObject({
      provider: "ollama",
      model_id: "qwen2.5:3b",
      is_installed: true,
      size_bytes: 329,
      status: "not_ready",
    })
    expect(payload.items.find((item) => item.id === "embedding-default")).toMatchObject({
      provider: "ollama",
      model_id: "bge-m3",
      is_installed: true,
      size_bytes: 122,
      status: "not_ready",
    })
    expect(payload.items.find((item) => item.id === "rerank-default")).toMatchObject({
      provider: "ollama",
      model_id: "sam860/qwen3-reranker:0.6b-q8_0",
      is_installed: true,
      size_bytes: 110,
      status: "not_ready",
    })
    expect(payload.items.find((item) => item.id === "vlm-default")).toMatchObject({
      provider: "ollama",
      model_id: "qwen2.5vl:3b",
      is_installed: true,
      size_bytes: 345,
      status: "not_ready",
      api_base_url: "http://127.0.0.1:65531/v1",
      api_model: "qwen2.5vl:3b",
    })
  })
})

function digest(seed: string): string {
  return `sha256:${seed.repeat(64)}`
}

async function seedOllamaModel(
  modelsDir: string,
  input: {
    namespace: string
    repository: string
    tag: string
    blobs: Array<{
      digest: string
      kind: "config" | "layer"
      size: number
    }>
  },
): Promise<void> {
  const manifestPath = path.join(
    modelsDir,
    "manifests",
    "registry.ollama.ai",
    input.namespace,
    input.repository,
    input.tag,
  )
  const blobsDir = path.join(modelsDir, "blobs")
  await mkdir(path.dirname(manifestPath), { recursive: true })
  await mkdir(blobsDir, { recursive: true })

  const [configBlob, ...layerBlobs] = input.blobs
  for (const blob of input.blobs) {
    await writeFile(path.join(blobsDir, blob.digest.replace(":", "-")), Buffer.alloc(blob.size, 1))
  }

  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: {
        mediaType: "application/vnd.docker.container.image.v1+json",
        digest: configBlob.digest,
        size: configBlob.size,
      },
      layers: layerBlobs.map((blob) => ({
        mediaType: "application/vnd.ollama.image.model",
        digest: blob.digest,
        size: blob.size,
      })),
    }),
    "utf8",
  )
}
