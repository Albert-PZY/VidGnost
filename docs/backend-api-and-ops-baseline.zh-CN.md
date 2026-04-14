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
- `GET /api/config/ollama`
- `PUT /api/config/ollama`
- `POST /api/config/ollama/migrate-models`
- `POST /api/config/ollama/restart-service`
- `GET /api/config/whisper`
- `PUT /api/config/whisper`
- `GET /api/config/prompts`
- `PUT /api/config/prompts/selection`
- `POST /api/config/prompts/templates`
- `PATCH /api/config/prompts/templates/{template_id}`
- `DELETE /api/config/prompts/templates/{template_id}`
- `GET /api/config/models`
- `POST /api/config/models/reload`
- `PATCH /api/config/models/{model_id}`
- `POST /api/config/models/migrate-local`
- `POST /api/config/models/{model_id}/download`
- `DELETE /api/config/models/{model_id}/download`
- `GET /api/config/ui`
- `PUT /api/config/ui`

## 2.4 自检与运行态

- `POST /api/self-check/start`
- `POST /api/self-check/{session_id}/auto-fix`
- `GET /api/self-check/{session_id}/report`
- `GET /api/self-check/{session_id}/events`（SSE）
- `GET /api/runtime/metrics`
- `GET /api/health`

## 3. 模型与 RAG 实现基线

## 3.1 模型运行时与安装基线

- `whisper-default`
  - 运行时：`faster-whisper`
  - 安装方式：后端托管下载
  - 安装状态来源：`backend/storage/model-hub/faster-whisper-small`
- `llm-default`
  - 提供者：`ollama`
  - 默认模型：`qwen2.5:3b`
  - 调用方式：本地 Ollama `/v1`
- `embedding-default`
  - 提供者：`ollama`
  - 默认模型：`bge-m3`
  - 调用方式：Ollama `/api/embed`
- `vlm-default`
  - 提供者：`ollama`
  - 默认模型：`moondream`
  - 调用方式：Ollama Vision Chat
- `rerank-default`
  - 提供者：`ollama`
  - 默认模型：`sam860/qwen3-reranker:0.6b-q8_0`
  - 调用方式：本地重排模型受控 JSON 打分
- 非 Whisper 托管模型通过 `POST /api/config/models/{model_id}/download` 触发本地 Ollama 模型安装
- `GET /api/config/models` 返回的非 Whisper 已安装路径为当前生效的绝对模型目录，便于目录迁移后继续用于自检、设置展示和运行态检查
- Ollama 运行时配置保存时会同步系统 `PATH` 与 `OLLAMA_MODELS`
- `POST /api/config/ollama/restart-service` 会先清理本地 `ollama.exe` 与 `ollama app.exe` 相关进程，并确认 `11434` 端口释放后再启动本地服务
- 当 Ollama 服务尚未返回 `/api/tags` 时，`GET /api/config/models` 仍会基于已配置 `models_dir` 下的本地 manifest 目录识别已安装模型
- `POST /api/config/models/migrate-local` 会批量迁移当前项目中的 Whisper 本地模型目录与已安装的 Ollama 管理目录，并在完成后自动重启本地 Ollama 服务

## 3.2 RAG 实现基线

- 检索链路：`Dense + Sparse + RRF + Rerank`
- Dense：Ollama Embedding + ChromaDB `PersistentClient`
  - 路径：`backend/storage/vector-index/chroma-db`
  - 集合：`video_clips`
- Sparse：SQLite FTS5
  - 路径：`backend/storage/vector-index/sparse-fts5.sqlite3`
- 融合参数：`rrf_k=60`
- 视觉理解：Ollama Vision Chat，结果持久化到任务 `frames/index.json`
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
- 本地模型不可用：
  - 检查 Ollama 服务 `http://127.0.0.1:11434`
  - 检查 `GET /api/config/models` 中对应条目的 `provider/model_id/is_installed/download`
  - 检查 `backend/storage/models/catalog.json` 中是否仍保留旧模型 ID
