# VidGnost 代码事实 vs Spec 承诺对照矩阵

更新时间：2026-04-16

| 能力名称 | 当前实现状态 | 差距说明 | 处理方式 | 责任模块 |
| --- | --- | --- | --- | --- |
| Whisper 本地转写 | `implemented` | 本地 `whisper.cpp` CLI 已接入，但仍需手动准备 CLI 与 `ggml` 模型 | 降级文档，明确无 auto-download | `apps/api/src/modules/asr/` |
| 远程 ASR 标准化 | `implemented` | 已统一输出 `segments + text`，并区分空 segments / 异常时间戳错误 | 补测试并同步 spec | `apps/api/src/modules/asr/asr-service.ts` |
| 转录纠错三模式 | `implemented` | `off / strict / rewrite` 已落盘并区分模式 | 补齐产物与 spec 描述 | `apps/api/src/modules/summary/transcript-correction-service.ts` |
| 摘要/导图回退可解释化 | `implemented` | 已有 `generated_by` / `fallback_reason` / `manifest.json`，旧 spec 仍写成失败即终止 | 补实现后同步 spec | `apps/api/src/modules/summary/` |
| VQA transcript 向量索引 | `implemented` | 已有 `vector-index` 主链与 `vqa-prewarm` 产物，旧 spec 误写成 frame/multimodal 主链 | 降级文档，保留后续扩展位 | `apps/api/src/modules/vqa/` |
| VQA multimodal retrieval | `planned` | `mllm-default` 仅是配置位，未真正进入检索链 | 收缩 spec，不再标已实现 | `apps/api/src/modules/vqa/`, `apps/api/src/modules/models/` |
| Ollama 配置与探测 | `implemented` | 已支持配置读写、真实模型标签探测与运行态提示 | 同步 spec，明确模型状态来自 `/api/tags` | `apps/api/src/modules/models/ollama-service-manager.ts`, `apps/api/src/modules/models/model-catalog-repository.ts` |
| Ollama 自动重启 | `implemented` | Windows 下已支持项目内停止旧进程并按当前配置重启 `ollama serve` | 同步 spec 与运维基线 | `apps/api/src/modules/models/ollama-service-manager.ts` |
| Ollama 模型目录自动迁移 | `planned` | 当前仅更新配置路径并提示手动迁移 | 收缩 spec，不再宣称自动搬迁 | `apps/api/src/routes/config.ts` |
| 托管模型下载进度流 | `planned` | `/config/models/:id/download` 当前返回说明性 snapshot，不执行 `Ollama pull` | 收缩 spec 与 tasks | `apps/api/src/routes/config.ts`, `apps/desktop/src/components/views/settings-view.tsx` |
| LLM / Embedding / VLM 自检 | `implemented` | 已复用 `/models` 远程探测并暴露 `check_depth` | 补齐 spec 与基线文档 | `apps/api/src/modules/runtime/` |
| Task SSE 基线 | `partial` | 当前稳定基线是 phase/log/progress/terminal 事件，不包含 `runtime_warning` / `summary_delta` / `mindmap_delta` | 收缩 spec 与 tasks | `apps/api/src/modules/events/`, `apps/api/src/routes/task-events.ts` |
| 前端 VQA 证据形态 | `implemented` | 当前证据以 transcript 文本与时间戳为主，不依赖 frame thumbnail | 收缩 UI spec | `apps/desktop/src/components/views/task-processing-workbench.tsx` |
