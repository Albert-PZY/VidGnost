# backend API 与运维基线（首版）

## 1. 运行入口

- 后端目录：`backend`
- 启动脚本：
  - Windows：`scripts/bootstrap-and-run.ps1`
  - Linux/macOS/WSL：`scripts/bootstrap-and-run.sh`
- 启动脚本将后端工作目录固定为 `backend`。

## 2. 接口清单（按页面能力）

## 2.1 任务链路

- `POST /api/tasks/url`
- `POST /api/tasks/path`
- `POST /api/tasks/upload`
- `POST /api/tasks/upload/batch`
- `GET /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}/events`（SSE）
- `POST /api/tasks/{task_id}/cancel`
- `POST /api/tasks/{task_id}/rerun-stage-d`
- `PATCH /api/tasks/{task_id}/title`
- `PATCH /api/tasks/{task_id}/artifacts`
- `GET /api/tasks/{task_id}/export/{kind}`
- `DELETE /api/tasks/{task_id}`
- `GET /api/tasks/stats`
- `GET /api/tasks/recent`
- `GET /api/tasks/{task_id}/open-location`

## 2.2 VQA 链路

- `POST /api/search`
- `POST /api/chat`
- `POST /api/chat/stream`（SSE）
- `POST /api/analyze`
- `GET /api/traces/{trace_id}`

## 2.3 设置中心

- `GET /api/config/llm`
- `PUT /api/config/llm`
- `GET /api/config/whisper`
- `PUT /api/config/whisper`
- `PUT /api/config/whisper/runtime-libraries`
- `POST /api/config/whisper/runtime-libraries/install`
- `POST /api/config/whisper/runtime-libraries/pause`
- `POST /api/config/whisper/runtime-libraries/resume`
- `GET /api/config/prompts`
- `PUT /api/config/prompts/selection`
- `POST /api/config/prompts/templates`
- `PATCH /api/config/prompts/templates/{template_id}`
- `DELETE /api/config/prompts/templates/{template_id}`
- `GET /api/config/models`
- `POST /api/config/models/reload`
- `PATCH /api/config/models/{model_id}`
- `GET /api/config/ui`
- `PUT /api/config/ui`

## 2.4 自检与运行态

- `POST /api/self-check/start`
- `POST /api/self-check/{session_id}/auto-fix`
- `GET /api/self-check/{session_id}/report`
- `GET /api/self-check/{session_id}/events`（SSE）
- `GET /api/runtime/metrics`
- `GET /api/health`

## 3. RAG 实现基线

- 检索链路：`Dense + Sparse + RRF + Rerank`
- Dense：ChromaDB `PersistentClient`
  - 路径：`backend/storage/vector-index/chroma-db`
  - 集合：`video_clips`
- Sparse：SQLite FTS5
  - 路径：`backend/storage/vector-index/sparse-fts5.sqlite3`
- 融合参数：`rrf_k=60`
- 默认召回参数：
  - `dense_top_k=80`
  - `sparse_top_k=120`
  - `fused_top_k=40`
  - `rerank_top_n=8`
- 命中返回包含：`dense_score/sparse_score/rrf_score/rerank_score/final_score`
- Trace 日志路径：`backend/storage/event-logs/traces`

## 4. 错误处理基线

统一错误响应字段：

- `code`
- `message`
- `hint`
- `retryable`
- `detail`

## 5. 验证命令

```bash
cd backend
uv run pytest
uv run python -m compileall app
```

## 6. 故障定位入口

- 启动失败：
  - 检查 `uv sync` 与 Python 3.12 环境
  - 检查端口 `8666` 占用
- 任务链路异常：
  - 查看 `backend/storage/event-logs/<task_id>.jsonl`
- VQA 追踪：
  - 查看 `backend/storage/event-logs/traces/*.jsonl`
- 配置回显异常：
  - 检查 `backend/storage/model_config.json`
  - 检查 `backend/storage/config.toml`
  - 检查 `backend/storage/models/catalog.json`
  - 检查 `backend/storage/config/ui_settings.json`
