# VidGnost 前端字段到后端字段映射基线（首版）

## 1. 适用范围

本文件定义当前前端页面与 `backend` 的字段映射规则，作为实现与联调的统一基线。

## 2. 任务领域模型

- `workflow`：`notes | vqa`
- `status`：`queued | running | completed | failed | cancelled`
- `steps[]`：`id/name/status/progress/duration/logs`
- 时间字段统一使用 UTC ISO8601 字符串
- 数值字段统一使用显式单位：
  - 文件大小：字节（`*_bytes`）
  - 时长：秒（`*_seconds`）

## 3. 页面字段映射

## 3.1 新建任务页（new-task-view）

| 前端字段/行为 | 接口 | 后端字段 | 存储字段 |
|---|---|---|---|
| 工作流选择 `selectedWorkflow` | `POST /api/tasks/url` / `POST /api/tasks/path` / `POST /api/tasks/upload` / `POST /api/tasks/upload/batch` | `workflow` | `TaskRecord.workflow` |
| 单文件上传开始分析 | `POST /api/tasks/upload` | `task_id/status/workflow/initial_steps` | `tasks/records/<task_id>.json` |
| 多文件上传开始分析 | `POST /api/tasks/upload/batch` | `strategy/tasks[]` | 多条 `TaskRecord` |
| 初始步骤渲染 | 创建响应 `initial_steps[]` | `TaskStepItem` | 运行时计算 |

## 3.2 任务处理页（task-processing-view）

| 前端字段/行为 | 接口 | 后端字段 |
|---|---|---|
| 顶部总进度 | `GET /api/tasks/{task_id}` | `overall_progress` |
| 当前步骤/步骤条 | `GET /api/tasks/{task_id}` | `current_step_id` + `steps[]` |
| 步骤耗时 | `GET /api/tasks/{task_id}` | `steps[].duration` |
| 预计剩余（可选） | `GET /api/tasks/{task_id}` | `eta_seconds` |
| 转写片段列表 | `GET /api/tasks/{task_id}` | `transcript_segments[]` |
| 实时事件流 | `GET /api/tasks/{task_id}/events` | `task_started/step_updated/transcript_chunk/artifact_ready/task_completed/task_failed` |
| 结果编辑保存 | `PATCH /api/tasks/{task_id}/artifacts` | `summary_markdown/notes_markdown/mindmap_markdown` |
| 导出 | `GET /api/tasks/{task_id}/export/{kind}` | `notes/mindmap/transcript/srt/vtt/bundle` |
| VQA 搜索/问答 | `POST /api/search` / `POST /api/chat` / `POST /api/chat/stream` | `results[]/hits[]/trace_id` |

## 3.3 历史页（history-view）

| 前端字段/行为 | 接口 | 后端字段 |
|---|---|---|
| 统计卡片 | `GET /api/tasks/stats` | `total/notes/vqa/completed` |
| 搜索 | `GET /api/tasks?q=` | `q` |
| 工作流筛选 | `GET /api/tasks?workflow=` | `workflow=notes/vqa/all` |
| 排序 | `GET /api/tasks?sort_by=` | `date/name/size` |
| 列表展示 | `GET /api/tasks` | `items[]` |
| 最近任务 | `GET /api/tasks/recent` | `items[]` |
| 打开文件位置 | `GET /api/tasks/{task_id}/open-location` | `path` |
| 删除 | `DELETE /api/tasks/{task_id}` | 204 |

## 3.4 设置页（settings-view）

| 前端模块 | 接口 | 后端字段 |
|---|---|---|
| 模型列表 | `GET /api/config/models` | `items[]` |
| 模型重载 | `POST /api/config/models/reload` | `model_id?` |
| 模型配置更新 | `PATCH /api/config/models/{model_id}` | `path/status/load_profile/quantization/max_batch_size/enabled` |
| 提示词模板列表 | `GET /api/config/prompts` | `templates[]/selection` |
| 提示词模板 CRUD | `POST/PATCH/DELETE /api/config/prompts/templates` | `channel/name/content` |
| 模板选择 | `PUT /api/config/prompts/selection` | `correction/notes/mindmap/vqa` |
| 外观与语言 | `GET/PUT /api/config/ui` | `language/font_size/auto_save` |

## 3.5 系统自检页（diagnostics-view）

| 前端字段/行为 | 接口 | 后端字段 |
|---|---|---|
| 开始检查 | `POST /api/self-check/start` | `session_id` |
| 检查进度与结果 | `GET /api/self-check/{session_id}/report` | `progress/steps/issues/status` |
| 检查流式事件 | `GET /api/self-check/{session_id}/events` | `self_check_*` 事件 |
| 运行时信息 | `GET /api/runtime/metrics` | `uptime_seconds/cpu_percent/memory_*/gpu_*` |

## 4. 错误响应契约

统一错误结构：

```json
{
  "code": "ERROR_CODE",
  "message": "human readable message",
  "hint": "actionable hint",
  "retryable": false,
  "detail": {}
}
```

## 5. 存储字段映射

- 任务记录：`backend/storage/tasks/records/*.json`
- 任务产物：`backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
- 任务分析结果：`backend/storage/tasks/analysis-results/<task_id>/<stage>.json`
- 事件日志：`backend/storage/event-logs/<task_id>.jsonl`
- VQA trace：`backend/storage/event-logs/traces/*.jsonl`
- 配置中心：
  - `backend/storage/model_config.json`
  - `backend/storage/config.toml`
  - `backend/storage/models/catalog.json`
  - `backend/storage/config/ui_settings.json`
  - `backend/storage/prompts/**`
