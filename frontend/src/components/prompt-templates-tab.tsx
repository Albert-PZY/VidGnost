import { Suspense, lazy } from 'react'
import type { TFunction } from 'i18next'
import { Check, Copy, FileText, GitBranch, LoaderCircle, Plus, Trash2 } from 'lucide-react'

import { PreText } from './pretext'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { cn } from '../lib/utils'
import type { PromptTemplateChannel, PromptTemplateItem } from '../types'

const LazyPromptMarkdownEditor = lazy(async () => {
  const module = await import('@uiw/react-md-editor')
  return { default: module.default }
})

interface PromptTemplateDraft {
  templateId: string | null
  name: string
  content: string
  isNew: boolean
}

interface PromptTemplatesTabProps {
  t: TFunction
  isDark: boolean
  fieldInputClassName: string
  promptTemplateView: PromptTemplateChannel
  setPromptTemplateView: (channel: PromptTemplateChannel) => void
  activePromptTemplates: PromptTemplateItem[]
  activePromptDraft: PromptTemplateDraft
  selectedPromptTemplateId: string
  promptDraftReadonly: boolean
  copiedPromptTemplateId: string | null
  promptActionChannel: PromptTemplateChannel | null
  beginCreatePromptTemplate: (channel: PromptTemplateChannel) => void
  selectTemplateDraft: (template: PromptTemplateItem) => void
  copyPromptTemplateContent: (templateId: string, content: string) => Promise<void>
  requestDeletePromptTemplate: (channel: PromptTemplateChannel, templateId?: string) => void
  updatePromptDraft: (channel: PromptTemplateChannel, patch: Partial<Pick<PromptTemplateDraft, 'name' | 'content'>>) => void
  resetPromptDraft: (channel: PromptTemplateChannel) => void
  savePromptTemplate: (channel: PromptTemplateChannel) => Promise<void>
  switchPromptTemplate: (channel: PromptTemplateChannel, templateId: string) => Promise<void>
}

export function PromptTemplatesTab({
  t,
  isDark,
  fieldInputClassName,
  promptTemplateView,
  setPromptTemplateView,
  activePromptTemplates,
  activePromptDraft,
  selectedPromptTemplateId,
  promptDraftReadonly,
  copiedPromptTemplateId,
  promptActionChannel,
  beginCreatePromptTemplate,
  selectTemplateDraft,
  copyPromptTemplateContent,
  requestDeletePromptTemplate,
  updatePromptDraft,
  resetPromptDraft,
  savePromptTemplate,
  switchPromptTemplate,
}: PromptTemplatesTabProps) {
  return (
    <TabsContent value="prompts" className="prompt-templates-pane space-y-4">
      <section className="rounded-xl border border-border bg-surface-muted/70 p-4">
        <Tabs
          value={promptTemplateView}
          onValueChange={(value) => setPromptTemplateView(value as PromptTemplateChannel)}
          className="mt-1"
        >
          <TabsList className="w-full">
            <TabsTrigger value="summary" className="flex-1 gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              {t('llm.promptTemplates.summary.title')}
            </TabsTrigger>
            <TabsTrigger value="mindmap" className="flex-1 gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              {t('llm.promptTemplates.mindmap.title')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => beginCreatePromptTemplate(promptTemplateView)}
            disabled={promptActionChannel === promptTemplateView}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('llm.promptTemplates.newAction')}
          </Button>
        </div>

        <div className="mt-4 grid gap-[1.125rem] lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[272px_minmax(0,1fr)]">
          <div className="prompt-template-list max-h-[560px] space-y-2.5 overflow-y-scroll overflow-x-hidden pr-2">
            {activePromptTemplates.map((template) => (
              <div
                key={template.id}
                role="button"
                tabIndex={promptActionChannel === promptTemplateView ? -1 : 0}
                aria-disabled={promptActionChannel === promptTemplateView}
                onClick={() => {
                  if (promptActionChannel === promptTemplateView) return
                  selectTemplateDraft(template)
                }}
                onKeyDown={(event) => {
                  if (promptActionChannel === promptTemplateView) return
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectTemplateDraft(template)
                  }
                }}
                className={cn(
                  'group relative block w-full cursor-pointer rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
                  promptActionChannel === promptTemplateView && 'cursor-not-allowed opacity-70',
                  template.id === activePromptDraft.templateId
                    ? 'border-border bg-bg-base'
                    : 'border-accent/60 bg-accent/10 hover:border-accent/40',
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <PreText variant="h3" className="line-clamp-1">
                    {template.name}
                  </PreText>
                  <div
                    className={cn(
                      'flex items-center gap-1 transition-opacity',
                      template.id === activePromptDraft.templateId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(event) => {
                        event.stopPropagation()
                        void copyPromptTemplateContent(template.id, template.content)
                      }}
                      title={t('llm.promptTemplates.copyAction')}
                    >
                      {copiedPromptTemplateId === template.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-text-subtle hover:text-red-500"
                      onClick={(event) => {
                        event.stopPropagation()
                        requestDeletePromptTemplate(promptTemplateView, template.id)
                      }}
                      disabled={
                        template.is_default ||
                        promptActionChannel === promptTemplateView ||
                        activePromptTemplates.length <= 1
                      }
                      title={t('llm.promptTemplates.deleteAction')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <PreText variant="timestamp" className="line-clamp-5 leading-relaxed">
                  {template.content}
                </PreText>
                {template.id === selectedPromptTemplateId && (
                  <span className="mt-2 inline-flex rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                    {t('llm.promptTemplates.selectedBadge')}
                  </span>
                )}
                {template.is_default && (
                  <span className="ml-1 mt-2 inline-flex rounded-full border border-border/85 bg-surface-muted px-2 py-0.5 text-[11px] text-text-subtle">
                    {t('llm.promptTemplates.defaultBadge')}
                  </span>
                )}
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-border/70 bg-bg-base/85 p-[1.125rem] shadow-[0_14px_38px_-28px_rgba(15,23,42,0.7)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <PreText as="h3" variant="h3">
                {activePromptDraft.isNew ? t('llm.promptTemplates.createTitle') : t('llm.promptTemplates.editTitle')}
              </PreText>
              {!activePromptDraft.isNew && activePromptDraft.templateId === selectedPromptTemplateId && (
                <span className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                  {t('llm.promptTemplates.selectedBadge')}
                </span>
              )}
            </div>
            {promptDraftReadonly && (
              <PreText variant="timestamp" className="mb-3 rounded-lg border border-border/70 bg-surface-muted/70 px-3 py-2">
                {t('llm.promptTemplates.readonlyHint')}
              </PreText>
            )}
            <div className="mb-3 grid gap-2 md:grid-cols-[96px_minmax(0,1fr)] md:items-center">
              <span className="text-xs font-medium text-text-subtle">{t('llm.promptTemplates.nameLabel')}</span>
              <input
                className={fieldInputClassName}
                value={activePromptDraft.name}
                onChange={(event) => updatePromptDraft(promptTemplateView, { name: event.target.value })}
                placeholder={
                  promptTemplateView === 'summary'
                    ? t('llm.placeholders.summaryPromptName')
                    : t('llm.placeholders.mindmapPromptName')
                }
                disabled={promptActionChannel === promptTemplateView || promptDraftReadonly}
              />
            </div>
            <div className="prompt-markdown-editor" data-color-mode={isDark ? 'dark' : 'light'}>
              <Suspense
                fallback={(
                  <div className="flex h-[500px] items-center justify-center rounded-xl border border-border/70 bg-surface-muted/70 text-text-subtle">
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  </div>
                )}
              >
                <LazyPromptMarkdownEditor
                  value={activePromptDraft.content}
                  onChange={(value) => {
                    if (promptActionChannel === promptTemplateView || promptDraftReadonly) return
                    updatePromptDraft(promptTemplateView, { content: value ?? '' })
                  }}
                  preview="live"
                  height={500}
                  visibleDragbar={false}
                  textareaProps={{
                    placeholder:
                      promptTemplateView === 'summary'
                        ? t('llm.placeholders.summaryPromptCustom')
                        : t('llm.placeholders.mindmapPromptCustom'),
                    readOnly: promptActionChannel === promptTemplateView || promptDraftReadonly,
                  }}
                />
              </Suspense>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {activePromptDraft.isNew && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => resetPromptDraft(promptTemplateView)}
                  disabled={promptActionChannel === promptTemplateView || promptDraftReadonly}
                >
                  {t('history.actions.cancel')}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void savePromptTemplate(promptTemplateView)}
                disabled={promptActionChannel === promptTemplateView || promptDraftReadonly}
              >
                {promptActionChannel === promptTemplateView ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('llm.promptTemplates.saveAction')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-red-500 text-white hover:brightness-95"
                onClick={() => requestDeletePromptTemplate(promptTemplateView)}
                disabled={
                  promptDraftReadonly ||
                  promptActionChannel === promptTemplateView ||
                  activePromptTemplates.length <= 1
                }
              >
                {t('llm.promptTemplates.deleteAction')}
              </Button>
              {!activePromptDraft.isNew &&
                activePromptDraft.templateId &&
                activePromptDraft.templateId !== selectedPromptTemplateId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void switchPromptTemplate(promptTemplateView, String(activePromptDraft.templateId))}
                    disabled={promptActionChannel === promptTemplateView}
                  >
                    {t('llm.promptTemplates.activateAction')}
                  </Button>
                )}
            </div>
          </section>
        </div>
      </section>
    </TabsContent>
  )
}
