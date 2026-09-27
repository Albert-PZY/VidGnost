#!/usr/bin/env node
/**
 * 手动校验提交信息（改历史、补写信息后自检时用）。
 *   node scripts/lint-commit.mjs          # 校验 HEAD
 *   node scripts/lint-commit.mjs <sha>    # 校验指定提交
 */
import { execFileSync } from 'node:child_process'

import { AREAS, CONVENTION_DOC, validateCommitMessage } from './lib/commit-rules.mjs'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

const sha = process.argv[2]
const target = sha ?? 'HEAD'
const subject = git(['log', '-1', '--pretty=%s', target])
const body = git(['log', '-1', '--pretty=%b', target])

const { errors, warnings, hints } = validateCommitMessage(`${subject}\n\n${body}`)

console.log(`VidGnost · 提交信息校验 ${target}`)
console.log(`  ${subject}`)
for (const warning of warnings) {
  console.log(`  ! ${warning}`)
}
for (const hint of hints) {
  console.log(`  · ${hint}`)
}
for (const error of errors) {
  console.log(`  ✗ ${error}`)
}

if (errors.length > 0) {
  console.log(`\n可用 area：${Object.keys(AREAS).join(' / ')}`)
  console.log(`完整规则：${CONVENTION_DOC}`)
  process.exit(1)
}

console.log('  ✓ 符合规范')
