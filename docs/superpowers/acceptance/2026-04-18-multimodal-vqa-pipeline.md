# Acceptance Criteria: 多模态视频问答链路

**Spec:** `docs/superpowers/specs/2026-04-18-multimodal-vqa-pipeline-design.md`
**Date:** 2026-04-18
**Status:** Approved

---

## Criteria

| ID | Description | Test Type | Preconditions | Expected Result |
|----|-------------|-----------|---------------|-----------------|
| AC-001 | `vqa` 任务的阶段 D 暴露多模态子阶段而不是旧的单一 `ready` 语义 | API | 创建或重跑一个 `workflow=vqa` 任务 | `task detail.stage_metrics.D.substage_metrics` 至少包含 `transcript_vectorize`、`frame_extract`、`frame_semantic`、`frame_vectorize`、`multimodal_index_fusion` |
| AC-002 | VQA 任务预热目录会写出多模态索引产物 | API | 完成一个 `workflow=vqa` 任务 | `storage/tasks/stage-artifacts/<taskId>/D/vqa-prewarm/` 下存在统一入口 `index.json` 以及至少一个 transcript 与 frame 相关索引文件 |
| AC-003 | 检索索引支持 transcript 和 frame semantic 两类证据 | Logic | 运行索引构建测试 fixture | 生成的索引项中 `source` 同时包含 `transcript` 和 `frame_semantic` |
| AC-004 | 搜索接口返回的命中可以同时包含文本和图像证据 | API | 对具有多模态预热产物的任务执行 `/api/search` | 返回的 `hits` 中至少一条 `source=transcript` 且至少一条 `source=frame_semantic`，或响应明确标注图像链路降级原因 |
| AC-005 | 检索 trace 明细能区分文本召回、图像召回、融合和重排序阶段 | API | 执行一次 `/api/chat/stream` 并读取对应 trace | trace 记录中存在多模态检索阶段记录，且不再只有单一 `hits` 面板语义 |
| AC-006 | VQA 回答默认经过 LLM 组织，而不是仅靠模板拼接 | Logic | 运行 VQA runtime 测试并使用可用 LLM stub | 生成回答时会调用 LLM 客户端；返回内容不是旧的固定模板字符串 |
| AC-007 | 配置契约重新支持 `vlm` 模型组件 | Logic | 运行 contracts typecheck / schema 测试 | `modelComponentTypeSchema` 接受 `vlm`，相关类型导出可被 API 和前端编译通过 |
| AC-008 | 设置中心能展示并编辑 `vlm-default` 模型项 | UI interaction | 启动桌面端并打开设置中心模型配置 | 模型列表中可见视觉模型项，打开配置不会报错，表单字段与现有模型项风格一致 |
| AC-009 | 系统自检增加视觉模型探测步骤 | API | 启动一次系统自检 | 自检报告步骤中存在 `视觉模型`，并返回真实探测结果而不是占位文本 |
| AC-010 | VQA 工作台步骤展示扩展后的多模态链路 | UI interaction | 打开一个 VQA 任务工作台 | 工作台步骤包含视频抽帧和画面识别相关阶段，不再只显示旧四步 |
| AC-011 | 旧的 transcript-only 预热索引仍可被兼容读取 | Logic | 使用历史 transcript-only fixture 运行 VQA runtime | 旧 fixture 仍能完成问答，不会因为缺少图像索引而直接崩溃 |
| AC-012 | 多模态链路失败时支持分支降级而不是整体中断 | API | 让抽帧或 VLM 识别在测试中失败 | 任务仍能完成到 `completed` 或明确带降级日志完成，文本问答链路保持可用 |
