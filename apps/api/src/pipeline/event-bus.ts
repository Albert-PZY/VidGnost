import type { TaskEvent, TaskId } from "@vidgnost/contracts"

type Listener = (event: TaskEvent) => void

/**
 * 任务事件总线：把任务进度推送给所有订阅了 SSE 的客户端。
 * 每个任务保留最近 200 条事件，供中途接入的连接做回放。
 */
export class TaskEventBus {
  private readonly listeners = new Map<TaskId, Set<Listener>>()
  private readonly history = new Map<TaskId, TaskEvent[]>()
  private readonly globalListeners = new Set<Listener>()

  publish(event: TaskEvent): void {
    const taskId = taskIdOf(event)
    if (taskId) {
      const list = this.history.get(taskId) || []
      list.push(event)
      if (list.length > 200) {
        list.splice(0, list.length - 200)
      }
      this.history.set(taskId, list)
    }

    for (const listener of this.listeners.get(taskId) || []) {
      safeInvoke(listener, event)
    }
    for (const listener of this.globalListeners) {
      safeInvoke(listener, event)
    }
  }

  subscribe(taskId: TaskId, listener: Listener): () => void {
    const set = this.listeners.get(taskId) || new Set<Listener>()
    set.add(listener)
    this.listeners.set(taskId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.listeners.delete(taskId)
      }
    }
  }

  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener)
    return () => {
      this.globalListeners.delete(listener)
    }
  }

  replay(taskId: TaskId): TaskEvent[] {
    return [...(this.history.get(taskId) || [])]
  }

  clear(taskId: TaskId): void {
    this.history.delete(taskId)
  }
}

function safeInvoke(listener: Listener, event: TaskEvent): void {
  try {
    listener(event)
  } catch {
    // 单个订阅者异常不影响其他订阅者
  }
}

function taskIdOf(event: TaskEvent): string {
  switch (event.type) {
    case "snapshot":
      return event.task.id
    case "done":
      return event.task.id
    default:
      return event.taskId
  }
}
