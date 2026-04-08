# OpenSpec 小白使用教程（完整入门版）

更新时间：2026-04-02

适用读者：
- 第一次接触 OpenSpec 的人
- 想把“拍脑袋开发”升级成“可追踪、可复盘开发”的团队

---

## 0. 先用一句话理解 OpenSpec

OpenSpec 不是“多写文档”，而是“先把需求、设计、任务和验收标准写清楚，再开发，再同步”的工作方式。

你可以把它理解为：
- 开发前：防止需求跑偏
- 开发中：防止多人理解不一致
- 开发后：防止只剩代码、没人说得清为什么这么做

---

## 1. 你会得到什么

当你按 OpenSpec 流程做完一个功能时，你会有这 4 类产物：

1. `proposal.md`
- 为什么要做这个变更（业务原因、痛点、范围）

2. `design.md`
- 技术方案怎么做（架构、决策、取舍、风险）

3. `tasks.md`
- 具体实施任务清单（可以逐项勾选）

4. `specs/*/spec.md`
- 机器和人都能读懂的需求约束（Requirement + Scenario）

这 4 个产物会显著提升：
- 需求稳定性
- 协作效率
- 交接可读性
- 回归验证效率

---

## 2. 本项目中的 OpenSpec 目录怎么读

```text
docs/openspec/
├─ README.md                              # 索引页
├─ ../OpenSpec-beginner-guide.zh-CN.md    # 本教程（位于 docs 根目录）
├─ specs/                                 # 基线规格（稳定能力）
├─ changes/
│  ├─ build-lightweight-v2/               # 当前活跃变更
│  │  ├─ .openspec.yaml
│  │  ├─ proposal.md
│  │  ├─ design.md
│  │  ├─ tasks.md
│  │  └─ specs/<capability>/spec.md
│  └─ archive/                            # 已归档变更
└─ templates/change-template/             # 新建变更模板
```

最容易混淆的是 `changes/*/specs` 和 `specs/`：

- `changes/*/specs`
  - 当前变更中的“草案/迭代版要求”
- `docs/openspec/specs`
  - 稳定后沉淀的“基线要求”

可以记成：
- 变更中看 `changes`
- 长期标准看 `specs`

---

## 3. 一套最实用的 OpenSpec 工作流（7 步）

## 第 1 步：判断是否需要新建 change

满足任意一条，建议新建 change：
- 新增功能
- 行为变化（哪怕 API 名字不变）
- 非功能改动（性能、稳定性、内存、可观测性）且可能影响用户体验

不建议新建 change 的场景：
- 单纯错别字
- 纯重命名且行为不变
- 不影响行为的内部清理

## 第 2 步：从模板创建 change

本项目模板目录：
- `docs/openspec/templates/change-template/`

建议 change id 命名：
- `verb-object-scope`
- 例子：`add-ocr-evidence-stage-d`

## 第 3 步：先写 `proposal.md`

`proposal.md` 只回答 3 个问题：
- Why：为什么做
- What：做什么
- Impact：影响什么模块

不要在 proposal 里塞过多技术细节，技术细节放 `design.md`。

## 第 4 步：写 `design.md`

`design.md` 建议至少包含：
- Context：上下文
- Goals / Non-Goals：目标与非目标
- Decisions：关键技术决策
- Risks / Trade-offs：风险与取舍
- Migration Plan：迁移或落地计划

## 第 5 步：写 `spec.md`（最关键）

每个 capability 的 spec 建议结构：

```md
## ADDED Requirements

### Requirement: System SHALL ...
...

#### Scenario: ...
- **WHEN** ...
- **THEN** ...
```

写法原则：
- Requirement 写“系统必须做什么”
- Scenario 写“在什么条件下，会得到什么结果”
- 用词明确，可测试，可验收

坏例子：
- “系统尽量快一点”

好例子：
- “System SHALL bound per-subscriber queue size to prevent unbounded memory growth.”

## 第 6 步：拆 `tasks.md` 并开发

`tasks.md` 要做到：
- 一条任务只对应一个可验证结果
- 勾选状态真实反映进度（不要提前全勾）

推荐顺序：
- 后端接口/核心逻辑
- 前端交互
- 测试
- 文档同步

## 第 7 步：完成后做“沉淀 + 归档”

完成 change 后，不要只停留在 “tasks 全勾”。
还要做两件事：

1. 沉淀基线
- 把稳定后的 capability spec 同步到：
  - `docs/openspec/specs/<capability>/spec.md`

2. 归档变更
- 将完成的 change 放入：
  - `docs/openspec/changes/archive/`
- 避免 `changes` 长期堆积一个超级大目录

---

## 4. 你可以直接照抄的“最小模板”

## proposal.md（最小版）

```md
## Why
- 现状问题
- 不改会怎样

## What Changes
- 功能点 A
- 功能点 B

## Impact
- backend: ...
- frontend: ...
- docs: ...
```

## design.md（最小版）

```md
## Context
...

## Goals / Non-Goals
...

## Decisions
...

## Risks / Trade-offs
...

## Migration Plan
...
```

## tasks.md（最小版）

```md
## 1. Backend
- [ ] 1.1 ...
- [ ] 1.2 ...

## 2. Frontend
- [ ] 2.1 ...

## 3. Test & Docs
- [ ] 3.1 ...
```

## spec.md（最小版）

```md
## ADDED Requirements

### Requirement: System SHALL ...
...

#### Scenario: ...
- **WHEN** ...
- **THEN** ...
```

---

## 5. 本项目推荐实践（重点）

1. 一个 change 只做一类事情
- 不要把“功能 + UI 大改 + 运维脚本”全塞一个 change

2. 每次代码行为变化都要同步 spec
- 包括降级策略、错误处理、边界行为

3. 先写 Scenario，再写代码
- 这样测试目标天然清晰

4. 任务完成不等于流程完成
- 还要做基线沉淀与归档

5. 用脚本做底线校验
- 本项目已提供：
  - `scripts/check-openspec.py`
  - `scripts/check-openspec.sh`
  - `scripts/check-openspec.ps1`

---

## 6. 如何在本项目里执行检查

Linux/WSL：

```bash
bash scripts/check-openspec.sh
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1
```

直接 Python：

```bash
python scripts/check-openspec.py
```

脚本会检查：
- active change 基本结构是否完整（proposal/design/tasks/specs）
- spec 是否包含 Requirement / Scenario
- base specs 是否覆盖 active change 的 capability

---

## 7. 常见错误（新手高频）

1. 只写 tasks，不写 spec
- 结果：任务做完了，但需求没有验收标准

2. 只写“实现细节”，不写“行为约束”
- 结果：代码在变，需求无法稳定传达

3. change 一直不归档
- 结果：历史越来越乱，后续新人看不懂

4. 把 specs 当“产品说明书”
- OpenSpec 要写的是“可验证的行为要求”，不是宣传文案

---

## 8. FAQ（面向分享教学）

Q1：OpenSpec 会不会拖慢开发？
- 短期会多花一点时间写清楚。
- 中长期会明显减少返工和沟通成本，整体更快。

Q2：小项目有必要用吗？
- 有必要，但可以轻量用。最少保持：
  - proposal + tasks + 关键 capability 的 spec

Q3：一定要英文写吗？
- 不一定。团队统一即可。
- 但建议 Requirement/Scenario 结构固定，方便搜索和自动检查。

Q4：可以边开发边补文档吗？
- 可以，但最低要求是：行为变更必须在提交前同步 spec。

---

## 9. 一页纸速记（给新人）

1. 新需求先建 `change-id`
2. 先写 `proposal`，再写 `design`
3. 先定义 `spec` 的 Requirement/Scenario
4. 再拆 `tasks` 并开发
5. 每次行为变化同步 `spec`
6. 跑 `check-openspec` 脚本
7. 完成后沉淀到 `docs/openspec/specs` 并归档

做到这 7 步，OpenSpec 就不是“额外负担”，而是你项目质量和协作效率的放大器。
