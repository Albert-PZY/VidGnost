# OpenSpec 归档规则

本目录存放“已完成并冻结”的 change。

## 什么时候可以归档

满足以下条件后建议归档：

1. `tasks.md` 中任务已完成（或明确标注不做）。
2. 关键行为已同步到 `docs/openspec/specs/` 基线目录。
3. 对应代码已合并到主分支。

## 归档前检查清单

- `proposal.md`、`design.md`、`tasks.md`、`specs/*/spec.md` 是否完整。
- 变更涉及的 capability 是否已沉淀到 base specs。
- 是否保留了必要的实现背景（避免仅剩代码）。

## 归档后注意事项

- 归档目录视为历史记录，不再作为 active change 修改入口。
- 新需求请新建新的 change id，不要在归档目录继续迭代。
