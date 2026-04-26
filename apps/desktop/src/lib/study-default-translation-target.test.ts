import { describe, expect, it } from "vitest"

import {
  buildStudyDefaultTranslationTargetOptions,
  STUDY_DEFAULT_TRANSLATION_TARGET_EMPTY_VALUE,
} from "./study-default-translation-target"

describe("study-default-translation-target", () => {
  it("returns preset target languages and keeps the empty sentinel first", () => {
    const options = buildStudyDefaultTranslationTargetOptions(null)

    expect(options[0]).toEqual({
      label: "不设置",
      value: STUDY_DEFAULT_TRANSLATION_TARGET_EMPTY_VALUE,
    })
    expect(options).toEqual(
      expect.arrayContaining([
        { label: "English (en)", value: "en" },
        { label: "日语 (ja)", value: "ja" },
        { label: "简体中文 (zh-Hans)", value: "zh-Hans" },
      ]),
    )
  })

  it("keeps an existing legacy value selectable when it is outside the preset list", () => {
    const options = buildStudyDefaultTranslationTargetOptions("it")

    expect(options).toContainEqual({
      label: "当前值 (it)",
      value: "it",
    })
  })
})
