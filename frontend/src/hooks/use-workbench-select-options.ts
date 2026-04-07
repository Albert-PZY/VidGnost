import { useMemo } from 'react'
import type { TFunction } from 'i18next'

import type { SelectFieldOption } from '../components/workbench-panels'
import {
  COMPUTE_TYPE_OPTIONS,
  LANGUAGE_OPTIONS,
  LANGUAGE_OPTION_LABELS,
  LLM_MODE_OPTIONS,
  MODEL_LOAD_PROFILE_OPTIONS,
  MODEL_OPTIONS,
  TARGET_CHANNEL_OPTIONS,
  TARGET_SAMPLE_RATE_OPTIONS,
  TRANSCRIPT_CORRECTION_MODE_OPTIONS,
  UI_LOCALES,
} from '../app/workbench-config'

interface UseWorkbenchSelectOptionsOptions {
  t: TFunction
}

export function useWorkbenchSelectOptions({ t }: UseWorkbenchSelectOptionsOptions) {
  const uiLocaleOptions = useMemo<SelectFieldOption[]>(
    () =>
      UI_LOCALES.map((locale) => ({
        value: locale,
        label: t(`locale.long.${locale}`),
      })),
    [t],
  )
  const whisperModelOptions = useMemo<SelectFieldOption[]>(
    () =>
      MODEL_OPTIONS.map((option) => ({
        value: option,
        label: `Whisper ${option}`,
      })),
    [],
  )
  const whisperLanguageOptions = useMemo<SelectFieldOption[]>(
    () =>
      LANGUAGE_OPTIONS.map((option) => ({
        value: option,
        label: LANGUAGE_OPTION_LABELS[option],
      })),
    [],
  )
  const computeTypeOptions = useMemo<SelectFieldOption[]>(
    () =>
      COMPUTE_TYPE_OPTIONS.map((option) => ({
        value: option,
        label: option,
      })),
    [],
  )
  const targetSampleRateOptions = useMemo<SelectFieldOption[]>(
    () =>
      TARGET_SAMPLE_RATE_OPTIONS.map((option) => ({
        value: String(option),
        label: String(option),
      })),
    [],
  )
  const transcriptCorrectionModeOptions = useMemo<SelectFieldOption[]>(
    () =>
      TRANSCRIPT_CORRECTION_MODE_OPTIONS.map((option) => ({
        value: option,
        label: t(`whisper.correctionMode.${option}`),
      })),
    [t],
  )
  const llmModeOptions = useMemo<SelectFieldOption[]>(
    () =>
      LLM_MODE_OPTIONS.map((option) => ({
        value: option,
        label: 'api（在线）',
      })),
    [],
  )
  const loadProfileOptions = useMemo<SelectFieldOption[]>(
    () =>
      MODEL_LOAD_PROFILE_OPTIONS.map((option) => ({
        value: option,
        label:
          option === 'memory_first'
            ? t('runtime.loadProfile.memoryFirst')
            : t('runtime.loadProfile.balanced'),
      })),
    [t],
  )
  const targetChannelOptions = useMemo<SelectFieldOption[]>(
    () =>
      TARGET_CHANNEL_OPTIONS.map((option) => ({
        value: String(option),
        label: String(option),
      })),
    [],
  )

  return {
    uiLocaleOptions,
    whisperModelOptions,
    whisperLanguageOptions,
    computeTypeOptions,
    targetSampleRateOptions,
    transcriptCorrectionModeOptions,
    llmModeOptions,
    loadProfileOptions,
    targetChannelOptions,
  }
}
