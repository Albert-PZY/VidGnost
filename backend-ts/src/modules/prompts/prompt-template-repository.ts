import path from "node:path"

import type {
  PromptTemplateBundleResponse,
  PromptTemplateChannel,
  PromptTemplateCreateRequest,
  PromptTemplateItem,
  PromptTemplateSelection,
  PromptTemplateSelectionUpdateRequest,
  PromptTemplateUpdateRequest,
} from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"
import { generateTimeKey } from "../../core/id.js"
import { DEFAULT_TEMPLATE_CONTENT, DEFAULT_TEMPLATE_IDS, DEFAULT_TEMPLATE_NAMES } from "./default-prompts.js"

const ALL_CHANNELS: PromptTemplateChannel[] = ["correction", "notes", "mindmap", "vqa"]

interface StoredPromptTemplate {
  id: string
  channel: PromptTemplateChannel
  name: string
  content: string
  created_at: string
  updated_at: string
}

interface StoredPromptSelection {
  correction_template_id: string
  notes_template_id: string
  mindmap_template_id: string
  vqa_template_id: string
  created_at: string
  updated_at: string
}

export class PromptTemplateRepository {
  readonly #templatesDir: string
  readonly #selectionPath: string

  constructor(config: AppConfig) {
    const promptsRoot = path.join(config.storageDir, "prompts")
    this.#templatesDir = path.join(promptsRoot, "templates")
    this.#selectionPath = path.join(promptsRoot, "selection.json")
  }

  async getBundle(): Promise<PromptTemplateBundleResponse> {
    const { templates, selection } = await this.#loadState()
    return buildBundle(templates, selection)
  }

  async createTemplate(payload: PromptTemplateCreateRequest): Promise<PromptTemplateBundleResponse> {
    const { templates, selection } = await this.#loadState()
    const now = new Date().toISOString()
    const nextTemplate: StoredPromptTemplate = {
      id: generateTimeKey(`${payload.channel}-template`, (candidate) => templates.some((item) => item.id === candidate)),
      channel: payload.channel,
      name: payload.name.trim(),
      content: payload.content.trim(),
      created_at: now,
      updated_at: now,
    }
    templates.push(nextTemplate)
    await this.#writeState(templates, selection)
    return buildBundle(templates, selection)
  }

  async updateTemplate(templateId: string, payload: PromptTemplateUpdateRequest): Promise<PromptTemplateBundleResponse> {
    const { templates, selection } = await this.#loadState()
    const target = templates.find((item) => item.id === templateId)
    if (!target) {
      throw new Error("Template not found")
    }
    if (isDefaultTemplate(target.id)) {
      throw new Error("Default template is read-only")
    }
    target.name = payload.name.trim()
    target.content = payload.content.trim()
    target.updated_at = new Date().toISOString()
    await this.#writeState(templates, selection)
    return buildBundle(templates, selection)
  }

  async deleteTemplate(templateId: string): Promise<PromptTemplateBundleResponse> {
    const { templates, selection } = await this.#loadState()
    const target = templates.find((item) => item.id === templateId)
    if (!target) {
      throw new Error("Template not found")
    }
    if (isDefaultTemplate(target.id)) {
      throw new Error("Default template is read-only")
    }
    if (templates.filter((item) => item.channel === target.channel).length <= 1) {
      throw new Error("At least one template must remain in this channel")
    }

    const nextTemplates = templates.filter((item) => item.id !== templateId)
    const repairedSelection = repairSelection(selection, nextTemplates)
    await this.#writeState(nextTemplates, repairedSelection.selection)
    return buildBundle(nextTemplates, repairedSelection.selection)
  }

  async updateSelection(payload: PromptTemplateSelectionUpdateRequest): Promise<PromptTemplateBundleResponse> {
    const { templates, selection } = await this.#loadState()
    const templateIds = new Set(templates.map((item) => item.id))

    for (const channel of ALL_CHANNELS) {
      const nextId = payload[channel]
      if (!nextId) {
        continue
      }
      if (!templateIds.has(nextId)) {
        throw new Error(`Invalid template id for channel ${channel}: ${nextId}`)
      }
      if (channel === "correction") {
        selection.correction_template_id = nextId
      } else if (channel === "notes") {
        selection.notes_template_id = nextId
      } else if (channel === "mindmap") {
        selection.mindmap_template_id = nextId
      } else {
        selection.vqa_template_id = nextId
      }
    }

    selection.updated_at = new Date().toISOString()
    const repairedSelection = repairSelection(selection, templates)
    await this.#writeState(templates, repairedSelection.selection)
    return buildBundle(templates, repairedSelection.selection)
  }

  async #loadState(): Promise<{ templates: StoredPromptTemplate[]; selection: StoredPromptSelection }> {
    const templates = await this.#loadTemplates()
    const templateState = ensureDefaultTemplates(templates)
    const selectionState = repairSelection(await this.#loadSelection(), templateState.templates)
    if (templateState.changed || selectionState.changed) {
      await this.#writeState(templateState.templates, selectionState.selection)
    }
    return {
      templates: templateState.templates,
      selection: selectionState.selection,
    }
  }

  async #loadTemplates(): Promise<StoredPromptTemplate[]> {
    const templates: StoredPromptTemplate[] = []
    for (const channel of ALL_CHANNELS) {
      void channel
    }
    if (!(await pathExists(this.#templatesDir))) {
      return []
    }

    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(this.#templatesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue
      }
      const template = await readJsonFile<StoredPromptTemplate | null>(path.join(this.#templatesDir, entry.name), null)
      if (!template || !ALL_CHANNELS.includes(template.channel)) {
        continue
      }
      templates.push({
        ...template,
        name: template.name.trim(),
        content: template.content.trim(),
      })
    }
    return templates.sort((left, right) => `${left.created_at}:${left.id}`.localeCompare(`${right.created_at}:${right.id}`))
  }

  async #loadSelection(): Promise<StoredPromptSelection> {
    const now = new Date().toISOString()
    return readJsonFile<StoredPromptSelection>(this.#selectionPath, {
      correction_template_id: DEFAULT_TEMPLATE_IDS.correction,
      notes_template_id: DEFAULT_TEMPLATE_IDS.notes,
      mindmap_template_id: DEFAULT_TEMPLATE_IDS.mindmap,
      vqa_template_id: DEFAULT_TEMPLATE_IDS.vqa,
      created_at: now,
      updated_at: now,
    })
  }

  async #writeState(templates: StoredPromptTemplate[], selection: StoredPromptSelection): Promise<void> {
    const { mkdir, readdir, rm } = await import("node:fs/promises")
    await mkdir(this.#templatesDir, { recursive: true })

    const keepIds = new Set<string>()
    for (const template of templates) {
      keepIds.add(template.id)
      await writeJsonFile(path.join(this.#templatesDir, `${template.id}.json`), template)
    }

    if (await pathExists(this.#templatesDir)) {
      const existingFiles = await readdir(this.#templatesDir)
      for (const fileName of existingFiles) {
        if (!fileName.endsWith(".json")) {
          continue
        }
        const templateId = fileName.slice(0, -5)
        if (keepIds.has(templateId)) {
          continue
        }
        await rm(path.join(this.#templatesDir, fileName), { force: true })
      }
    }

    await writeJsonFile(this.#selectionPath, selection)
  }
}

function ensureDefaultTemplates(templates: StoredPromptTemplate[]): { templates: StoredPromptTemplate[]; changed: boolean } {
  const nextTemplates = [...templates]
  const now = new Date().toISOString()
  let changed = false
  for (const channel of ALL_CHANNELS) {
    const defaultId = DEFAULT_TEMPLATE_IDS[channel]
    const existing = nextTemplates.find((item) => item.id === defaultId)
    if (existing) {
      existing.channel = channel
      if (existing.name !== DEFAULT_TEMPLATE_NAMES[channel] || existing.content !== DEFAULT_TEMPLATE_CONTENT[channel]) {
        existing.name = DEFAULT_TEMPLATE_NAMES[channel]
        existing.content = DEFAULT_TEMPLATE_CONTENT[channel]
        existing.updated_at = now
        changed = true
      }
      if (!existing.created_at) {
        existing.created_at = now
        changed = true
      }
      continue
    }

    nextTemplates.push({
      id: defaultId,
      channel,
      name: DEFAULT_TEMPLATE_NAMES[channel],
      content: DEFAULT_TEMPLATE_CONTENT[channel],
      created_at: now,
      updated_at: now,
    })
    changed = true
  }

  return {
    templates: nextTemplates.sort((left, right) => `${left.created_at}:${left.id}`.localeCompare(`${right.created_at}:${right.id}`)),
    changed,
  }
}

function repairSelection(
  selection: StoredPromptSelection,
  templates: StoredPromptTemplate[],
): { selection: StoredPromptSelection; changed: boolean } {
  const templatesByChannel = new Map<PromptTemplateChannel, StoredPromptTemplate[]>()
  for (const channel of ALL_CHANNELS) {
    templatesByChannel.set(channel, templates.filter((item) => item.channel === channel))
  }

  const ids = new Set(templates.map((item) => item.id))
  const now = new Date().toISOString()
  const nextSelection: StoredPromptSelection = {
    correction_template_id: selection.correction_template_id,
    notes_template_id: selection.notes_template_id,
    mindmap_template_id: selection.mindmap_template_id,
    vqa_template_id: selection.vqa_template_id,
    created_at: selection.created_at || now,
    updated_at: selection.updated_at || now,
  }
  let changed = !selection.created_at || !selection.updated_at

  for (const channel of ALL_CHANNELS) {
    const property =
      channel === "correction"
        ? "correction_template_id"
        : channel === "notes"
          ? "notes_template_id"
          : channel === "mindmap"
            ? "mindmap_template_id"
            : "vqa_template_id"
    const currentId = nextSelection[property]
    if (ids.has(currentId)) {
      continue
    }
    nextSelection[property] = templatesByChannel.get(channel)?.[0]?.id || DEFAULT_TEMPLATE_IDS[channel]
    nextSelection.updated_at = now
    changed = true
  }

  return {
    selection: nextSelection,
    changed,
  }
}

function isDefaultTemplate(templateId: string): boolean {
  return Object.values(DEFAULT_TEMPLATE_IDS).includes(templateId)
}

function buildBundle(templates: StoredPromptTemplate[], selection: StoredPromptSelection): PromptTemplateBundleResponse {
  const serialized = templates.map<PromptTemplateItem>((item) => ({
    id: item.id,
    channel: item.channel,
    name: item.name,
    content: item.content,
    is_default: isDefaultTemplate(item.id),
    created_at: item.created_at,
    updated_at: item.updated_at,
  }))

  return {
    templates: serialized,
    selection: {
      correction: selection.correction_template_id,
      notes: selection.notes_template_id,
      mindmap: selection.mindmap_template_id,
      vqa: selection.vqa_template_id,
    } satisfies PromptTemplateSelection,
    summary_templates: serialized.filter((item) => item.channel === "notes"),
    mindmap_templates: serialized.filter((item) => item.channel === "mindmap"),
    selected_summary_template_id: selection.notes_template_id,
    selected_mindmap_template_id: selection.mindmap_template_id,
  }
}
