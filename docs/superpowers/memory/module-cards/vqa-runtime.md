---
type: module_card
title: vqa-runtime
summary: 视频问答运行时负责 transcript-first 索引准备、证据检索、答案生成和 trace 落盘，并兼容读取旧多模态工件。
tags:
  - api
  - vqa
owned_paths:
  - apps/api/src/modules/vqa
  - apps/api/src/routes/vqa.ts
related_docs:
  - docs/superpowers/memory/contracts/vqa-multimodal-pipeline.md
entrypoints:
  - /F:/in-house project/VidGnost/apps/api/src/modules/vqa/vqa-runtime-service.ts
  - /F:/in-house project/VidGnost/apps/api/src/modules/vqa/retrieval-index-service.ts
  - /F:/in-house project/VidGnost/apps/api/src/routes/vqa.ts
status: active
---

# VQA Runtime

## Responsibilities

- 为指定任务加载或构建 transcript-only 问答索引
- 执行 transcript-first 证据召回与重排序
- 组织最终 LLM 回答和 citation
- 将检索与回答过程写入 trace 日志
- 兼容读取历史任务中仍存在的多模态字段而不把它们提升回默认主链路

## Entry Points

- `VqaRuntimeService.search()`
- `VqaRuntimeService.analyze()`
- `VqaRuntimeService.streamChat()`
- `RetrievalIndexService.buildIndexAsync()`
- `registerVqaRoutes()`

## Invariants

- 问答链路必须以已完成转写的任务为前提
- trace 必须先写 `trace_started`，结束后写 `trace_finished`
- 检索结果必须能回溯到任务、时间戳和证据文本，且默认优先使用 transcript 证据
- 当前前端依赖 `source_set`、`start/end`、`text`、`trace_id` 等字段稳定存在
- 历史 `image_path`、`visual_text`、`image_evidence` 只能作为兼容字段读取

## Extension Points

- 在不打破 transcript-first 基线的前提下继续优化 transcript 检索质量
- 在运行时切换本地启发式 embedding/rerank 与真实模型推理
- 在答案生成阶段接入更稳定的 LLM 多轮组织回答
- 为历史任务保留有限的多模态兼容读取，而不是恢复多模态为默认路径

## Common Pitfalls

- 只改检索逻辑不改 `trace` 结构，会导致 Trace Theater 失真
- 只改后端阶段编排不改 `task-support` 和工作台步骤，UI 会继续显示旧四步
- 把旧多模态兼容字段当成当前默认证据路径，会让 README、OpenSpec 和 UI 重新偏离 Study-first 基线
- 只补 VLM 配置不补模型目录、自检和类型导出，设置页和自检页会出现断层
