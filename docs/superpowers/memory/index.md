---
type: decision
title: repository-memory-index
summary: VidGnost 的仓库记忆入口，当前重点覆盖 Study-first 域与 transcript-first QA 基线。
tags:
  - memory
  - study
  - qa
owned_paths:
  - docs/superpowers/memory
related_docs:
  - docs/superpowers/memory/module-cards/study-domain.md
  - docs/superpowers/memory/module-cards/vqa-runtime.md
  - docs/superpowers/memory/contracts/vqa-multimodal-pipeline.md
  - docs/superpowers/memory/contracts/bilibili-auth-subtitle-fallback.md
entrypoints:
  - /F:/in-house project/VidGnost/apps/api/src/modules/study/study-service.ts
  - /F:/in-house project/VidGnost/apps/api/src/modules/vqa/vqa-runtime-service.ts
status: active
---

# Repository Memory Index

## 已覆盖域

- Study-first 任务投影视图与持久化域
- transcript-first 视频问答运行时与检索链路
- 旧多模态问答工件的兼容合同

## 主要文档

- 模块卡：[study-domain.md](/F:/in-house project/VidGnost/docs/superpowers/memory/module-cards/study-domain.md)
- 模块卡：[vqa-runtime.md](/F:/in-house project/VidGnost/docs/superpowers/memory/module-cards/vqa-runtime.md)
- 合同文档：[vqa-multimodal-pipeline.md](/F:/in-house project/VidGnost/docs/superpowers/memory/contracts/vqa-multimodal-pipeline.md)
- 合同文档：[bilibili-auth-subtitle-fallback.md](/F:/in-house project/VidGnost/docs/superpowers/memory/contracts/bilibili-auth-subtitle-fallback.md)
- 引导报告：[2026-04-18-vqa-memory-bootstrap-report.md](/F:/in-house project/VidGnost/docs/superpowers/memory/reports/2026-04-18-vqa-memory-bootstrap-report.md)
- 更新报告：[2026-04-20-study-domain-memory-update-report.md](/F:/in-house project/VidGnost/docs/superpowers/memory/reports/2026-04-20-study-domain-memory-update-report.md)

## 当前主要缺口

- 尚未沉淀 Study SQLite 迁移、备份与损坏恢复 runbook
- 尚未补齐学习资料库 UI 与 continue-learning 行为的独立模块卡
- 尚未形成 transcript-first QA 回归指标与排障 runbook
