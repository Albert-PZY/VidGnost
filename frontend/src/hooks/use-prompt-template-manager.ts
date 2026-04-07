import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import toast from 'react-hot-toast'

import {
  createPromptTemplate,
  deletePromptTemplate,
  updatePromptTemplate,
  updatePromptTemplateSelection,
} from '../lib/api'
import type { PromptTemplateBundle, PromptTemplateChannel, PromptTemplateItem } from '../types'

export type PromptTemplateDraft = {
  templateId: string | null
  name: string
  content: string
  isNew: boolean
}

type PendingPromptDelete = {
  channel: PromptTemplateChannel
  templateId: string
  name: string
}

interface UsePromptTemplateManagerOptions {
  t: TFunction
  setError: (message: string | null) => void
}

function createEmptyPromptTemplateBundle(): PromptTemplateBundle {
  return {
    summary_templates: [],
    mindmap_templates: [],
    selected_summary_template_id: '',
    selected_mindmap_template_id: '',
  }
}

function createEmptyPromptTemplateDraft(): PromptTemplateDraft {
  return {
    templateId: null,
    name: '',
    content: '',
    isNew: false,
  }
}

function getChannelTemplates(bundle: PromptTemplateBundle, channel: PromptTemplateChannel): PromptTemplateItem[] {
  return channel === 'summary' ? bundle.summary_templates : bundle.mindmap_templates
}

function getSelectedTemplateId(bundle: PromptTemplateBundle, channel: PromptTemplateChannel): string {
  return channel === 'summary' ? bundle.selected_summary_template_id : bundle.selected_mindmap_template_id
}

function findTemplateById(
  bundle: PromptTemplateBundle,
  channel: PromptTemplateChannel,
  templateId: string,
): PromptTemplateItem | null {
  return getChannelTemplates(bundle, channel).find((item) => item.id === templateId) ?? null
}

function buildDraftFromTemplate(template: PromptTemplateItem | null): PromptTemplateDraft {
  if (!template) {
    return createEmptyPromptTemplateDraft()
  }
  return {
    templateId: template.id,
    name: template.name,
    content: template.content,
    isNew: false,
  }
}

function isReadonlyDefaultPromptTemplate(template: PromptTemplateItem | null, isNewDraft: boolean): boolean {
  return !isNewDraft && Boolean(template?.is_default)
}

async function copyTextToClipboard(value: string): Promise<void> {
  const text = value ?? ''
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function usePromptTemplateManager({ t, setError }: UsePromptTemplateManagerOptions) {
  const promptTemplateCopyTimerRef = useRef<number | null>(null)
  const [promptTemplateBundle, setPromptTemplateBundle] = useState<PromptTemplateBundle>(createEmptyPromptTemplateBundle)
  const [promptDrafts, setPromptDrafts] = useState<Record<PromptTemplateChannel, PromptTemplateDraft>>({
    summary: createEmptyPromptTemplateDraft(),
    mindmap: createEmptyPromptTemplateDraft(),
  })
  const [promptActionChannel, setPromptActionChannel] = useState<PromptTemplateChannel | null>(null)
  const [pendingPromptDelete, setPendingPromptDelete] = useState<PendingPromptDelete | null>(null)
  const [promptTemplateView, setPromptTemplateView] = useState<PromptTemplateChannel>('summary')
  const [copiedPromptTemplateId, setCopiedPromptTemplateId] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (promptTemplateCopyTimerRef.current !== null) {
        window.clearTimeout(promptTemplateCopyTimerRef.current)
      }
    }
  }, [])

  const activePromptTemplates = useMemo(
    () => getChannelTemplates(promptTemplateBundle, promptTemplateView),
    [promptTemplateBundle, promptTemplateView],
  )
  const selectedPromptTemplateId = useMemo(
    () => getSelectedTemplateId(promptTemplateBundle, promptTemplateView),
    [promptTemplateBundle, promptTemplateView],
  )
  const activePromptDraft = promptDrafts[promptTemplateView]
  const activePromptTemplate = useMemo(
    () =>
      activePromptDraft.templateId
        ? findTemplateById(promptTemplateBundle, promptTemplateView, activePromptDraft.templateId)
        : null,
    [activePromptDraft.templateId, promptTemplateBundle, promptTemplateView],
  )
  const promptDraftReadonly = isReadonlyDefaultPromptTemplate(activePromptTemplate, activePromptDraft.isNew)

  const applyPromptTemplateBundle = useCallback((bundle: PromptTemplateBundle) => {
    setPromptTemplateBundle(bundle)
    setPromptDrafts({
      summary: buildDraftFromTemplate(
        findTemplateById(bundle, 'summary', bundle.selected_summary_template_id),
      ),
      mindmap: buildDraftFromTemplate(
        findTemplateById(bundle, 'mindmap', bundle.selected_mindmap_template_id),
      ),
    })
  }, [])

  const beginCreatePromptTemplate = useCallback((channel: PromptTemplateChannel) => {
    const prefix = t('llm.promptTemplates.autoNamePrefix')
    const index = getChannelTemplates(promptTemplateBundle, channel).length + 1
    setPromptDrafts((prev) => ({
      ...prev,
      [channel]: {
        templateId: null,
        name: `${prefix}${index}`,
        content: '',
        isNew: true,
      },
    }))
  }, [promptTemplateBundle, t])

  const selectTemplateDraft = useCallback((template: PromptTemplateItem) => {
    setPromptDrafts((prev) => ({
      ...prev,
      [promptTemplateView]: buildDraftFromTemplate(template),
    }))
  }, [promptTemplateView])

  const updatePromptDraft = useCallback((
    channel: PromptTemplateChannel,
    patch: Partial<Pick<PromptTemplateDraft, 'name' | 'content'>>,
  ) => {
    setPromptDrafts((prev) => ({
      ...prev,
      [channel]: {
        ...prev[channel],
        ...patch,
      },
    }))
  }, [])

  const resetPromptDraft = useCallback((channel: PromptTemplateChannel) => {
    const selectedId = getSelectedTemplateId(promptTemplateBundle, channel)
    const selectedTemplate = selectedId ? findTemplateById(promptTemplateBundle, channel, selectedId) : null
    setPromptDrafts((prev) => ({
      ...prev,
      [channel]: buildDraftFromTemplate(selectedTemplate),
    }))
  }, [promptTemplateBundle])

  const switchPromptTemplate = useCallback(async (channel: PromptTemplateChannel, templateId: string) => {
    if (!templateId) return
    const nextSelection = {
      selected_summary_template_id:
        channel === 'summary' ? templateId : promptTemplateBundle.selected_summary_template_id,
      selected_mindmap_template_id:
        channel === 'mindmap' ? templateId : promptTemplateBundle.selected_mindmap_template_id,
    }

    setPromptActionChannel(channel)
    setError(null)
    try {
      const bundle = await updatePromptTemplateSelection(nextSelection)
      applyPromptTemplateBundle(bundle)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.updatePromptTemplateSelectionFailed')
      setError(message)
      toast.error(message)
    } finally {
      setPromptActionChannel(null)
    }
  }, [applyPromptTemplateBundle, promptTemplateBundle.selected_mindmap_template_id, promptTemplateBundle.selected_summary_template_id, setError, t])

  const copyPromptTemplateContent = useCallback(async (templateId: string, content: string) => {
    try {
      await copyTextToClipboard(content)
      setCopiedPromptTemplateId(templateId)
      if (promptTemplateCopyTimerRef.current !== null) {
        window.clearTimeout(promptTemplateCopyTimerRef.current)
      }
      promptTemplateCopyTimerRef.current = window.setTimeout(() => {
        setCopiedPromptTemplateId((prev) => (prev === templateId ? null : prev))
        promptTemplateCopyTimerRef.current = null
      }, 1800)
      toast.success(t('llm.promptTemplates.copySuccess'))
    } catch {
      toast.error(t('llm.promptTemplates.copyFailed'))
    }
  }, [t])

  const savePromptTemplate = useCallback(async (channel: PromptTemplateChannel) => {
    const draft = promptDrafts[channel]
    const draftTemplate = draft.templateId ? findTemplateById(promptTemplateBundle, channel, draft.templateId) : null
    if (isReadonlyDefaultPromptTemplate(draftTemplate, draft.isNew)) {
      const message = t('errors.defaultPromptTemplateReadonly')
      setError(message)
      toast.error(message)
      return
    }
    let name = draft.name.trim()
    const content = draft.content.trim()
    if (!content) {
      const message = t('errors.promptTemplateContentRequired')
      setError(message)
      toast.error(message)
      return
    }
    if (!name) {
      if (draft.templateId) {
        const existing = findTemplateById(promptTemplateBundle, channel, draft.templateId)
        name = existing?.name?.trim() ?? ''
      } else {
        const prefix = t('llm.promptTemplates.autoNamePrefix')
        name = `${prefix}${Date.now().toString().slice(-4)}`
      }
    }
    if (!name) {
      const message = t('errors.promptTemplateNameRequired')
      setError(message)
      toast.error(message)
      return
    }

    setPromptActionChannel(channel)
    setError(null)
    try {
      let bundle: PromptTemplateBundle
      if (draft.isNew || !draft.templateId) {
        bundle = await createPromptTemplate({ channel, name, content })
        const templates = getChannelTemplates(bundle, channel)
        const latest = templates[templates.length - 1]
        if (latest) {
          bundle = await updatePromptTemplateSelection({
            selected_summary_template_id:
              channel === 'summary'
                ? latest.id
                : bundle.selected_summary_template_id,
            selected_mindmap_template_id:
              channel === 'mindmap'
                ? latest.id
                : bundle.selected_mindmap_template_id,
          })
        }
        toast.success(t('llm.promptTemplates.createSuccess'))
      } else {
        bundle = await updatePromptTemplate({
          template_id: draft.templateId,
          name,
          content,
        })
        toast.success(t('llm.promptTemplates.updateSuccess'))
      }
      applyPromptTemplateBundle(bundle)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.savePromptTemplateFailed')
      setError(message)
      toast.error(message)
    } finally {
      setPromptActionChannel(null)
    }
  }, [applyPromptTemplateBundle, promptDrafts, promptTemplateBundle, setError, t])

  const requestDeletePromptTemplate = useCallback((channel: PromptTemplateChannel, templateId?: string) => {
    const targetId = templateId ?? getSelectedTemplateId(promptTemplateBundle, channel)
    if (!targetId) return
    const selectedTemplate = findTemplateById(promptTemplateBundle, channel, targetId)
    if (!selectedTemplate) return
    if (selectedTemplate.is_default) {
      const message = t('errors.defaultPromptTemplateReadonly')
      setError(message)
      toast.error(message)
      return
    }
    setPendingPromptDelete({
      channel,
      templateId: selectedTemplate.id,
      name: selectedTemplate.name,
    })
  }, [promptTemplateBundle, setError, t])

  const closePromptDeleteConfirm = useCallback(() => {
    if (pendingPromptDelete && promptActionChannel === pendingPromptDelete.channel) return
    setPendingPromptDelete(null)
  }, [pendingPromptDelete, promptActionChannel])

  const removePromptTemplate = useCallback(async () => {
    if (!pendingPromptDelete) return
    const { templateId, channel } = pendingPromptDelete
    setPromptActionChannel(channel)
    setError(null)
    try {
      const bundle = await deletePromptTemplate(templateId)
      applyPromptTemplateBundle(bundle)
      setPendingPromptDelete(null)
      toast.success(t('llm.promptTemplates.deleteSuccess'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('errors.deletePromptTemplateFailed')
      setError(message)
      toast.error(message)
    } finally {
      setPromptActionChannel(null)
    }
  }, [applyPromptTemplateBundle, pendingPromptDelete, setError, t])

  return {
    promptTemplateBundle,
    promptTemplateView,
    setPromptTemplateView,
    activePromptTemplates,
    activePromptDraft,
    selectedPromptTemplateId,
    promptDraftReadonly,
    copiedPromptTemplateId,
    promptActionChannel,
    pendingPromptDelete,
    applyPromptTemplateBundle,
    beginCreatePromptTemplate,
    selectTemplateDraft,
    copyPromptTemplateContent,
    requestDeletePromptTemplate,
    updatePromptDraft,
    resetPromptDraft,
    savePromptTemplate,
    switchPromptTemplate,
    closePromptDeleteConfirm,
    removePromptTemplate,
  }
}
