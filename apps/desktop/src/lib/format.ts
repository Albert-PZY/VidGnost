/** 显示层格式化工具。时间码与统计一律使用等宽字体渲染。 */

export function formatTimecode(seconds: number | undefined | null): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function formatDurationCn(seconds: number | undefined | null): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  if (total < 60) {
    return `${total} 秒`
  }
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes < 60) {
    return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

export function formatBytes(bytes: number | undefined | null): string {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return '—'
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return '—'
  const diff = Date.now() - time
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

const PLATFORM_LABELS: Record<string, string> = {
  local: '本地文件',
  direct: '直链媒体',
  youtube: 'YouTube',
  bilibili: 'Bilibili',
  other: '网页来源',
}

export function platformLabel(platform: string | undefined): string {
  return PLATFORM_LABELS[String(platform || '')] || '未知来源'
}

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
}

export function statusLabel(status: string | undefined): string {
  return STATUS_LABELS[String(status || '')] || '未知'
}

export function speakerLabel(speaker: string | undefined, index = 0): string {
  if (!speaker) return `说话人 ${index + 1}`
  return speaker
}
