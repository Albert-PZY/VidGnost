import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { LoaderCircle, Settings } from 'lucide-react'

import { PreText } from './pretext'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { TabsContent } from './ui/tabs'
import { ConfigField, SelectField, type SelectFieldOption } from './workbench-panels'
import { cn } from '../lib/utils'
import type { LLMConfig, WhisperConfig } from '../types'

type WhisperPresetKey = 'speed' | 'balanced' | 'quality'

interface WhisperConfigTabProps {
  t: TFunction
  fieldInputClassName: string
  menuPortalTarget: HTMLElement | null
  whisperDraftPreset: WhisperPresetKey | 'custom'
  whisperPresetKeys: readonly WhisperPresetKey[]
  applyWhisperPreset: (preset: WhisperPresetKey) => void
  whisperDraft: WhisperConfig
  setWhisperDraft: Dispatch<SetStateAction<WhisperConfig>>
  llmConfig: LLMConfig
  setLLMConfig: Dispatch<SetStateAction<LLMConfig>>
  whisperModelOptions: SelectFieldOption[]
  whisperLanguageOptions: SelectFieldOption[]
  computeTypeOptions: SelectFieldOption[]
  loadProfileOptions: SelectFieldOption[]
  targetSampleRateOptions: SelectFieldOption[]
  transcriptCorrectionModeOptions: SelectFieldOption[]
  targetChannelOptions: SelectFieldOption[]
  defaultChunkSeconds: number
  parseInteger: (value: string, fallback: number, min?: number) => number
  savingWhisperConfig: boolean
  saveWhisperRuntimeConfig: () => Promise<void>
}

export function WhisperConfigTab({
  t,
  fieldInputClassName,
  menuPortalTarget,
  whisperDraftPreset,
  whisperPresetKeys,
  applyWhisperPreset,
  whisperDraft,
  setWhisperDraft,
  llmConfig,
  setLLMConfig,
  whisperModelOptions,
  whisperLanguageOptions,
  computeTypeOptions,
  loadProfileOptions,
  targetSampleRateOptions,
  transcriptCorrectionModeOptions,
  targetChannelOptions,
  defaultChunkSeconds,
  parseInteger,
  savingWhisperConfig,
  saveWhisperRuntimeConfig,
}: WhisperConfigTabProps) {
  return (
    <TabsContent value="whisper" className="mx-auto w-full max-w-[1240px] space-y-5 px-1.5 md:px-5 lg:px-9">
      <section className="rounded-xl border border-border bg-surface-muted p-4">
        <div className="mb-3.5 flex flex-wrap items-start justify-between gap-2.5">
          <div>
            <PreText as="h3" variant="h3">
              {t('whisper.templates.title')}
            </PreText>
            <PreText variant="timestamp">{t('whisper.templates.description')}</PreText>
          </div>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-accent">
            {whisperDraftPreset === 'custom' ? t('whisper.templates.custom') : t(`whisper.templates.${whisperDraftPreset}.label`)}
          </span>
        </div>
        <div className="grid gap-2.5 md:grid-cols-3">
          {whisperPresetKeys.map((preset) => (
            <button
              key={preset}
              type="button"
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-all',
                whisperDraftPreset === preset
                  ? 'whisper-preset-active border-accent/75 bg-accent/14'
                  : 'border-border bg-bg-base hover:border-accent/40 hover:bg-accent/5',
              )}
              onClick={() => applyWhisperPreset(preset)}
            >
              <PreText variant="h3">{t(`whisper.templates.${preset}.label`)}</PreText>
              <PreText variant="timestamp">{t(`whisper.templates.${preset}.description`)}</PreText>
            </button>
          ))}
        </div>
        <PreText variant="timestamp" className="mt-2">
          {t('whisper.templates.customHint')}
        </PreText>
        <PreText variant="timestamp" className="mt-1 text-text-main/80">
          {t('whisper.templates.applyHint')}
        </PreText>
      </section>

      <div className="grid gap-3.5 md:grid-cols-2">
        <ConfigField
          label={t('whisper.fields.model.label')}
          inputHint={t('whisper.fields.model.inputHint')}
          explanation={t('whisper.fields.model.explanation')}
        >
          <SelectField
            value={whisperDraft.model_default}
            options={whisperModelOptions}
            onValueChange={(value) =>
              setWhisperDraft((prev) => ({
                ...prev,
                model_default: value as WhisperConfig['model_default'],
              }))
            }
            menuPortalTarget={menuPortalTarget}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.language.label')}
          inputHint={t('whisper.fields.language.inputHint')}
          explanation={t('whisper.fields.language.explanation')}
        >
          <SelectField
            value={whisperDraft.language}
            options={whisperLanguageOptions}
            onValueChange={(value) => setWhisperDraft((prev) => ({ ...prev, language: value }))}
            menuPortalTarget={menuPortalTarget}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.device.label')}
          inputHint={t('whisper.fields.device.inputHint')}
          explanation={t('whisper.fields.device.explanation')}
        >
          <input className={fieldInputClassName} value={whisperDraft.device || 'cuda'} readOnly placeholder={t('whisper.placeholders.device')} />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.computeType.label')}
          inputHint={t('whisper.fields.computeType.inputHint')}
          explanation={t('whisper.fields.computeType.explanation')}
        >
          <SelectField
            value={whisperDraft.compute_type}
            options={computeTypeOptions}
            onValueChange={(value) => setWhisperDraft((prev) => ({ ...prev, compute_type: value }))}
            menuPortalTarget={menuPortalTarget}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.modelLoadProfile.label')}
          inputHint={t('whisper.fields.modelLoadProfile.inputHint')}
          explanation={t('whisper.fields.modelLoadProfile.explanation')}
        >
          <SelectField
            value={whisperDraft.model_load_profile}
            options={loadProfileOptions}
            onValueChange={(value) =>
              setWhisperDraft((prev) => ({
                ...prev,
                model_load_profile: value as WhisperConfig['model_load_profile'],
              }))
            }
            menuPortalTarget={menuPortalTarget}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.beamSize.label')}
          inputHint={t('whisper.fields.beamSize.inputHint')}
          explanation={t('whisper.fields.beamSize.explanation')}
        >
          <input
            className={fieldInputClassName}
            type="number"
            value={whisperDraft.beam_size}
            onChange={(event) =>
              setWhisperDraft((prev) => ({
                ...prev,
                beam_size: parseInteger(event.target.value, 1, 1),
              }))
            }
            placeholder={t('whisper.placeholders.beamSize')}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.chunkSeconds.label')}
          inputHint={t('whisper.fields.chunkSeconds.inputHint')}
          explanation={t('whisper.fields.chunkSeconds.explanation')}
        >
          <input
            className={fieldInputClassName}
            type="number"
            value={whisperDraft.chunk_seconds}
            onChange={(event) =>
              setWhisperDraft((prev) => ({
                ...prev,
                chunk_seconds: parseInteger(event.target.value, defaultChunkSeconds, 30),
              }))
            }
            placeholder={t('whisper.placeholders.chunkSeconds')}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.sampleRate.label')}
          inputHint={t('whisper.fields.sampleRate.inputHint')}
          explanation={t('whisper.fields.sampleRate.explanation')}
        >
          <SelectField
            value={String(whisperDraft.target_sample_rate)}
            options={targetSampleRateOptions}
            onValueChange={(value) =>
              setWhisperDraft((prev) => ({
                ...prev,
                target_sample_rate: Number.parseInt(value, 10),
              }))
            }
            menuPortalTarget={menuPortalTarget}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.correctionMode.label')}
          inputHint={t('whisper.fields.correctionMode.inputHint')}
          explanation={t('whisper.fields.correctionMode.explanation')}
        >
          <SelectField
            value={llmConfig.correction_mode}
            options={transcriptCorrectionModeOptions}
            onValueChange={(value) =>
              setLLMConfig((prev) => ({
                ...prev,
                correction_mode: value as LLMConfig['correction_mode'],
              }))
            }
            menuPortalTarget={menuPortalTarget}
          />
        </ConfigField>

        <ConfigField
          label={t('whisper.fields.channels.label')}
          inputHint={t('whisper.fields.channels.inputHint')}
          explanation={t('whisper.fields.channels.explanation')}
        >
          <SelectField
            value={String(whisperDraft.target_channels)}
            options={targetChannelOptions}
            onValueChange={(value) =>
              setWhisperDraft((prev) => ({
                ...prev,
                target_channels: Number.parseInt(value, 10),
              }))
            }
            menuPortalTarget={menuPortalTarget}
          />
        </ConfigField>
      </div>

      <ConfigField
        label={t('whisper.fields.vadFilter.label')}
        inputHint={t('whisper.fields.vadFilter.inputHint')}
        explanation={t('whisper.fields.vadFilter.explanation')}
      >
        <div className="inline-flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm">
          <div className={cn('inline-flex items-center gap-1 text-xs', !whisperDraft.vad_filter ? 'text-text-main' : 'text-text-subtle')}>
            <span>{t('whisper.vadSwitch.off')}</span>
          </div>
          <Switch
            checked={whisperDraft.vad_filter}
            onCheckedChange={(checked) => setWhisperDraft((prev) => ({ ...prev, vad_filter: checked }))}
            aria-label={t('whisper.vadFilter')}
          />
          <div className={cn('inline-flex items-center gap-1 text-xs', whisperDraft.vad_filter ? 'text-text-main' : 'text-text-subtle')}>
            <span>{t('whisper.vadSwitch.on')}</span>
          </div>
        </div>
      </ConfigField>

      <Button className="w-full" variant="secondary" onClick={() => void saveWhisperRuntimeConfig()} disabled={savingWhisperConfig}>
        {savingWhisperConfig ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Settings className="mr-2 h-4 w-4" />}
        {t('whisper.save')}
      </Button>
    </TabsContent>
  )
}
