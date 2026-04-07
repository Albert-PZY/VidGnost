import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import toast from 'react-hot-toast'

import {
  getLLMConfig,
  updateLLMConfig,
  updateWhisperConfig,
} from '../lib/api'
import type { LLMConfig, WhisperConfig } from '../types'

interface UseWorkbenchConfigManagerOptions {
  t: TFunction
  llmConfig: LLMConfig
  whisperDraft: WhisperConfig
  setLLMConfig: Dispatch<SetStateAction<LLMConfig>>
  setWhisperConfig: Dispatch<SetStateAction<WhisperConfig>>
  setWhisperDraft: Dispatch<SetStateAction<WhisperConfig>>
  setSavingWhisperConfig: Dispatch<SetStateAction<boolean>>
  setSavingLlmConfig: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  normalizeWhisperConfigForCpu: (config: WhisperConfig) => WhisperConfig
  appendLog: (stage: 'A' | 'B' | 'C' | 'D', message: string) => void
}

export function useWorkbenchConfigManager({
  t,
  llmConfig,
  whisperDraft,
  setLLMConfig,
  setWhisperConfig,
  setWhisperDraft,
  setSavingWhisperConfig,
  setSavingLlmConfig,
  setError,
  normalizeWhisperConfigForCpu,
  appendLog,
}: UseWorkbenchConfigManagerOptions) {
  const saveWhisperRuntimeConfig = useCallback(async () => {
    setSavingWhisperConfig(true)
    setError(null)
    try {
      const saved = await updateWhisperConfig(normalizeWhisperConfigForCpu(whisperDraft))
      const normalizedSaved = normalizeWhisperConfigForCpu(saved)
      const persistedLLM = await getLLMConfig()
      const correctedLLM = await updateLLMConfig({
        ...persistedLLM,
        correction_mode: llmConfig.correction_mode,
      })
      setWhisperConfig(normalizedSaved)
      setWhisperDraft(normalizedSaved)
      setLLMConfig((prev) => ({
        ...prev,
        correction_mode: correctedLLM.correction_mode,
        correction_batch_size: correctedLLM.correction_batch_size,
        correction_overlap: correctedLLM.correction_overlap,
      }))
      if (Array.isArray(saved.warnings) && saved.warnings.length > 0) {
        for (const warning of saved.warnings) {
          toast.error(warning)
        }
      }
      toast.success(t('whisper.saveSuccess'))
      appendLog('A', t('runtime.log.whisperConfigSaved'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.saveWhisperConfigFailed')
      setError(message)
      toast.error(message)
    } finally {
      setSavingWhisperConfig(false)
    }
  }, [
    appendLog,
    llmConfig.correction_mode,
    normalizeWhisperConfigForCpu,
    setError,
    setLLMConfig,
    setSavingWhisperConfig,
    setWhisperConfig,
    setWhisperDraft,
    t,
    whisperDraft,
  ])

  const saveLlmConfig = useCallback(async () => {
    setSavingLlmConfig(true)
    setError(null)
    try {
      const savedLLM = await updateLLMConfig(llmConfig)
      const savedWhisper = await updateWhisperConfig(normalizeWhisperConfigForCpu(whisperDraft))
      const normalizedWhisper = normalizeWhisperConfigForCpu(savedWhisper)
      setLLMConfig(savedLLM)
      setWhisperConfig(normalizedWhisper)
      setWhisperDraft(normalizedWhisper)
      if (Array.isArray(savedWhisper.warnings) && savedWhisper.warnings.length > 0) {
        for (const warning of savedWhisper.warnings) {
          toast.error(warning)
        }
      }
      toast.success('配置保存成功')
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存配置失败'
      setError(message)
      toast.error(message)
    } finally {
      setSavingLlmConfig(false)
    }
  }, [
    llmConfig,
    normalizeWhisperConfigForCpu,
    setError,
    setLLMConfig,
    setSavingLlmConfig,
    setWhisperConfig,
    setWhisperDraft,
    whisperDraft,
  ])

  return {
    saveWhisperRuntimeConfig,
    saveLlmConfig,
  }
}
