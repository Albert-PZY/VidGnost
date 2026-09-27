#!/usr/bin/env node
/**
 * 规范一致性守卫：docs/git-commit-convention.md §3 的 area 表必须与
 * scripts/lib/commit-rules.mjs 的 AREAS 逐条一致，否则钩子放行的和文档写的会两套。
 */
import { readFileSync } from 'node:fs'

import { AREAS, CONVENTION_DOC } from './lib/commit-rules.mjs'

/** 表格行形如：| `ui` | apps/desktop/src/components ... | */
const ROW_RE = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|(.+)\|\s*$/

/** 只认 §3 的 area 表；附录等其它小节里的表格不参与比对。 */
function areaTableSection(markdown) {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => /^##\s*3\./.test(line))
  if (start === -1) {
    return null
  }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^##\s/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

let markdown
try {
  markdown = readFileSync(CONVENTION_DOC, 'utf8')
} catch {
  console.error(`找不到规范文档：${CONVENTION_DOC}`)
  process.exit(1)
}

const section = areaTableSection(markdown)
if (section === null) {
  console.error(`${CONVENTION_DOC} 里找不到 §3 的 area 表小节。`)
  process.exit(1)
}

const documented = new Map()
for (const line of section.split('\n')) {
  const matched = line.match(ROW_RE)
  if (matched) {
    documented.set(matched[1], matched[2].trim())
  }
}

const missingInDoc = Object.keys(AREAS).filter((area) => !documented.has(area))
const missingInRules = [...documented.keys()].filter((area) => !(area in AREAS))

if (missingInDoc.length > 0 || missingInRules.length > 0) {
  console.error('提交规范与校验实现不一致：')
  if (missingInDoc.length > 0) {
    console.error(`  ✗ 文档缺少 area：${missingInDoc.join('、')}`)
  }
  if (missingInRules.length > 0) {
    console.error(`  ✗ 文档多出 area：${missingInRules.join('、')}`)
  }
  console.error(`  文档：${CONVENTION_DOC} §3`);
  console.error('  实现：scripts/lib/commit-rules.mjs · AREAS')
  process.exit(1)
}

console.log(`提交规范一致性检查通过。area 共 ${documented.size} 个，文档与校验实现一致。`)
