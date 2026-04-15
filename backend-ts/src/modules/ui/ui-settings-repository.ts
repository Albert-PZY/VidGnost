import path from "node:path"

import type { UISettingsResponse, UISettingsUpdateRequest } from "@vidgnost/contracts"

import type { AppConfig } from "../../core/config.js"
import { pathExists, readJsonFile, writeJsonFile } from "../../core/fs.js"

export const DEFAULT_UI_SETTINGS: UISettingsResponse = {
  language: "zh",
  font_size: 14,
  auto_save: true,
  theme_hue: 220,
  background_image: null,
  background_image_opacity: 28,
  background_image_blur: 0,
  background_image_scale: 1,
  background_image_focus_x: 0.5,
  background_image_focus_y: 0.5,
  background_image_fill_mode: "cover",
}

export class UiSettingsRepository {
  readonly #path: string

  constructor(config: AppConfig) {
    this.#path = path.join(config.storageDir, "config", "ui_settings.json")
  }

  async get(): Promise<UISettingsResponse> {
    await this.#ensureFile()
    return this.#normalize(await readJsonFile<Partial<UISettingsResponse>>(this.#path, DEFAULT_UI_SETTINGS))
  }

  async update(updates: UISettingsUpdateRequest): Promise<UISettingsResponse> {
    const current = await this.get()
    const nextValue = this.#normalize({
      ...current,
      ...updates,
    })
    await writeJsonFile(this.#path, nextValue)
    return nextValue
  }

  async #ensureFile(): Promise<void> {
    if (await pathExists(this.#path)) {
      return
    }
    await writeJsonFile(this.#path, DEFAULT_UI_SETTINGS)
  }

  #normalize(payload: Partial<UISettingsResponse>): UISettingsResponse {
    const language = payload.language === "en" ? "en" : "zh"
    const backgroundImageRaw = payload.background_image
    const background_image =
      typeof backgroundImageRaw === "string" ? backgroundImageRaw.trim() || null : null

    return {
      language,
      font_size: clampInteger(payload.font_size, DEFAULT_UI_SETTINGS.font_size, 12, 20),
      auto_save: typeof payload.auto_save === "boolean" ? payload.auto_save : DEFAULT_UI_SETTINGS.auto_save,
      theme_hue: clampInteger(payload.theme_hue, DEFAULT_UI_SETTINGS.theme_hue, 0, 360),
      background_image,
      background_image_opacity: clampInteger(
        payload.background_image_opacity,
        DEFAULT_UI_SETTINGS.background_image_opacity,
        0,
        100,
      ),
      background_image_blur: clampInteger(
        payload.background_image_blur,
        DEFAULT_UI_SETTINGS.background_image_blur,
        0,
        40,
      ),
      background_image_scale: clampNumber(payload.background_image_scale, DEFAULT_UI_SETTINGS.background_image_scale, 1, 4),
      background_image_focus_x: clampNumber(payload.background_image_focus_x, DEFAULT_UI_SETTINGS.background_image_focus_x, 0, 1),
      background_image_focus_y: clampNumber(payload.background_image_focus_y, DEFAULT_UI_SETTINGS.background_image_focus_y, 0, 1),
      background_image_fill_mode:
        payload.background_image_fill_mode === "contain" ||
        payload.background_image_fill_mode === "repeat" ||
        payload.background_image_fill_mode === "center"
          ? payload.background_image_fill_mode
          : "cover",
    }
  }
}

function clampInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(candidate)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, candidate))
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const candidate = Number.parseFloat(String(value ?? "").trim())
  if (!Number.isFinite(candidate)) {
    return fallback
  }
  return Math.max(minimum, Math.min(maximum, candidate))
}
