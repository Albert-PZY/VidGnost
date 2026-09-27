#!/usr/bin/env node
/**
 * 提交规则回归：用固定用例盯住 scripts/lib/commit-rules.mjs 的判定边界。
 * 规则只写在文档里会被慢慢放宽，这里把「什么必须拦、什么必须放行」钉死。
 */
import { validateCommitMessage, AREAS } from './lib/commit-rules.mjs'

const CASES = [
  {
    name: '合规提交（area + 祈使句 + 正文 + 尾注）',
    message: [
      'ui: 模型页按在线与本地两域分组',
      '',
      '原先一张角色路由表看不出模型归属，切换角色要来回找。',
      '改成先分两域，域内按提供方与能力细分，角色直接分配在模型卡片上。',
      '',
      'Refs: docs/openspec/specs/desktop-studio-ui/spec.md',
    ].join('\n'),
    expect: 'pass',
  },
  {
    name: '旧写法 feat(scope): 英文',
    message: 'feat(desktop): add model grouping\n\nBody text long enough here.',
    expect: 'fail',
  },
  {
    name: '自创 area',
    message: 'desktop: 模型页分组\n\n正文写清为什么要按两域分组，而不是按角色列表平铺。',
    expect: 'fail',
  },
  {
    name: 'area 后缺空格',
    message: 'ui:模型页分组\n\n正文写清为什么要按两域分组，而不是按角色列表平铺。',
    expect: 'fail',
  },
  {
    name: '过去式首行（警告而非拦截）',
    message: 'ui: 重构了模型页\n\n原先一张表看不出归属，改成两域分组后一眼能扫。',
    expect: 'pass-with-warning',
  },
  {
    name: '没有正文',
    message: 'ui: 模型页分组',
    expect: 'fail',
  },
  {
    name: '正文是空话',
    message: 'ui: 模型页分组\n\n优化了性能，提升了体验，完善了功能。',
    expect: 'fail',
  },
  {
    name: '首行超宽',
    message:
      'ui: 把模型页拆成在线模型与本地模型两大域并分别细分到每个模型的卡片上展示\n\n正文足够长，说明为什么要这么分层展示。',
    expect: 'fail',
  },
  {
    name: '首行结尾加句号',
    message: 'ui: 模型页按两域分组。\n\n正文足够长，说明为什么要这么分层展示。',
    expect: 'fail',
  },
  {
    name: '首行与正文之间没空行',
    message: 'ui: 模型页按两域分组\n正文足够长，说明为什么要这么分层展示。',
    expect: 'fail',
  },
  {
    name: '合并提交豁免',
    message: "Merge branch 'refactor/v3-video-knowledge-engine' into master",
    expect: 'pass',
  },
]

function verdictOf(message) {
  const { errors, warnings } = validateCommitMessage(message)
  if (errors.length > 0) {
    return 'fail'
  }
  return warnings.length > 0 ? 'pass-with-warning' : 'pass'
}

let failed = 0
for (const testCase of CASES) {
  const actual = verdictOf(testCase.message)
  const ok = actual === testCase.expect
  if (!ok) {
    failed += 1
    console.error(`  ✗ ${testCase.name} → ${actual}（期望 ${testCase.expect}）`)
    const { errors, warnings } = validateCommitMessage(testCase.message)
    for (const error of errors) console.error(`      ${error}`)
    for (const warning of warnings) console.error(`      ${warning}`)
  }
}

if (failed > 0) {
  console.error(`提交规则回归失败：${failed}/${CASES.length} 条不符（规则见 docs/git-commit-convention.md §2 §4）。`)
  process.exit(1)
}

console.log(`提交规则回归通过。用例 ${CASES.length} 条，area ${Object.keys(AREAS).length} 个。`)
