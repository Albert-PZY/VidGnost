#!/usr/bin/env node
/**
 * commit-msg 钩子：按 docs/git-commit-convention.md §2 §3 校验提交信息。
 * 由 .githooks/commit-msg 调用，参数是 Git 传入的提交信息文件路径。
 */
import { readFileSync } from 'node:fs'

import { AREAS, CONVENTION_DOC, validateCommitMessage } from '../lib/commit-rules.mjs'

const messageFile = process.argv[2]
if (!messageFile) {
  console.error('commit-msg 钩子缺少参数（提交信息文件路径）')
  process.exit(1)
}

// Git 会把注释行（如 rebase 提示）写进同一份文件，校验前先剔除
const message = readFileSync(messageFile, 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .join('\n')
  .trim()

const { errors, warnings, hints } = validateCommitMessage(message)

console.log('VidGnost · 提交信息校验')
for (const warning of warnings) {
  console.log(`  ! ${warning}`)
}
for (const hint of hints) {
  console.log(`  · ${hint}`)
}

if (errors.length > 0) {
  for (const error of errors) {
    console.log(`  ✗ ${error}`)
  }
  console.log('\n规范示例：')
  console.log('  ui: 模型页按在线与本地两域分组')
  console.log('')
  console.log('  原先一张角色路由表看不出模型归属，切换角色要来回找。')
  console.log('  改成先分在线/本地两域，域内按提供方与能力细分，角色直接分配在模型卡片上。')
  console.log('')
  console.log('  验证：浏览器实测两域顺序与角色 chip 迁移')
  console.log('  Refs: docs/openspec/specs/desktop-studio-ui/spec.md')
  console.log(`\n可用 area：${Object.keys(AREAS).join(' / ')}`)
  console.log(`完整规则：${CONVENTION_DOC}`)
  process.exit(1)
}

console.log('  ✓ 提交信息符合规范')
