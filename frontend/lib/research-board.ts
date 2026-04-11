"use client"

export type ResearchBoardItemType = "transcript" | "citation" | "note"

export interface ResearchBoardItem {
  id: string
  type: ResearchBoardItemType
  taskId: string
  taskTitle: string
  workflow: "notes" | "vqa"
  title: string
  content: string
  start?: number
  end?: number
  source?: string
  sourceSet?: string[]
  createdAt: string
}

const STORAGE_KEY = "vidgnost:research-board"
const CHANGE_EVENT = "vidgnost:research-board:changed"
const MAX_ITEMS = 240

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function readItems(): ResearchBoardItem[] {
  if (!canUseStorage()) {
    return []
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isResearchBoardItem)
  } catch {
    return []
  }
}

function writeItems(items: ResearchBoardItem[]): void {
  if (!canUseStorage()) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

function isResearchBoardItem(value: unknown): value is ResearchBoardItem {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Partial<ResearchBoardItem>
  return typeof candidate.id === "string" && typeof candidate.taskId === "string"
}

export function listResearchBoardItems(): ResearchBoardItem[] {
  return readItems().sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function addResearchBoardItem(item: Omit<ResearchBoardItem, "id" | "createdAt">): ResearchBoardItem {
  const items = readItems()
  const nextItem: ResearchBoardItem = {
    ...item,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  writeItems([nextItem, ...items.filter((current) => current.content !== item.content || current.taskId !== item.taskId)])
  return nextItem
}

export function removeResearchBoardItem(itemId: string): void {
  writeItems(readItems().filter((item) => item.id !== itemId))
}

export function clearResearchBoardItems(): void {
  writeItems([])
}

export function subscribeResearchBoard(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener("storage", listener)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener("storage", listener)
  }
}
