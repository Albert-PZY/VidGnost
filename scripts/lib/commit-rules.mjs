/**
 * 提交信息规则：唯一来源是 docs/git-commit-convention.md §2 §3。
 * AREAS 必须与文档里的 area 表逐条一致；两处漂移会被 scripts/check-commit-convention.mjs 拦下。
 */

export const CONVENTION_DOC = 'docs/git-commit-convention.md'

/**
 * area 与目录一一对应，不许自创。
 * 判断方法：改的是哪个目录，就取对应 area；跨目录时拆成多个提交。
 */
export const AREAS = {
  // apps/api/src
  core: 'apps/api/src/core：配置、错误、文件、进程、文本工具',
  providers: 'apps/api/src/providers：模型目录、角色路由、提供方客户端、健康自检',
  media: 'apps/api/src/media：源解析、音频抽取、抽帧',
  pipeline: 'apps/api/src/pipeline：阶段引擎、任务仓库、事件总线',
  asr: 'apps/api/src/asr：在线转写、本地 faster-whisper、转写标准化',
  insight: 'apps/api/src/insight：分段、章节、摘要、导图、知识图谱、翻译',
  retrieval: 'apps/api/src/retrieval：切块、BM25、向量、RRF、重排、问答',
  store: 'apps/api/src/store：任务、设置与产物持久化',
  routes: 'apps/api/src/routes 与 apps/api/src/server：HTTP 接口、SSE 与服务装配',
  // apps/desktop
  ui: 'apps/desktop/src/components、src/app 与设计令牌：视图、组件、样式',
  state: 'apps/desktop/src/stores：状态与数据流',
  client: 'apps/desktop/src/lib：API 客户端与纯函数',
  main: 'apps/desktop/electron：窗口、托盘、对话框、启动画面',
  // packages
  contracts: 'packages/contracts：领域契约',
  shared: 'packages/shared：跨端共享工具',
  // 跨模块
  docs: 'docs/、README.md、README.zh-CN.md、AGENTS.md',
  openspec: 'docs/openspec/：提案、设计、任务与能力规格',
  test: 'apps/api/test、同目录 *.test.ts 与测试素材脚本',
  tool: 'scripts/、.githooks/ 与工程配置',
  build: '依赖、构建与打包配置',
  chore: '杂项：.gitignore、格式化',
}

/** 空话 / AI 味词表：出现即判定为「说不清」，直接拦下。 */
export const BAN_WORDS = [
  '优化了性能',
  '提升了体验',
  '完善了功能',
  '修复了一些问题',
  '代码优化',
  '细节优化',
  '相关调整',
  '若干优化',
  '整体优化',
  '各种优化',
  '做了一些改动',
  'update code',
  'fix bug',
  'improve performance',
]

/** 中文过去式标记：首行要用祈使句（「修复 X」而不是「修复了 X」）。 */
const PAST_TENSE_HINTS = [
  /修复了/,
  /增加了/,
  /添加了/,
  /删除了/,
  /更新了/,
  /优化了/,
  /调整了/,
  /重构了/,
  /\bfixed\b/i,
  /\badded\b/i,
  /\bupdated\b/i,
  /\bremoved\b/i,
  /^this commit/i,
]

const AREA_RE = /^([a-z][a-z0-9-]*):\s+(.+)$/
const MISSING_SPACE_RE = /^([a-z][a-z0-9-]*):(?=\S)/
const SKIP_RE = /^(Merge |Revert "|fixup!|squash!|Initial commit)/

/** 默认阈值；调用方可用 config 覆盖。 */
export const DEFAULT_COMMIT_CONFIG = {
  subjectMaxWidth: 60,
  requireBody: true,
  bodyMinChars: 12,
  banWords: BAN_WORDS,
}

/** 单个字符在终端 / GitHub 列表里的显示宽度（中文按 2 计）。 */
export function charWidth(ch) {
  const c = ch.codePointAt(0)
  const wide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1f9ff)
  return wide ? 2 : 1
}

export const displayWidth = (text) => [...text].reduce((sum, ch) => sum + charWidth(ch), 0)

/** 文本体检：命中的空话与过去式叙述。只做确定性判断，不做主观评价。 */
export function scanTone(text) {
  const lower = text.toLowerCase()
  return {
    banHits: BAN_WORDS.filter((word) => lower.includes(word.toLowerCase())),
    pastTenseHits: PAST_TENSE_HINTS.filter((re) => re.test(text)),
  }
}

export function parseSubject(subject) {
  const matched = subject.match(AREA_RE)
  return matched ? { area: matched[1], text: matched[2].trim() } : { area: null, text: subject.trim() }
}

/**
 * 校验一条提交信息（首行 + 正文）。
 * @returns {{errors: string[], warnings: string[], hints: string[]}}
 */
export function validateCommitMessage(raw, config = {}) {
  const { subjectMaxWidth, requireBody, bodyMinChars, banWords } = { ...DEFAULT_COMMIT_CONFIG, ...config }
  const errors = []
  const warnings = []
  const hints = []

  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const subject = (lines[0] ?? '').trim()
  const body = lines.slice(1).join('\n').trim()

  if (!subject) {
    errors.push('提交信息为空。')
    return { errors, warnings, hints }
  }
  // 合并 / 回滚 / 修订提交由 Git 生成，不做格式要求
  if (SKIP_RE.test(subject)) {
    return { errors, warnings, hints }
  }

  const { area, text } = parseSubject(subject)

  if (!area) {
    errors.push('缺少 area 前缀。格式：<area>: <中文祈使句>，如「ui: 模型页按在线与本地两域分组」。')
    hints.push(`可用 area：${Object.keys(AREAS).join(' / ')}`)
  } else if (!(area in AREAS)) {
    errors.push(`area「${area}」不在白名单里（见 ${CONVENTION_DOC} §3）。`)
    hints.push(`可用 area：${Object.keys(AREAS).join(' / ')}`)
  } else if (MISSING_SPACE_RE.test(subject)) {
    errors.push('area 与描述之间需要一个半角空格：`area: 描述`。')
  }

  const width = displayWidth(subject)
  if (width > subjectMaxWidth) {
    errors.push(`首行显示宽度 ${width} 超过 ${subjectMaxWidth}（中文按 2 计，中文建议 ≤25 字）。`)
  }

  if (/[。．.]$/.test(subject)) {
    errors.push('首行结尾不要加句号。')
  }

  if (lines.length > 1 && lines[1].trim() !== '') {
    errors.push('首行与正文之间必须空一行，否则正文会被当成标题的一部分。')
  }

  if (requireBody && body.replace(/\s/g, '').length < bodyMinChars) {
    errors.push(`正文太短（不足 ${bodyMinChars} 字）。写清「为什么改」，不是「改了什么」。`)
  }

  if (body) {
    const { banHits } = scanTone(body)
    const hit = banHits.filter((word) => banWords.includes(word))
    if (hit.length) {
      errors.push(`正文含空话：「${hit.join('、')}」。换成具体事实：改了什么、为什么、怎么验证的。`)
    }
  }

  const { banHits: subjectBanHits, pastTenseHits } = scanTone(subject)
  if (subjectBanHits.length) {
    errors.push(`首行含空话：「${subjectBanHits.join('、')}」。`)
  }
  if (pastTenseHits.length) {
    warnings.push('首行像过去式叙述，git 规范要求祈使句：把「修复了 X」改成「修复 X」。')
  }

  if (text && text.length < 4) {
    warnings.push('首行描述太短，读不出改了什么。')
  }

  if (body && !/^(Refs|Closes|Fixes|Co-authored-by|Signed-off-by):/im.test(body)) {
    hints.push('建议在正文末尾加 `Refs: <规格/决策>` 或 `Closes #12`，方便追溯。')
  }

  return { errors, warnings, hints }
}
