# Impeccable 基础使用文档（面向当前项目）

> 文档目的：给已经安装好 Impeccable 的同学一个可直接上手的操作手册。  
> 适用范围：Codex / Cursor / Claude Code / Gemini CLI 等支持 Skills 或命令提示的 AI 开发环境。  
> 更新时间：2026-04-05

## 1. Impeccable 是什么

Impeccable 是一套“前端设计能力增强包”，核心包含两部分：

- 1 个增强版 `frontend-design` 技能（含更细分的设计参考）
- 20 个可调用的设计命令（如 `audit`、`normalize`、`polish`、`typeset` 等）

它的目标不是替你画界面，而是把“设计语言”和“质量约束”注入到 AI 工作流中，降低同质化、模板化 UI 输出。

## 2. 当前项目中的状态

你当前环境已经包含 Impeccable 相关技能（含 `teach-impeccable`、`audit`、`normalize`、`polish` 等），可直接使用，无需重复安装。

如需自行检查，可在本机查看：

```powershell
Get-ChildItem -Name C:\Users\ASUS\.codex\skills
```

## 3. 安装与更新（可选）

如果后续需要在新机器或新环境复用，可按官方推荐方式：

```bash
npx skills add pbakaus/impeccable
```

更新到最新版：

```bash
npx skills update
```

检查可更新内容：

```bash
npx skills check
```

## 4. 在 Codex 里的基础用法

### 4.1 对话中显式点名技能（推荐）

在需求里直接写技能名，模型会按技能说明执行。例如：

- `请使用 audit skill 检查运行配置中心页面的可访问性与性能问题`
- `请先 critique 再 polish 当前任务面板 UI`
- `使用 typeset + arrange 优化这个页面的排版和层级`

### 4.2 使用 `$技能名` 触发

你也可以在提示词里写 `$audit`、`$polish` 这类形式，效果等价于显式点名技能。

### 4.3 Codex CLI 命令风格（官方 README 提到）

在原生 Codex CLI 语境里，可使用：

- `/prompts:audit`
- `/prompts:polish`
- `/prompts:normalize`

具体是否可用，取决于你当前壳环境是否启用了对应 prompts 路由。

## 5. 20 个命令速查（建议收藏）

| 命令 | 作用（简述） | 适用时机 |
|---|---|---|
| `teach-impeccable` | 一次性采集项目设计上下文并持久化 | 项目刚接入时先跑一次 |
| `audit` | 技术质量审计（a11y、性能、响应式、反模式） | 先体检再改 |
| `critique` | UX 设计评审（信息架构、层级、认知负担） | 先评审再优化 |
| `normalize` | 对齐设计系统（间距、组件、token） | 页面风格不一致 |
| `polish` | 上线前精修（对齐、细节、统一性） | 发布前最后一轮 |
| `optimize` | 前端性能优化 | 卡顿、加载慢、渲染抖动 |
| `harden` | 健壮性增强（错误态、i18n、边界场景） | 准备进入生产 |
| `clarify` | 文案与交互文案可理解性优化 | 提示语、错误文案不清晰 |
| `distill` | 去冗余、降复杂度 | 页面太杂、信息噪音大 |
| `adapt` | 多端与响应式适配 | 移动端/小屏体验不佳 |
| `arrange` | 布局、间距、节奏整理 | 视觉层级混乱 |
| `typeset` | 字体与排版系统优化 | 字号层级、可读性差 |
| `colorize` | 增加策略性色彩表达 | 页面过灰、缺少重点 |
| `quieter` | 降低视觉刺激强度 | 过于花哨、攻击性强 |
| `bolder` | 增强视觉冲击力 | 设计过于平淡 |
| `animate` | 增加有意义动效 | 交互反馈弱 |
| `delight` | 增加“惊喜感”与品牌记忆点 | 需要提升体验气质 |
| `onboard` | 首次使用/空状态引导优化 | 新用户转化场景 |
| `extract` | 提取可复用组件与设计资产 | 开始沉淀设计系统 |
| `overdrive` | 高强度“炫技型”体验增强 | 需要展示性效果（谨慎用） |

## 6. 推荐工作流（实战）

### 6.1 常规迭代流

`audit` -> `normalize` -> `polish`

适用于大多数“已有页面质量提升”场景。

### 6.2 体验导向流

`critique` -> `typeset` -> `arrange` -> `delight`

适用于“观感和易用性都要提升”的功能页。

### 6.3 上线前稳定性流

`audit` -> `harden` -> `optimize` -> `polish`

适用于发布前冲刺。

## 7. 反模式提醒（官方强调）

Impeccable 会主动规避一些常见 AI UI 坑位，例如：

- 盲目使用过度泛滥字体组合
- 有色背景上使用低对比灰字
- 过度依赖“卡片套卡片”
- 陈旧的弹性/反弹动效风格

实践建议：在要求中明确写“请按 Impeccable 反模式约束执行”。

## 8. 常见问题

### Q1：我写了命令名，但看起来没生效？

- 在提示词里明确写“请使用 `xxx` skill”
- 把目标范围写具体，例如“只优化任务进度区域，不改其他模块”
- 对于复杂任务，按“审计 -> 修复 -> 精修”拆成多步

### Q2：多个命令能一起用吗？

可以，且官方鼓励组合使用。  
示例：`audit + normalize + polish`。

### Q3：`teach-impeccable` 需要每次都跑吗？

不需要。通常项目级只需一次，后续设计任务复用同一上下文。

## 9. 官方参考

- 官网：<https://impeccable.style/>
- GitHub：<https://github.com/pbakaus/impeccable>
- 命令速查页：<https://impeccable.style/cheatsheet>
- 命令 API（官网实时数据）：<https://impeccable.style/api/commands>

