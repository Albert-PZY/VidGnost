import path from "node:path"
import { appendFile, readFile } from "node:fs/promises"

import { ensureDirectory } from "../../core/fs.js"

const TERMINAL_EVENT_TYPES = new Set([
  "task_complete",
  "task_failed",
  "task_cancelled",
  "self_check_complete",
  "self_check_failed",
  "self_fix_complete",
  "self_fix_failed",
])

export interface EventSubscription {
  history: Array<Record<string, unknown>>
  queue: AsyncQueue<Record<string, unknown>>
}

export class EventBus {
  private readonly history = new Map<string, Array<Record<string, unknown>>>()
  private readonly subscribers = new Map<string, Set<AsyncQueue<Record<string, unknown>>>>()
  private readonly terminalTopics = new Set<string>()
  private readonly traceSequence = new Map<string, number>()

  constructor(
    private readonly eventLogDir: string,
    private readonly historySize = 2000,
  ) {}

  async publish(topic: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const traceId = this.nextTraceId(topic, payload.trace_id)
    const event: Record<string, unknown> = {
      topic,
      task_id: String(payload.task_id || topic),
      ts: new Date().toISOString(),
      trace_id: traceId,
      ...payload,
    }

    const nextHistory = [...(this.history.get(topic) || []), event].slice(-this.historySize)
    this.history.set(topic, nextHistory)

    const eventType = String(payload.type || "").trim()
    if (TERMINAL_EVENT_TYPES.has(eventType)) {
      this.terminalTopics.add(topic)
    }

    await this.appendEventLog(topic, event)

    const queues = [...(this.subscribers.get(topic) || [])]
    queues.forEach((queue) => queue.enqueue(event))

    if (this.terminalTopics.has(topic) && queues.length === 0) {
      this.history.delete(topic)
      this.terminalTopics.delete(topic)
      this.traceSequence.delete(topic)
    }

    return event
  }

  async subscribe(topic: string): Promise<EventSubscription> {
    const queue = new AsyncQueue<Record<string, unknown>>(512)
    const subscribers = this.subscribers.get(topic) || new Set<AsyncQueue<Record<string, unknown>>>()
    subscribers.add(queue)
    this.subscribers.set(topic, subscribers)

    const history = this.history.get(topic) || (await this.readEventLog(topic))
    if (!this.history.has(topic) && history.length > 0) {
      this.history.set(topic, history.slice(-this.historySize))
    }

    return {
      history: [...history],
      queue,
    }
  }

  unsubscribe(topic: string, queue: AsyncQueue<Record<string, unknown>>): void {
    const subscribers = this.subscribers.get(topic)
    if (!subscribers) {
      return
    }

    subscribers.delete(queue)
    queue.close()

    if (subscribers.size === 0) {
      this.subscribers.delete(topic)
      if (this.terminalTopics.has(topic)) {
        this.history.delete(topic)
        this.terminalTopics.delete(topic)
        this.traceSequence.delete(topic)
      }
    }
  }

  async resetTopic(topic: string): Promise<void> {
    this.history.delete(topic)
    this.terminalTopics.delete(topic)
    this.traceSequence.delete(topic)
    const subscribers = this.subscribers.get(topic)
    if (!subscribers) {
      return
    }
    subscribers.forEach((queue) => queue.clear())
  }

  private nextTraceId(topic: string, rawTraceId: unknown): string {
    const candidate = String(rawTraceId || "").trim()
    if (candidate) {
      return candidate
    }
    const nextValue = (this.traceSequence.get(topic) || 0) + 1
    this.traceSequence.set(topic, nextValue)
    return `${topic}-${nextValue}`
  }

  private async appendEventLog(topic: string, event: Record<string, unknown>): Promise<void> {
    const targetPath = path.join(this.eventLogDir, `${sanitizeTopicName(topic)}.jsonl`)
    await ensureDirectory(path.dirname(targetPath))
    await appendFile(targetPath, `${JSON.stringify(event)}\n`, "utf8")
  }

  private async readEventLog(topic: string): Promise<Array<Record<string, unknown>>> {
    try {
      const targetPath = path.join(this.eventLogDir, `${sanitizeTopicName(topic)}.jsonl`)
      const raw = await readFile(targetPath, "utf8")
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .slice(-this.historySize)
    } catch {
      return []
    }
  }
}

export class AsyncQueue<T> {
  private readonly items: T[] = []
  private readonly resolvers: Array<(value: T) => void> = []
  private closed = false

  constructor(private readonly maxSize: number) {}

  enqueue(item: T): void {
    if (this.closed) {
      return
    }

    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver(item)
      return
    }

    if (this.items.length >= this.maxSize) {
      this.items.shift()
    }
    this.items.push(item)
  }

  async dequeue(): Promise<T> {
    if (this.items.length > 0) {
      return this.items.shift() as T
    }
    if (this.closed) {
      throw new Error("Queue closed")
    }
    return new Promise<T>((resolve) => {
      this.resolvers.push(resolve)
    })
  }

  clear(): void {
    this.items.length = 0
  }

  close(): void {
    this.closed = true
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()
      if (resolve) {
        resolve({} as T)
      }
    }
  }
}

function sanitizeTopicName(topic: string): string {
  return String(topic || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .trim()
    .replace(/[. ]+$/g, "") || "event-stream"
}
