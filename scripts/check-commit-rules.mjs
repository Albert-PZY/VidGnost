#!/usr/bin/env node
/**
 * 提交规则回归：用固定用例盯住 scripts/lib/commit-rules.mjs 的判定边界。
 * 规则只写在文档里会被慢慢放宽，这里把「什么必须拦、什么必须放行」钉死。
 */
import { AREA_HINTS, AREAS, validateCommitMessage } from './lib/commit-rules.mjs'

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
  {
    name: 'UI 变更带上 skill 约束提醒',
    message: 'ui: 模型卡片去掉发光边框\n\n原先每张卡片都在发光，整页没有主次，去掉后层级重新回到内容上。',
    expect: 'pass',
    expectHint: 'oil-frontend',
  },
  {
    name: '文案变更带上 oil-tone 提醒',
    message: 'docs: 收紧 README 的开头\n\n开头写了两遍同一句话，读者要读到第三段才知道它是什么。',
    expect: 'pass',
    expectHint: 'oil-tone',
  },
  {
    name: '非 UI 变更不带该提醒',
    message: 'pipeline: 取消后清理半成品产物\n\n取消时只停了进程，半成品文件留到下一次续跑才被发现，改为取消即清理。',
    expect: 'pass',
    expectHint: null,
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
  const { errors, warnings, hints } = validateCommitMessage(testCase.message)
  const actual = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'pass-with-warning' : 'pass'
  const problems = []
  if (actual !== testCase.expect) {
    problems.push(`判定为 ${actual}，期望 ${testCase.expect}`)
  }
  if (testCase.expectHint !== undefined) {
    const registered = Object.values(AREA_HINTS).flat()
    const carried = registered.filter((hint) => hints.includes(hint))
    if (testCase.expectHint === null) {
      if (carried.length > 0) {
        problems.push(`多出了 ${carried.length} 条 skill 提醒`)
      }
    } else if (!carried.some((hint) => hint.includes(testCase.expectHint))) {
      problems.push(`缺少「${testCase.expectHint}」提醒`)
    }
  }
  if (problems.length > 0) {
    failed += 1
    console.error(`  ✗ ${testCase.name}：${problems.join('；')}`)
    for (const error of errors) console.error(`      ${error}`)
    for (const warning of warnings) console.error(`      ${warning}`)
  }
}

if (failed > 0) {
  console.error(`提交规则回归失败：${failed}/${CASES.length} 条不符（规则见 docs/git-commit-convention.md §2 §4）。`)
  process.exit(1)
}

console.log(`提交规则回归通过。用例 ${CASES.length} 条，area ${Object.keys(AREAS).length} 个。`)
