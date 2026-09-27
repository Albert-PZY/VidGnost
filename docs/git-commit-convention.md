# Git 提交规范 · VidGnost

目的只有一个：让任何人打开 `git log` 就知道改了什么、为什么改、按什么节奏改的。

**本文不是倡议**：提交信息校验已由 git 钩子落地（`.githooks/commit-msg` → `scripts/hooks/commit-msg.mjs`），
area 与本文 §3 表格的漂移会被 `scripts/check-commit-convention.mjs` 拦下。

依据分三类，全文逐条标注：

- **【GitHub】** GitHub 官方文档：GitHub flow、Commits、行尾处理、大文件、自动生成 Release Notes
- **【git】** git 项目自己的提交规范 `SubmittingPatches`（Linux 内核一脉，最权威的提交信息规范）
- **【惯例】** 社区约定，**不是**官方要求

## 1. 先纠正一个误解

**GitHub 没有强制的提交信息格式。** 官方只给原则（短、说得清、一个提交一件事）；
`feat:` `fix:` 这类前缀来自社区的 Conventional Commits，GitHub 既不解析也不校验——
它的自动 Release Notes **只认 PR 标签**，不认提交前缀（§7）。

| 说法 | 是不是官方 | 出处 |
| --- | --- | --- |
| 每个提交应是「完整、孤立」的一件事 | ✅ GitHub | GitHub flow |
| 提交信息要简短描述改了什么 | ✅ GitHub | Commits |
| 首行 ≤50 字符、祈使句、结尾不加句号、`area:` 前缀 | ✅ git 项目 | SubmittingPatches |
| 正文写「为什么改」，含考虑过但放弃的方案 | ✅ git 项目 | SubmittingPatches |
| 拒绝 AI 味、作者自己都讲不清的提交 | ✅ git 项目 | SubmittingPatches · AI 一节 |
| `feat:` / `fix:` 前缀、类型表 | ❌ 社区惯例 | Conventional Commits |

一句话：**格式可以自选，「一个提交一件事 + 说得清为什么」不能省。**

本仓库的格式是 **`area: 中文祈使句`**。历史提交里的 `feat(desktop): …` 属于旧写法，
不回改历史，新提交一律按本文执行。

## 2. 提交信息格式

```text
ui: 模型页按在线与本地两域分组

原先一张角色路由表看不出模型归属，切换角色要来回找。
改成先分在线/本地两域，域内按提供方与能力细分，角色直接分配在模型卡片上。

验证：typecheck + 单测 40 项通过；浏览器实测两域顺序与角色 chip 迁移
Refs: docs/openspec/specs/desktop-studio-ui/spec.md
```

| 部分 | 规则 |
| --- | --- |
| 首行 | `area: 描述`，**祈使句**，结尾不加句号，中文建议 ≤25 字（显示宽度 ≤60，中文按 2 计）【git】 |
| 第 2 行 | 必须空一行，否则 git 会把正文当标题的一部分【git】 |
| 正文 | 写**为什么**（现状的问题 → 改后为什么更好 → 考虑过但放弃的替代方案），描述现状用现在时【git】 |
| 尾注 | 一行一个：`Refs: <规格/决策路径>`、`Closes #12`（合并后自动关 issue）【GitHub】、`Co-authored-by:`【GitHub】 |

**祈使句** = 把首行读成「给代码下命令」：

- ✅ `ui: 模型页按在线与本地两域分组`
- ❌ `ui: 重构了模型页`（过去式）/ `This commit refactors…`（叙述式）

area 用英文（对齐目录），描述用中文——`area` 让 `git log --oneline` 一眼能扫，中文描述不用猜缩写。

正文与首行都不得出现空话（「优化了性能」「修复了一些问题」等），词表在
`scripts/lib/commit-rules.mjs` 的 `BAN_WORDS`；钩子会命中即拦。

## 3. area 固定表（对齐目录，不许自创）

| area | 对应 |
| --- | --- |
| `core` | `apps/api/src/core`：配置、错误、文件、进程、文本工具 |
| `providers` | `apps/api/src/providers`：模型目录、角色路由、提供方客户端、健康自检 |
| `media` | `apps/api/src/media`：源解析、音频抽取、抽帧 |
| `pipeline` | `apps/api/src/pipeline`：阶段引擎、任务仓库、事件总线 |
| `asr` | `apps/api/src/asr`：在线转写、本地 faster-whisper、转写标准化 |
| `insight` | `apps/api/src/insight`：分段、章节、摘要、导图、知识图谱、翻译 |
| `retrieval` | `apps/api/src/retrieval`：切块、BM25、向量、RRF、重排、问答 |
| `store` | `apps/api/src/store`：任务、设置与产物持久化 |
| `routes` | `apps/api/src/routes` 与 `apps/api/src/server`：HTTP 接口、SSE 与服务装配 |
| `ui` | `apps/desktop/src/components`、`src/app` 与设计令牌：视图、组件、样式 |
| `state` | `apps/desktop/src/stores`：状态与数据流 |
| `client` | `apps/desktop/src/lib`：API 客户端与纯函数 |
| `main` | `apps/desktop/electron`：窗口、托盘、对话框、启动画面 |
| `contracts` | `packages/contracts`：领域契约 |
| `shared` | `packages/shared`：跨端共享工具 |
| `docs` | `docs/`、`README.md`、`README.zh-CN.md`、`AGENTS.md` |
| `openspec` | `docs/openspec/`：提案、设计、任务与能力规格 |
| `test` | `apps/api/test`、同目录 `*.test.ts` 与测试素材脚本 |
| `tool` | `scripts/`、`.githooks/` 与工程配置 |
| `build` | 依赖、构建与打包配置 |
| `chore` | 杂项：`.gitignore`、格式化 |

怎么选：**看改的是哪个目录**，取对应 area。一次改动横跨多个 area 时，按 area 拆成多个提交（§4）；
确实不可拆（例如契约与调用方同时改）时，取**主导改动**所在 area，并在正文写明另一侧也被带动。

为什么不用 `feat/fix` 类型前缀：area 与目录一一对应，不用查表就知道动了哪一块。
若你更习惯 Conventional Commits（【惯例】，可用），**别两种混用**。

## 4. 提交粒度

> "Ideally, each commit contains an isolated, complete change." ——【GitHub】GitHub flow

官方给的例子：重命名变量 + 加测试，就应该是两个提交——这样想只回滚重命名时，测试能留下。

| ✅ 该拆 | ❌ 别这样 |
| --- | --- |
| `client: 抽离模型分组规则` / `test: 补角色分配单测` | `更新`（信息量为零） |
| `ui: 模型页两域分组` / `openspec: 补模型工作区规格` | `改了点东西` |
| `docs: 补模型页说明` 与代码提交分开 | `feat: 全部功能完成`（混了 5 件事） |

三条硬规则：

1. **不推 `wip`**：没写完就本地 `stash`，或用下一次 `--amend` 修；
2. **不混格式化**：顺手全局格式化会淹没有效 diff，单独一个 `chore:` 提交；
3. **提交要能编译**：每个提交至少保证 `pnpm typecheck` 不炸，否则 bisect 没意义。

按 area 拆提交时注意顺序：先提交被依赖的一侧（如 `client:` 的纯函数），再提交使用方（如 `ui:`）。

## 5. 分支模型与合并

**长期分支是 `master`，它是可交付状态。** 需求改动走「工作分支 → 验证 → PR → 合入 master → 删除分支」，
不直接往 `master` 上堆提交。

| 规则 | 落地方式 |
| --- | --- |
| 需求开工先开分支 | 分支名 = `<前缀>/<模块>-<动作>`，模块名取自 §3 的 area 表 |
| 分支前缀 | `feat/`（新功能）`fix/`（缺陷）`refactor/`（重构）`docs/` `test/` `tool/` `build/` `chore/` |
| 默认自动合入 `master` | 验证清单全绿后开 PR 并合入，不再逐次确认；只有需求方明确要求保留时才停在分支上 |
| 合并后清理分支 | 本地与远程的功能分支一并删除，不留悬挂分支 |
| 临时集成分支 | 允许，但合并完成后同样要清掉 |

示例：`feat/model-scope-grouping`、`fix/asr-filetrans-retry`、`docs/merge-flow`。

### 合并前的验证清单（缺一不可）

```bash
pnpm build                 # 每个提交都要能编译，整条分支更要能
pnpm -r typecheck
pnpm -r test               # 全量单测
node scripts/check-openspec.mjs
node scripts/check-theme-contrast.mjs
node scripts/check-spec-sync.mjs
node scripts/check-commit-convention.mjs
node scripts/check-commit-rules.mjs
git diff --check origin/master...HEAD   # 空白错误
```

远程还有一道 `spec-sync-guard`（GitHub Actions，`.github/workflows/spec-sync.yml`）：
PR 上跑 `check-spec-sync.mjs` 与 `check-openspec.mjs`，绿了才算能合。

### 标准动作（照抄）

```bash
git switch -c feat/model-scope-grouping       # 1) 从最新 master 开分支
# ... 开发与提交，钩子自动校验信息 / 密钥 / 规格同步 ...
git push -u origin feat/model-scope-grouping  # 2) 推送功能分支

gh pr create --base master --fill             # 3) 开 PR：改了什么 / 解决什么问题 / 怎么验证
gh pr checks --watch                          #    等 spec-sync-guard 变绿
gh pr merge --rebase --delete-branch          # 4) 合入，并自动删除本地与远程分支

git switch master && git pull --ff-only       # 5) 本地回到可交付状态
```

合并方式：分支严格领先 `master` 时用 `--rebase`（等价快进，保持线性、保留逐条 area 提交）；
单一关注点的小 PR 用 `--squash`（`master` 上一条一件事）。两种都不产生合并气泡。

出现 `index.lock` 之类的锁冲突时：**停下重试**，不要并发执行 git 命令。

## 6. 仓库红线

| 项 | 规则 | 依据 |
| --- | --- | --- |
| 密钥 | **绝不提交** API Key、Cookie、token；密钥只走环境变量或本机配置 | 本项目既有约定 |
| 暂存区扫描 | `scripts/sanitize-staged-secrets.mjs` 由 pre-commit 钩子强制执行 | 同上 |
| 单文件大小 | >50 MiB 警告、**>100 MiB 直接拒收** | 【GitHub】 |
| 大二进制 | 走 Release 附件分发，不要提交进仓库（ffmpeg、模型权重、测试视频） | 【GitHub】 |
| 行尾 | 依赖仓库既有配置，不要在提交里混入纯行尾变更 | 【GitHub】 |
| 空白错误 | 提交前 `git diff --check` | 【git】 |
| 生成物 | `node_modules/`、`dist/`、`storage/`、临时文件不进仓库 | 本项目既有约定 |

## 7. 版本与 Release

### 什么时候打 tag

**只有能演示的状态才配打 tag**——半成品打 tag 等于自己也说不清哪个版本能跑。
判定标准：能不能当众演示完整链路，而不解释「这里还没做」。

版本号与 `apps/*/package.json` 的 `version` 对齐（当前基线：`apps/api`、`apps/desktop` 均为 `3.0.0`）。

### 怎么打

```bash
git switch master && git pull --ff-only        # tag 只打在 master 上
git tag -a v3.0.0 -m "v3.0.0：在线优先的视频知识引擎"   # 注释标签，不要轻量标签
git push origin v3.0.0                         # 推 tag 不受分支保护限制
```

### 怎么发 Release

```bash
gh release create v3.0.0 \
  --title "v3.0.0：在线优先的视频知识引擎" \
  --notes-file <手写正文> \
  --generate-notes        # 自动分类的 PR 列表会追加在手写正文之后
```

- 正文只写人话：**这一版能干什么 / 怎么跑起来 / 已知问题有哪些**，不要复述提交列表。
- 安装包与演示素材放 Release 附件，正好绕开 §6 的 100 MiB 限制【GitHub】。
- 自动 Release Notes **按 PR 标签分类**，不认提交前缀——所以开 PR 时要顺手打标签；
  分类规则在 `.github/release.yml`，标签名必须与仓库实际存在的标签一致
  （`gh label list` 可查：`bug` / `enhancement` / `documentation`）。
- 当前基线尚**未接打包流程**（`apps/desktop` 只有 `dev` / `build` / `preview`，没有 electron-builder），
  因此 Release 是源码发布，正文里要写明这一条，别让人去找安装包。

## 8. AI 参与的标注

【git】`SubmittingPatches` 有专门一节讲 AI：会拒绝「像 AI 生成、过度正式、表面漂亮但说不通、
作者自己都解释不了」的提交。

- 提交信息里的每一句都要能当面讲清；不写「优化了性能、提升了体验」这类空话（钩子直接拦）；
- AI 大量参与的那次改动，在尾注标注 `Co-authored-by:`（以实际使用的工具为准）；
- 涉及决策、验证结论的内容写进 `docs/openspec/` 对应规格或任务清单，而不是只留在对话里。

## 9. 提交前自检（5 秒版）

- [ ] 我在工作分支上，不是在 `master` 上直接提交
- [ ] 首行是 `area: 中文祈使句`，≤25 字，没句号
- [ ] 这个提交只做一件事，且 `pnpm typecheck` 过得去
- [ ] 正文回答了「为什么」，不是「我改了啥」
- [ ] 没混进密钥、大文件、生成物
- [ ] 改了受规格约束的行为 → 同一交付里已更新 `docs/openspec/` 规格与 `tasks.md`

钩子已自动校验的部分（信息格式、空话、暂存区密钥、规格同步），不必手动重复检查。

## 附：反例速查

| 别这么写 | 这么写 |
| --- | --- |
| `update` | `ui: 空态改为一句话加一个按钮` |
| `fix bug` | `pipeline: 取消后清理半成品产物` |
| `修复问题，优化代码，更新文档` | 拆成三个提交 |
| `feat: 功能完成` | `retrieval: 混合检索改走 RRF 融合` |
| `wip`（推上去了） | 别推；本地 stash 或 amend |
| `desktop: 改样式` | `ui: 模型卡片去掉发光边框` |

## 参考

- GitHub flow — https://docs.github.com/en/get-started/using-github/github-flow
- Commits（reference）— https://docs.github.com/en/pull-requests/reference/commits
- 行尾处理 — https://docs.github.com/en/get-started/git-basics/configuring-git-to-handle-line-endings
- 大文件限制 — https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- 自动生成 Release Notes — https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes
- git 提交规范 — https://git-scm.com/docs/SubmittingPatches
- Conventional Commits（社区惯例）— https://www.conventionalcommits.org/
