import { describe, expect, it } from "vitest"

import type { MindNode } from "@vidgnost/contracts"

import { renderMarkmapMarkdown, renderMermaid } from "../src/insight/mindmap-service.js"

const TREE: MindNode = {
  id: "root-0",
  label: "CodeX 子 Agent 团队协作 Skill",
  children: [
    {
      id: "root-0-0",
      label: "Skill 介绍与角色架构",
      start: 0,
      children: [
        { id: "root-0-0-0", label: "维护探索者、执行者与 Reviewer（括号需清洗）", start: 12 },
        { id: "root-0-0-1", label: '引号 " 与反引号 ` 也要清洗', start: 24 },
      ],
    },
    { id: "root-0-1", label: "设计初衷与成本痛点", start: 36 },
  ],
}

describe("renderMermaid", () => {
  const source = renderMermaid(TREE)
  const lines = source.split("\n")

  it("starts with the mindmap directive", () => {
    expect(lines[0]).toBe("mindmap")
  })

  it("renders the root as a shaped node so branch nodes stay distinguishable", () => {
    expect(lines[1]).toBe("  root((CodeX 子 Agent 团队协作 Skill))")
  })

  it("increases indentation by two spaces per level", () => {
    expect(lines[2].startsWith("    Skill 介绍与角色架构")).toBe(true)
    expect(lines[3].startsWith("      ")).toBe(true)
  })

  it("strips ASCII characters that break mindmap syntax", () => {
    const branchLines = lines.slice(2)
    expect(branchLines.length).toBeGreaterThan(0)
    for (const line of branchLines) {
      expect(line).not.toContain('"')
      expect(line).not.toContain("`")
      expect(line).not.toContain("[")
      expect(line).not.toContain("(")
    }
  })

  it("keeps full-width punctuation, which is not part of mermaid syntax", () => {
    expect(source).toContain("维护探索者、执行者与 Reviewer（括号需清洗）")
  })

  it("keeps every node of the tree", () => {
    for (const label of ["Skill 介绍与角色架构", "设计初衷与成本痛点", "维护探索者、执行者与 Reviewer"]) {
      expect(source).toContain(label)
    }
  })
})

describe("renderMarkmapMarkdown", () => {
  it("emits heading levels mirroring the tree depth", () => {
    const markdown = renderMarkmapMarkdown(TREE)
    const lines = markdown.split("\n")
    expect(lines[0].startsWith("# CodeX 子 Agent 团队协作 Skill")).toBe(true)
    expect(lines[1].startsWith("## Skill 介绍与角色架构")).toBe(true)
    expect(lines[2].startsWith("### ")).toBe(true)
  })

  it("includes timecodes when nodes carry a start time", () => {
    expect(renderMarkmapMarkdown(TREE)).toContain("`[00:12]`")
  })
})
