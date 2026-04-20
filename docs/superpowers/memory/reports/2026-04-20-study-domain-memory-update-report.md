# Memory Update Report

## Summary

- Scope: Study-first 域、Study/Knowledge API 家族与 transcript-first QA 基线
- Result: done
- Created docs: 1
- Updated docs: 3
- Major gaps: 3

## Coverage created

- Modules:
  - `docs/superpowers/memory/module-cards/study-domain.md`
- Contracts:
  - 无新增
- Decisions:
  - `docs/superpowers/memory/index.md`
- Reports:
  - `docs/superpowers/memory/reports/2026-04-20-study-domain-memory-update-report.md`

## Coverage updated

- `docs/superpowers/memory/index.md`
- `docs/superpowers/memory/module-cards/vqa-runtime.md`
- `docs/superpowers/memory/contracts/vqa-multimodal-pipeline.md`

## Durable facts captured

- Study 域是挂在既有 `notes / vqa` 任务上的投影视图与持久化域，不是新的 workflow
- Study 结构化数据进入 `storage/study/study.sqlite`，可搬运工件镜像进入 `storage/tasks/stage-artifacts/<task_id>/D/study/`
- Study / Knowledge API、study export records、subtitle tracks、translation records、study state、knowledge notes 都围绕同一个 `task_id` 收口
- 当前 QA 默认基线是 transcript-first、transcript-only；旧多模态字段只保留兼容价值

## Evidence reviewed

- `docs/vidgnost-study-workbench-refactor-plan.zh-CN.md`
- `packages/contracts/src/study.ts`
- `packages/contracts/src/knowledge.ts`
- `apps/api/src/routes/study.ts`
- `apps/api/src/modules/study/**`
- `apps/api/src/modules/tasks/task-orchestrator.ts`

## Remaining gaps

- 尚未形成 Study SQLite 迁移、备份与恢复 runbook
- 尚未补齐学习资料库 UI 与 continue-learning 交互的独立模块卡
- 尚未沉淀 transcript-first QA 质量回归指标与排障手册
