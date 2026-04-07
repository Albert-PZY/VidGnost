import type { Dispatch, SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import { Eye, EyeOff, LoaderCircle, Settings } from 'lucide-react'

import { PreText } from './pretext'
import { Button } from './ui/button'
import { TabsContent } from './ui/tabs'
import { ConfigField, SelectField, type SelectFieldOption } from './workbench-panels'
import { cn } from '../lib/utils'
import type { LLMConfig } from '../types'

interface LLMConfigTabProps {
  t: TFunction
  fieldInputClassName: string
  menuPortalTarget: HTMLElement | null
  llmConfig: LLMConfig
  setLLMConfig: Dispatch<SetStateAction<LLMConfig>>
  llmModeOptions: SelectFieldOption[]
  loadProfileOptions: SelectFieldOption[]
  showApiKey: boolean
  setShowApiKey: Dispatch<SetStateAction<boolean>>
  savingLlmConfig: boolean
  saveLlmConfig: () => Promise<void>
}

export function LLMConfigTab({
  t,
  fieldInputClassName,
  menuPortalTarget,
  llmConfig,
  setLLMConfig,
  llmModeOptions,
  loadProfileOptions,
  showApiKey,
  setShowApiKey,
  savingLlmConfig,
  saveLlmConfig,
}: LLMConfigTabProps) {
  return (
    <TabsContent
      value="llm"
      className="mx-auto w-full max-w-[1240px] space-y-5 px-1.5 md:px-5 lg:px-9"
    >
      <section className="rounded-xl border border-border bg-surface-muted p-4">
        <div className="mb-2.5">
          <PreText as="h3" variant="h3">
            在线 LLM 配置
          </PreText>
          <PreText variant="timestamp">本项目分析阶段仅使用在线 LLM API。</PreText>
        </div>

        <section className="rounded-lg border border-border/70 bg-bg-base px-3.5 py-3.5">
          <div className="mb-3.5">
            <PreText variant="h3">LLM API 配置</PreText>
            <PreText variant="timestamp">分析阶段固定通过在线 API 调用模型。</PreText>
          </div>
          <div className="grid gap-3.5 md:grid-cols-2">
            <ConfigField label="LLM 模式" inputHint="api" explanation="固定为在线模式。">
              <SelectField
                value={llmConfig.mode}
                options={llmModeOptions}
                onValueChange={(value) =>
                  setLLMConfig((prev) => ({ ...prev, mode: value as LLMConfig['mode'] }))
                }
                menuPortalTarget={menuPortalTarget}
              />
            </ConfigField>
            <ConfigField
              label="加载策略"
              inputHint="balanced / memory_first"
              explanation="影响运行期资源释放节奏。"
            >
              <SelectField
                value={llmConfig.load_profile}
                options={loadProfileOptions}
                onValueChange={(value) =>
                  setLLMConfig((prev) => ({
                    ...prev,
                    load_profile: value as LLMConfig['load_profile'],
                  }))
                }
                menuPortalTarget={menuPortalTarget}
              />
            </ConfigField>
            <ConfigField
              label={t('llm.fields.baseUrl')}
              inputHint="OpenAI Compatible URL"
              explanation={t('llm.fields.baseUrlHelper')}
            >
              <input
                className={fieldInputClassName}
                value={llmConfig.base_url}
                onChange={(event) =>
                  setLLMConfig((prev) => ({ ...prev, base_url: event.target.value }))
                }
                placeholder={t('llm.placeholders.baseUrl')}
              />
            </ConfigField>
            <ConfigField
              label={t('llm.fields.model')}
              inputHint="模型名"
              explanation={t('llm.fields.modelHelper')}
            >
              <input
                className={fieldInputClassName}
                value={llmConfig.model}
                onChange={(event) =>
                  setLLMConfig((prev) => ({ ...prev, model: event.target.value }))
                }
                placeholder={t('llm.placeholders.model')}
              />
            </ConfigField>
            <div className="md:col-span-2">
              <ConfigField
                label={t('llm.fields.apiKey')}
                inputHint="Secret"
                explanation={t('llm.fields.apiKeyHelper')}
              >
                <div className="relative">
                  <input
                    className={cn(fieldInputClassName, 'pr-11')}
                    type={showApiKey ? 'text' : 'password'}
                    value={llmConfig.api_key}
                    onChange={(event) =>
                      setLLMConfig((prev) => ({ ...prev, api_key: event.target.value }))
                    }
                    placeholder={t('llm.placeholders.apiKey')}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md border border-border/70 bg-surface-muted/80 text-text-subtle transition-colors hover:text-text-main"
                    onClick={() => setShowApiKey((prev) => !prev)}
                    aria-label={showApiKey ? t('llm.hideSecret') : t('llm.showSecret')}
                    title={showApiKey ? t('llm.hideSecret') : t('llm.showSecret')}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </ConfigField>
            </div>
          </div>
        </section>

        <Button
          className="mt-4 w-full"
          variant="secondary"
          onClick={() => void saveLlmConfig()}
          disabled={savingLlmConfig}
        >
          {savingLlmConfig ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Settings className="mr-2 h-4 w-4" />
          )}
          保存运行配置
        </Button>
      </section>
    </TabsContent>
  )
}
