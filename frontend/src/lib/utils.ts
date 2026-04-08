import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatSeconds(seconds: number | null): string {
  if (!seconds || Number.isNaN(seconds)) return '--:--'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function prettyStatus(status: string): string {
  const map: Record<string, string> = {
    queued: '排队中',
    preparing: '准备中',
    transcribing: '转写中',
    summarizing: '总结中',
    completed: '已完成',
    failed: '失败',
  }
  return map[status] ?? status
}

