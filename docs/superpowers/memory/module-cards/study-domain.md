---
type: module_card
title: study-domain
summary: Study 域负责把任务、transcript、字幕轨、翻译记录、学习状态、知识笔记和导出记录投影为 task-scoped 学习工作台。
tags:
  - api
  - study
  - knowledge
owned_paths:
  - apps/api/src/modules/study
  - apps/api/src/routes/study.ts
  - packages/contracts/src/study.ts
  - packages/contracts/src/knowledge.ts
related_docs:
  - docs/openspec/specs/study-domain/spec.md
  - docs/superpowers/memory/module-cards/vqa-runtime.md
entrypoints:
  - /F:/in-house project/VidGnost/apps/api/src/modules/study/study-service.ts
  - /F:/in-house project/VidGnost/apps/api/src/modules/study/sqlite-study-repository.ts
  - /F:/in-house project/VidGnost/apps/api/src/routes/study.ts
status: active
---

# Study Domain

## Responsibilities

- 以 `task_id` 为主键，把现有 `notes` / `vqa` 任务投影成 Study 工作台数据
- 在 `storage/study/study.sqlite` 中持久化 `study_packs`、`study_state`、`subtitle_tracks`、`translation_records`、`knowledge_notes`、`export_records`
- 把可搬运的 Study JSON 工件镜像写到 `storage/tasks/stage-artifacts/<task_id>/D/study/`
- 统一提供 Study / Knowledge API，而不是引入新的 workflow

## Entry Points

- `StudyService.getPreview()`
- `StudyService.getWorkspace()`
- `StudyService.materializeSubtitleTracks()`
- `StudyService.materializeTranslationRecords()`
- `StudyService.materializeWorkspace()`
- `registerStudyRoutes()`

## Persistence Model

- Study 域是任务骨架上的投影视图，不拥有独立任务生命周期
- SQLite 承担结构化高频读写；`D/study/*.json` 承担回放、导出和兼容读取
- `study_preview` 可从 `D/study/preview.json` 读取；缺失时回退到 transcript-first 启发式默认值
- 翻译轨产物写到 `D/study/translations/<target_language>/subtitle-track.json`
- Study 导出记录写到 SQLite，同时把实体文件写到 `D/study/exports/`

## Invariants

- `Study` 不是新的 workflow，任务仍然只能是 `notes` 或 `vqa`
- Study Pack、subtitle tracks、translation records、study state、knowledge notes、export records 都必须归属于同一个 `task_id`
- 当前默认学习工件仍由 transcript-first 主链路生成，字幕轨元数据不会自动替代 phase `C` 的转写产物
- `KnowledgeNote.source_kind` 只能来自 `transcript`、`qa_answer`、`summary`、`highlight`、`quote`、`manual`

## Common Pitfalls

- 把 Study 域误写成新的任务工作流，会让 contracts、UI 路由和任务列表状态全部失真
- 只写 `D/study/*.json` 不同步 SQLite，会导致继续学习状态和导出记录不稳定
- 把平台字幕轨可见性误解成“已替代转写主链路”，会高估当前实现深度
- 忘记把 Study 状态、Knowledge 笔记或导出记录绑定到 `task_id`，会破坏学习资料库的一致性
