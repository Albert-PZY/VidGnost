---
type: contract
title: vqa-multimodal-pipeline
summary: 旧视频问答多模态工件的兼容合同；当前默认基线已经收口到 transcript-first、transcript-only QA。
tags:
  - contract
  - vqa
owned_paths:
  - apps/api/src/modules/tasks
  - apps/api/src/modules/vqa
  - packages/contracts/src
related_docs:
  - docs/superpowers/memory/module-cards/vqa-runtime.md
entrypoints:
  - /F:/in-house project/VidGnost/apps/api/src/modules/tasks/task-orchestrator.ts
  - /F:/in-house project/VidGnost/packages/contracts/src/tasks.ts
  - /F:/in-house project/VidGnost/packages/contracts/src/vqa.ts
status: active
---

# VQA Multimodal Pipeline Compatibility Contract

## Scope

适用于 `workflow=vqa` 历史任务里仍然保留的多模态工件、兼容字段和回放读取规则。它不是当前默认主链路说明文档。

## Producers And Consumers

- Producer:
  - `TaskOrchestrator`
  - `RetrievalIndexService`
- Consumer:
  - `VqaRuntimeService`
  - `/api/vqa*` 路由与相关问答接口
  - Study-first 工作台中的 Trace / 兼容读取面板

## States And Interface Rules

- 当前默认 `vqa` 任务在阶段 `D` 中以以下 Study-first 子阶段为主：
  - `transcript_optimize`
  - `subtitle_resolve`
  - `translation_resolve`
  - `study_pack_generate`
  - `notes_mindmap_generate`
  - `transcript_vectorize`
  - `vqa_prewarm`
  - `fusion_delivery`
- 历史任务 MAY 仍然暴露以下旧多模态兼容标记：
  - `frame_extract`
  - `frame_semantic`
  - `frame_vectorize`
  - `multimodal_index_fusion`
- 当前默认证据索引条目至少支持：
  - `transcript`
- 历史兼容任务 MAY 额外包含：
  - `frame_semantic`
- 每条证据都必须提供：
  - `doc_id`
  - `task_id`
  - `task_title`
  - `source`
  - `source_set`
  - `start`
  - `end`
  - `text`
- 图像兼容证据额外允许提供：
  - `image_path`
  - `visual_text`
  - `frame_index`
- 当前基线检索阶段至少输出 transcript-first 候选与最终命中；历史 trace MAY 仍保留更细的多路召回片段
- 最终回答必须经过 LLM 组织，不允许继续使用纯模板拼接作为主路径

## Invariants

- transcript 证据始终是当前默认问答基线
- 历史 frame 证据如果存在，也必须可回溯到时间戳
- `image_evidence`、`image_path`、`visual_text` 只能作为兼容字段，不能重新定义默认 QA 证据路径
- 前端 trace 面板展示的阶段名称必须与后端 trace stage 对齐

## Compatibility Notes

- 当前默认预热产物是 transcript-only `D/vqa-prewarm/index.json`
- 历史多模态索引可以继续被读取，但它们不应主导新的 Study-first 文档、UI 叙述或检索默认路径
