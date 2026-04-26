export const STUDY_DEFAULT_TRANSLATION_TARGET_EMPTY_VALUE = "__none__"

export interface StudyDefaultTranslationTargetOption {
  label: string
  value: string
}

const PRESET_STUDY_DEFAULT_TRANSLATION_TARGET_OPTIONS: StudyDefaultTranslationTargetOption[] = [
  { label: "不设置", value: STUDY_DEFAULT_TRANSLATION_TARGET_EMPTY_VALUE },
  { label: "English (en)", value: "en" },
  { label: "日语 (ja)", value: "ja" },
  { label: "韩语 (ko)", value: "ko" },
  { label: "简体中文 (zh-Hans)", value: "zh-Hans" },
  { label: "繁体中文 (zh-Hant)", value: "zh-Hant" },
  { label: "法语 (fr)", value: "fr" },
  { label: "德语 (de)", value: "de" },
  { label: "西班牙语 (es)", value: "es" },
  { label: "葡萄牙语（巴西） (pt-BR)", value: "pt-BR" },
]

export function buildStudyDefaultTranslationTargetOptions(
  currentValue: string | null | undefined,
): StudyDefaultTranslationTargetOption[] {
  const normalizedValue = String(currentValue || "").trim()
  if (
    !normalizedValue ||
    PRESET_STUDY_DEFAULT_TRANSLATION_TARGET_OPTIONS.some((option) => option.value === normalizedValue)
  ) {
    return [...PRESET_STUDY_DEFAULT_TRANSLATION_TARGET_OPTIONS]
  }

  return [
    PRESET_STUDY_DEFAULT_TRANSLATION_TARGET_OPTIONS[0],
    { label: `当前值 (${normalizedValue})`, value: normalizedValue },
    ...PRESET_STUDY_DEFAULT_TRANSLATION_TARGET_OPTIONS.slice(1),
  ]
}

export function toStudyDefaultTranslationTargetSelectValue(
  value: string | null | undefined,
): string {
  const normalizedValue = String(value || "").trim()
  return normalizedValue || STUDY_DEFAULT_TRANSLATION_TARGET_EMPTY_VALUE
}
