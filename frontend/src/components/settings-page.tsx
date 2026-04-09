import type { ComponentProps } from 'react'
import type { TFunction } from 'i18next'

import { LocalModelsConfigTab } from './local-models-config-tab'
import { PreText } from './pretext'
import { PromptTemplatesTab } from './prompt-templates-tab'
import { WhisperConfigTab } from './whisper-config-tab'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'

type SettingsTabKey = 'localModels' | 'whisper' | 'prompts'

interface SettingsPageProps {
  t: TFunction
  configTab: SettingsTabKey
  setConfigTab: (tab: SettingsTabKey) => void
  promptTemplatesTabProps: ComponentProps<typeof PromptTemplatesTab>
  whisperConfigTabProps: ComponentProps<typeof WhisperConfigTab>
  localModelsConfigTabProps: ComponentProps<typeof LocalModelsConfigTab>
}

export function SettingsPage({
  t,
  configTab,
  setConfigTab,
  promptTemplatesTabProps,
  whisperConfigTabProps,
  localModelsConfigTabProps,
}: SettingsPageProps) {
  return (
    <main className="w-full px-3 py-3.5 md:px-4 md:py-[1.125rem]">
      <section className="workbench-runtime-card p-4 md:p-5">
        <div className="mb-4 rounded-2xl border border-border/70 bg-surface-muted/45 px-4 py-3">
          <PreText as="h2" variant="h2" className="tracking-[0.01em]">
            {t('config.page.title', { defaultValue: '设置中心' })}
          </PreText>
          <PreText variant="timestamp" className="mt-1">
            {t('config.page.description', { defaultValue: '所有运行相关配置统一集中在此页面，按模块分栏管理。' })}
          </PreText>
        </div>

        <Tabs value={configTab} onValueChange={(value) => setConfigTab(value as SettingsTabKey)} className="flex min-h-0 flex-col">
          <div className="shrink-0 border-b border-border/60 bg-surface-elevated/92 px-2 py-3 md:px-3">
            <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-border/70 bg-surface-muted/88 p-1">
              <TabsTrigger value="localModels">{t('config.tabs.localModels', { defaultValue: '在线 LLM' })}</TabsTrigger>
              <TabsTrigger value="whisper">{t('config.tabs.whisper', { defaultValue: 'Faster-Whisper' })}</TabsTrigger>
              <TabsTrigger value="prompts">{t('config.tabs.prompts', { defaultValue: '提示词模板' })}</TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 py-3 md:px-3 md:py-4">
            <PromptTemplatesTab {...promptTemplatesTabProps} />
            <WhisperConfigTab {...whisperConfigTabProps} />
            <LocalModelsConfigTab {...localModelsConfigTabProps} />
          </div>
        </Tabs>
      </section>
    </main>
  )
}
