import type { ComponentProps } from 'react'
import type { TFunction } from 'i18next'

import { LLMConfigTab } from './llm-config-tab'
import { PromptTemplatesTab } from './prompt-templates-tab'
import { WhisperConfigTab } from './whisper-config-tab'
import { ModalPanel } from './workbench-panels'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'

type ConfigTabKey = 'llm' | 'whisper' | 'prompts'

interface WorkbenchConfigModalProps {
  open: boolean
  onClose: () => void
  t: TFunction
  configTab: ConfigTabKey
  setConfigTab: (tab: ConfigTabKey) => void
  promptTemplatesTabProps: ComponentProps<typeof PromptTemplatesTab>
  whisperConfigTabProps: ComponentProps<typeof WhisperConfigTab>
  llmConfigTabProps: ComponentProps<typeof LLMConfigTab>
}

export function WorkbenchConfigModal({
  open,
  onClose,
  t,
  configTab,
  setConfigTab,
  promptTemplatesTabProps,
  whisperConfigTabProps,
  llmConfigTabProps,
}: WorkbenchConfigModalProps) {
  return (
    <ModalPanel
      open={open}
      title={t('config.modal.title')}
      description={t('config.modal.description')}
      onClose={onClose}
      panelClassName="max-w-[min(1520px,96vw)]"
      bodyClassName="!overflow-hidden !px-0 !py-0 md:!px-0 md:!py-0"
    >
      <Tabs value={configTab} onValueChange={(value) => setConfigTab(value as ConfigTabKey)} className="flex h-[80vh] min-h-0 flex-col">
        <div className="shrink-0 border-b border-border/60 bg-surface-elevated/92 px-5 py-3 md:px-7">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-border/70 bg-surface-muted/88 p-1">
            <TabsTrigger value="llm">{t('config.tabs.llm', { defaultValue: '在线 LLM' })}</TabsTrigger>
            <TabsTrigger value="whisper">{t('config.tabs.whisper')}</TabsTrigger>
            <TabsTrigger value="prompts">{t('config.tabs.prompts')}</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-7 md:py-5">
          <PromptTemplatesTab {...promptTemplatesTabProps} />
          <WhisperConfigTab {...whisperConfigTabProps} />
          <LLMConfigTab {...llmConfigTabProps} />
        </div>
      </Tabs>
    </ModalPanel>
  )
}
