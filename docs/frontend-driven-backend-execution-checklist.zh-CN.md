# VidGnost 前端驱动 TS 后端执行清单

更新时间：2026-04-15

## 1. 文档目标

本清单定义当前前端页面与 `backend-ts` 的联动基线，用于保证前端所有主视图都由 TS 后端真实驱动。

## 2. 页面能力边界

### 2.1 新建任务页

- 工作流选择：`notes`、`vqa`
- 来源类型：URL、本地路径、单文件上传、批量上传
- 创建后需要立即返回 `task_id`、`workflow`、初始步骤状态

### 2.2 任务处理页

- 展示任务总进度、步骤状态、阶段日志、ETA
- 展示转写文本、笔记、导图、字幕与工件下载
- 在 VQA 模式下展示检索命中、流式回答、证据跳转与 trace

### 2.3 历史页

- 提供统计卡、筛选、搜索、排序、删除、导出、打开目录

### 2.4 设置页

- 提供 LLM、Whisper、Ollama、模型目录、提示词模板、UI 偏好设置

### 2.5 自检页

- 提供系统环境、GPU、Whisper、LLM、Embedding、VLM、存储空间、FFmpeg 等检查结果

## 3. TS 后端执行基线

- 任务主链：`A -> B -> C -> D`
- `A`：来源校验与媒体准备
- `B`：音频提取与分块规划
- `C`：ASR 转写
- `D`：转录修正、笔记、导图与导出工件生成
- 事件分发：HTTP + SSE
- 存储目录：仓库根 `storage/`
- 契约来源：`packages/contracts`

## 4. 必须兑现的接口能力

- `POST /api/tasks/url`
- `POST /api/tasks/path`
- `POST /api/tasks/upload`
- `POST /api/tasks/upload/batch`
- `GET /api/tasks`
- `GET /api/tasks/:taskId`
- `GET /api/tasks/:taskId/events`
- `PATCH /api/tasks/:taskId/title`
- `PATCH /api/tasks/:taskId/artifacts`
- `DELETE /api/tasks/:taskId`
- `POST /api/tasks/:taskId/cancel`
- `POST /api/tasks/:taskId/pause`
- `POST /api/tasks/:taskId/resume`
- `POST /api/tasks/:taskId/rerun-stage-d`
- `GET /api/tasks/:taskId/export/:kind`
- `GET /api/tasks/stats`
- `GET /api/tasks/recent`
- `GET /api/tasks/:taskId/source-media`
- `GET /api/tasks/:taskId/artifacts/file`
- `GET /api/tasks/:taskId/open-location`
- `GET /api/config/llm`
- `PUT /api/config/llm`
- `GET /api/config/ollama`
- `PUT /api/config/ollama`
- `POST /api/config/ollama/migrate-models`
- `POST /api/config/ollama/restart-service`
- `GET /api/config/whisper`
- `PUT /api/config/whisper`
- `GET /api/config/models`
- `POST /api/config/models/reload`
- `PATCH /api/config/models/:modelId`
- `POST /api/config/models/:modelId/download`
- `DELETE /api/config/models/:modelId/download`
- `GET /api/config/prompts`
- `PUT /api/config/prompts/selection`
- `POST /api/config/prompts/templates`
- `PATCH /api/config/prompts/templates/:templateId`
- `DELETE /api/config/prompts/templates/:templateId`
- `GET /api/config/ui`
- `PUT /api/config/ui`
- `POST /api/self-check/start`
- `POST /api/self-check/:sessionId/auto-fix`
- `GET /api/self-check/:sessionId/report`
- `GET /api/self-check/:sessionId/events`
- `GET /api/runtime/metrics`
- `GET /api/runtime/paths`
- `POST /api/search`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/traces/:traceId`

## 5. 联调验收清单

- [ ] 前端创建任务后能拿到真实 `task_id`
- [ ] 任务详情页能基于真实 `steps[]` 和 `overall_progress` 刷新
- [ ] 转写片段点击可跳到对应时间点
- [ ] 笔记与导图支持读取、编辑、导出
- [ ] VQA 能返回命中证据、流式回答和 `trace_id`
- [ ] 历史页统计、搜索、筛选、排序全部来自 TS 后端
- [ ] 设置页所有表单刷新后可回显
- [ ] 自检页能逐项显示真实检查结果

## 6. 运行约束

- 前端不承担任何服务端业务逻辑
- 所有运行态真值由 `backend-ts` 返回
- 所有结构体定义以 `packages/contracts` 为唯一共享来源
- 所有运行时持久化写入 `storage/`
