import { describe, expect, it } from "vitest"

import { DEFAULT_TEMPLATE_CONTENT } from "../src/modules/prompts/default-prompts.js"

describe("default prompt templates", () => {
  it("keeps the pre-ts-refactor default template copy", () => {
    expect(DEFAULT_TEMPLATE_CONTENT.correction).toBe("请纠正转写文本中的错字与标点，保持原意。\n\n{text}")
    expect(DEFAULT_TEMPLATE_CONTENT.notes).toContain("你是一名专业的内容编辑和知识架构师，同时擅长信息结构化表达（包括使用 Mermaid 图示）。")
    expect(DEFAULT_TEMPLATE_CONTENT.mindmap).toContain("你是一名信息结构化与知识可视化专家，擅长从非结构化文本中提取概念、关系和层级结构，并生成逻辑清晰、可视化的思维导图。")
    expect(DEFAULT_TEMPLATE_CONTENT.vqa).toBe("请基于证据回答用户问题，给出时间锚点与来源。\n\n问题：{query}\n证据：{context}")
  })
})
