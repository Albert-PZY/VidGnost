# VidGnost 前端字段到 backend-ts 字段映射基线

更新时间：2026-04-15

## 1. 适用范围

本文件定义当前前端页面与 `backend-ts` 的字段映射规则，作为实现与联调的统一基线。

## 2. 任务领域模型

- `workflow`：`notes | vqa`
- `status`：`queued | running | paused | completed | failed | cancelled`
- `steps[]`：`id/name/status/progress/duration/logs`
- 时间字段统一使用 UTC ISO 字符串
- 数值字段统一使用显式单位：
  - 文件大小：`*_bytes`
  - 时长：`*_seconds`

## 3. 页面字段映射

### 3.1 新建任务页

| 前端字段/行为 | 接口 | 后端字段 | 存储字段 |
| --- | --- | --- | --- |
| 工作流选择 `selectedWorkflow` | `POST /api/tasks/url` / `POST /api/tasks/path` / `POST /api/tasks/upload` / `POST /api/tasks/upload/batch` | `workflow` | `storage/tasks/records/<task_id>.json` |
| 单文件上传开始分析 | `POST /api/tasks/upload` | `task_id/status/workflow/initial_steps` | `storage/uploads/*` + 任务记录 |
| 多文件上传开始分析 | `POST /api/tasks/upload/batch` | `tasks[]` | 多条任务记录 |
| 初始步骤渲染 | 创建响应 | `initial_steps[]` | 运行时计算 |

### 3.2 任务处理页

| 前端字段/行为 | 接口 | 后端字段 |
| --- | --- | --- |
| 顶部总进度 | `GET /api/tasks/:taskId` | `overall_progress` |
| 当前步骤/步骤条 | `GET /api/tasks/:taskId` | `current_step_id` + `steps[]` |
| 步骤耗时 | `GET /api/tasks/:taskId` | `steps[].duration` |
| 预计剩余 | `GET /api/tasks/:taskId` | `eta_seconds` |
| 转写片段列表 | `GET /api/tasks/:taskId` | `transcript_segments[]` |
| 实时事件流 | `GET /api/tasks/:taskId/events` | `TaskStreamEvent` |
| 笔记与导图编辑 | `PATCH /api/tasks/:taskId/artifacts` | `summary_markdown/notes_markdown/mindmap_markdown` |
| 导出 | `GET /api/tasks/:taskId/export/:kind` | `notes/mindmap/transcript/srt/vtt/bundle` |
| VQA 搜索 | `POST /api/search` | `results[]` |
| VQA 流式问答 | `POST /api/chat/stream` | `VqaChatStreamEvent` |

### 3.3 历史页

| 前端字段/行为 | 接口 | 后端字段 |
| --- | --- | --- |
| 统计卡片 | `GET /api/tasks/stats` | `total/notes/vqa/completed` |
| 搜索 | `GET /api/tasks?q=` | `q` |
| 工作流筛选 | `GET /api/tasks?workflow=` | `workflow` |
| 排序 | `GET /api/tasks?sort_by=` | `date/name/size` |
| 最近任务 | `GET /api/tasks/recent` | `items[]` |
| 打开文件位置 | `GET /api/tasks/:taskId/open-location` | `path` |

### 3.4 设置页

| 前端模块 | 接口 | 后端字段 |
| --- | --- | --- |
| 模型列表 | `GET /api/config/models` | `items[]` |
| 模型重载 | `POST /api/config/models/reload` | `state/updated_at` |
| 模型配置更新 | `PATCH /api/config/models/:modelId` | `provider/path/status/load_profile/enabled` |
| 提示词模板列表 | `GET /api/config/prompts` | `templates[]/selection` |
| 提示词模板 CRUD | `POST/PATCH/DELETE /api/config/prompts/templates` | `channel/name/content` |
| 模板选择 | `PUT /api/config/prompts/selection` | `selection` |
| 外观与语言 | `GET/PUT /api/config/ui` | `language/font_size/auto_save` |

### 3.5 自检页

| 前端字段/行为 | 接口 | 后端字段 |
| --- | --- | --- |
| 开始检查 | `POST /api/self-check/start` | `session_id` |
| 检查进度与结果 | `GET /api/self-check/:sessionId/report` | `progress/steps/issues/status` |
| 检查流式事件 | `GET /api/self-check/:sessionId/events` | `SelfCheckStreamEvent` |
| 运行时信息 | `GET /api/runtime/metrics` | `uptime_seconds/cpu_percent/memory_*/gpu_*` |

## 4. 错误响应契约

统一错误结构：

```json
{
  "code": "ERROR_CODE",
  "message": "human readable message",
  "detail": {}
}
```

## 5. 存储字段映射

- 任务记录：`storage/tasks/records/*.json`
- 任务产物：`storage/tasks/stage-artifacts/<task_id>/<stage>/**`
- 任务分析结果：`storage/tasks/analysis-results/<task_id>/<stage>.json`
- 事件日志：`storage/event-logs/<task_id>.jsonl`
- VQA trace：`storage/event-logs/traces/*.jsonl`
- 配置中心：
  - `storage/model_config.json`
  - `storage/config.toml`
  - `storage/models/catalog.json`
  - `storage/config/ui_settings.json`
  - `storage/prompts/**`
