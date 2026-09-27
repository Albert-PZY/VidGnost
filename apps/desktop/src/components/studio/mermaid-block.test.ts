import { describe, expect, it } from 'vitest'

import { rewriteSectionColors } from './mermaid-block'
import { resolveTheme, readStoredMode } from '@/stores/appearance-store'

/** 取自 Mermaid v11 真实输出的片段，用于固定「只重写 section 配色」的契约。 */
const SAMPLE_CSS = [
  '#mmd .section--1 circle{fill:hsl(240, 20%, 70%);stroke:hsl(240, 20%, 70%)}',
  '#mmd .section--1 text{fill:#232330}',
  '#mmd .section--1 span{color:#232330}',
  '#mmd .section--1 line{stroke:rgb(91, 91, 61);stroke-width:3}',
  '#mmd .section-0 rect{fill:hsl(240, 20%, 80%);stroke:hsl(240, 20%, 80%)}',
  '#mmd .section-0 text{fill:#232330}',
  '#mmd .section-edge-0{stroke:hsl(240, 20%, 80%)}',
  '#mmd .edge{stroke:#333}',
].join('\n')

describe("rewriteSectionColors", () => {
  it("replaces node fills with the themed tint", () => {
    const rewritten = rewriteSectionColors(SAMPLE_CSS, 'light')
    expect(rewritten).toContain('.section--1 circle{fill:#dcd8f6')
    expect(rewritten).toContain('.section-0 rect{fill:#d3e8e6')
    expect(rewritten).not.toContain('hsl(240, 20%, 70%)')
  })

  it("gives node shapes a matching border instead of the original stroke", () => {
    const rewritten = rewriteSectionColors(SAMPLE_CSS, 'light')
    expect(rewritten).toContain('stroke:#b3ade4')
    expect(rewritten).toContain('stroke:#a3ccc7')
  })

  it("recolours labels but never with the fill colour", () => {
    const rewritten = rewriteSectionColors(SAMPLE_CSS, 'light')
    expect(rewritten).toContain('.section--1 text{fill:#2a2a3d}')
    expect(rewritten).toContain('.section--1 span{color:#2a2a3d}')
  })

  it("keeps connector strokes and unrelated rules untouched", () => {
    const rewritten = rewriteSectionColors(SAMPLE_CSS, 'light')
    expect(rewritten).toContain('.section--1 line{stroke:rgb(91, 91, 61);stroke-width:3}')
    expect(rewritten).toContain('.section-edge-0{stroke:hsl(240, 20%, 80%)}')
    expect(rewritten).toContain('.edge{stroke:#333}')
  })

  it("produces a different palette per theme", () => {
    const light = rewriteSectionColors(SAMPLE_CSS, 'light')
    const dark = rewriteSectionColors(SAMPLE_CSS, 'dark')
    expect(light).not.toBe(dark)
    expect(dark).toContain('.section--1 circle{fill:#2b2b3c')
    expect(dark).toContain('.section--1 text{fill:#e6e6ef}')
  })

  it("is idempotent for already rewritten css", () => {
    const once = rewriteSectionColors(SAMPLE_CSS, 'light')
    expect(rewriteSectionColors(once, 'light')).toBe(once)
  })
})

describe("theme resolution", () => {
  it("returns explicit modes verbatim", () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it("falls back to light when there is no browser environment", () => {
    expect(resolveTheme('system')).toBe('light')
  })

  it("defaults to system when nothing is stored", () => {
    expect(readStoredMode()).toBe('system')
  })
})
