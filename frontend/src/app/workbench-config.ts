import type { BundleArchiveFormat } from '../lib/api'
import type {
  StageKey,
  TaskEvent,
  TaskStatus,
  VmPhaseKey,
  VmPhaseMetric,
  WhisperConfig,
} from '../types'

export const MODEL_OPTIONS = ['small'] as const
export const LANGUAGE_OPTIONS = ['zh', 'en', 'ja'] as const
export const LANGUAGE_OPTION_LABELS: Record<(typeof LANGUAGE_OPTIONS)[number], string> = {
  zh: 'zh（中文）',
  en: 'en（英文）',
  ja: 'ja（日文）',
}
export const COMPUTE_TYPE_OPTIONS = ['int8', 'float32'] as const
export const TARGET_SAMPLE_RATE_OPTIONS = [16000, 44100] as const
export const TARGET_CHANNEL_OPTIONS = [1, 2] as const
export const TRANSCRIPT_CORRECTION_MODE_OPTIONS = ['off', 'strict', 'rewrite'] as const
export const LLM_MODE_OPTIONS = ['api'] as const
export const MODEL_LOAD_PROFILE_OPTIONS = ['balanced', 'memory_first'] as const
export const STAGES: StageKey[] = ['A', 'B', 'C', 'D']
export const VM_PHASES: VmPhaseKey[] = ['A', 'B', 'C', 'transcript_optimize', 'D']
export const UI_LOCALES = ['zh-CN', 'en'] as const
export const WHISPER_PRESET_KEYS = ['speed', 'balanced', 'quality'] as const
export const TASK_STATUS_KEYS: TaskStatus[] = ['queued', 'preparing', 'transcribing', 'summarizing', 'cancelled', 'completed', 'failed']
const TASK_STATUS_KEY_SET = new Set<TaskStatus>(TASK_STATUS_KEYS)

export const FIELD_INPUT_CLASS_NAME =
  'w-full rounded-lg border border-border/85 bg-surface-elevated/95 px-3 py-2.5 text-[0.92rem] leading-6 tracking-[0.004em] text-text-main shadow-[inset_0_1px_0_var(--ui-inset-medium)] outline-none transition-all duration-200 placeholder:text-text-subtle/80 focus:border-accent/70 focus:bg-bg-base focus:shadow-[0_0_0_2px_rgba(31,142,241,0.2)]'

export const DEFAULT_WHISPER_CONFIG: WhisperConfig = {
  model_default: 'small',
  language: 'zh',
  device: 'cpu',
  compute_type: 'int8',
  model_load_profile: 'balanced',
  beam_size: 5,
  vad_filter: true,
  chunk_seconds: 180,
  target_sample_rate: 16000,
  target_channels: 1,
}

export const WHISPER_PRESET_CONFIGS: Record<(typeof WHISPER_PRESET_KEYS)[number], WhisperConfig> = {
  speed: {
    ...DEFAULT_WHISPER_CONFIG,
    beam_size: 1,
    chunk_seconds: 120,
  },
  balanced: {
    ...DEFAULT_WHISPER_CONFIG,
  },
  quality: {
    ...DEFAULT_WHISPER_CONFIG,
    model_default: 'small',
    compute_type: 'float32',
    beam_size: 8,
    chunk_seconds: 240,
  },
}

export type UILocale = (typeof UI_LOCALES)[number]
export type WhisperPresetKey = (typeof WHISPER_PRESET_KEYS)[number]
export type SidebarPanelKey = 'source' | 'history' | 'config' | 'selfCheck' | null
export type MainViewMode = 'workbench' | 'quickstart'

export function createEmptyVmPhaseMetrics(): Record<VmPhaseKey, VmPhaseMetric> {
  const create = (optional = false): VmPhaseMetric => ({
    status: 'pending',
    started_at: null,
    completed_at: null,
    elapsed_seconds: null,
    optional,
    reason: null,
  })
  return {
    A: create(false),
    B: create(false),
    C: create(false),
    transcript_optimize: create(true),
    D: create(false),
  }
}

export function normalizeLocale(locale: string): UILocale {
  return locale.toLowerCase().startsWith('en') ? 'en' : 'zh-CN'
}

export function detectBundleArchiveFormat(): BundleArchiveFormat {
  if (typeof navigator === 'undefined') return 'zip'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase()
  if (platform.includes('linux')) {
    return 'tar'
  }
  return 'zip'
}

export function parseTaskStatus(status: string | undefined): TaskStatus | null {
  if (!status) return null
  return TASK_STATUS_KEY_SET.has(status as TaskStatus) ? (status as TaskStatus) : null
}

export function parseInteger(value: string, fallback: number, min = Number.MIN_SAFE_INTEGER): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.max(min, parsed)
}

export function parseFloatInput(value: string, fallback: number, min = Number.MIN_VALUE): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, parsed)
}

export function parseNumeric(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

export function inferStageFromStatus(status: TaskStatus): StageKey {
  if (status === 'summarizing') return 'D'
  if (status === 'transcribing') return 'C'
  return 'A'
}

export function isTaskTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function inferStageFromLogs(logs: Partial<Record<StageKey, string[]>> | null | undefined): StageKey {
  for (const stage of [...STAGES].reverse()) {
    const lines = logs?.[stage]
    if (Array.isArray(lines) && lines.length > 0) {
      return stage
    }
  }
  return 'A'
}

function formatEventClock(isoTimestamp: string | undefined): string {
  if (!isoTimestamp) return ''
  const value = Date.parse(isoTimestamp)
  if (Number.isNaN(value)) return ''
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatLogLine(event: TaskEvent): string {
  const prefixes: string[] = []
  const clock = formatEventClock(event.ts)
  if (clock) prefixes.push(`[${clock}]`)
  if (event.substage) prefixes.push(`[${event.substage}]`)
  if (typeof event.elapsed_seconds === 'number' && Number.isFinite(event.elapsed_seconds)) {
    prefixes.push(`[+${event.elapsed_seconds.toFixed(1)}s]`)
  }
  const body = event.message ?? ''
  if (!prefixes.length) return body
  return `${prefixes.join(' ')} ${body}`.trim()
}

export function formatRuntimeWarningLine(event: TaskEvent): string {
  const prefixes: string[] = []
  const clock = formatEventClock(event.ts)
  if (clock) prefixes.push(`[${clock}]`)
  prefixes.push('[runtime-warning]')
  if (event.code) prefixes.push(`[${event.code}]`)
  if (event.component || event.action) {
    const suffix = [event.component, event.action].filter(Boolean).join('/')
    if (suffix) prefixes.push(`[${suffix}]`)
  }
  if (event.substage) prefixes.push(`[${event.substage}]`)
  if (typeof event.elapsed_seconds === 'number' && Number.isFinite(event.elapsed_seconds)) {
    prefixes.push(`[+${event.elapsed_seconds.toFixed(1)}s]`)
  }
  const body = event.message ?? ''
  return `${prefixes.join(' ')} ${body}`.trim()
}

export function normalizeWhisperConfigForCpu(config: WhisperConfig): WhisperConfig {
  const normalizedComputeType = config.compute_type === 'float32' ? 'float32' : 'int8'
  return {
    ...config,
    device: 'cpu',
    compute_type: normalizedComputeType,
    model_load_profile:
      config.model_load_profile === 'memory_first'
        ? 'memory_first'
        : 'balanced',
  }
}

function isSameWhisperConfig(left: WhisperConfig, right: WhisperConfig): boolean {
  return (
    left.model_default === right.model_default
    && left.language === right.language
    && left.device === right.device
    && left.compute_type === right.compute_type
    && left.model_load_profile === right.model_load_profile
    && left.beam_size === right.beam_size
    && left.vad_filter === right.vad_filter
    && left.chunk_seconds === right.chunk_seconds
    && left.target_sample_rate === right.target_sample_rate
    && left.target_channels === right.target_channels
  )
}

export function detectWhisperPreset(config: WhisperConfig): WhisperPresetKey | 'custom' {
  for (const preset of WHISPER_PRESET_KEYS) {
    if (isSameWhisperConfig(config, WHISPER_PRESET_CONFIGS[preset])) {
      return preset
    }
  }
  return 'custom'
}
