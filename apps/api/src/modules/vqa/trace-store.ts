import path from "node:path"
import { existsSync } from "node:fs"
import { appendFile, readFile } from "node:fs/promises"

import { ensureDirectory } from "../../core/fs.js"
import { generateTimeKey } from "../../core/id.js"

export interface TraceEnvelope {
  payload: Record<string, unknown>
  stage: string
  trace_id: string
  ts: string
}

export class VqaTraceStore {
  private readonly pendingTraceIds = new Set<string>()

  constructor(private readonly logDir: string) {}

  newTrace(input: {
    configSnapshot: Record<string, unknown>
    metadata: Record<string, unknown>
  }): string {
    const traceId = generateTimeKey("trace", (candidate) => this.isTraceIdAllocated(candidate))
    this.pendingTraceIds.add(traceId)
    void this.write(traceId, "trace_started", {
      config_snapshot: input.configSnapshot,
      metadata: input.metadata,
    })
      .catch(() => undefined)
      .finally(() => {
        this.pendingTraceIds.delete(traceId)
      })
    return traceId
  }

  async write(traceId: string, stage: string, payload: Record<string, unknown>): Promise<void> {
    const envelope: TraceEnvelope = {
      trace_id: traceId,
      stage,
      ts: new Date().toISOString(),
      payload,
    }
    const targetPath = this.resolvePath(traceId)
    await ensureDirectory(path.dirname(targetPath))
    await appendFile(targetPath, `${JSON.stringify(envelope)}\n`, "utf8")
  }

  async finalize(traceId: string, payload: Record<string, unknown>): Promise<void> {
    await this.write(traceId, "trace_finished", payload)
  }

  async read(traceId: string): Promise<TraceEnvelope[]> {
    try {
      const raw = await readFile(this.resolvePath(traceId), "utf8")
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TraceEnvelope)
    } catch {
      return []
    }
  }

  private resolvePath(traceId: string): string {
    return path.join(this.logDir, `${sanitizeTraceId(traceId)}.jsonl`)
  }

  private isTraceIdAllocated(traceId: string): boolean {
    return this.pendingTraceIds.has(traceId) || existsSync(this.resolvePath(traceId))
  }
}

function sanitizeTraceId(traceId: string): string {
  return String(traceId || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .trim()
    .replace(/[. ]+$/g, "") || "trace"
}
