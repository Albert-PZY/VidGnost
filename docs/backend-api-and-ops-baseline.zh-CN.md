# apps/api API 与运维基线

更新时间：2026-04-15

## 1. 运行入口

- 后端目录：`apps/api`
- 根启动脚本：
  - Windows：`start-all.ps1`
  - Linux/macOS/WSL：`start-all.sh`
- 脚本包装器：
  - `scripts/bootstrap-and-run.ps1`
  - `scripts/bootstrap-and-run.sh`
- 默认监听：
  - API：`http://127.0.0.1:8666/api`
  - 前端开发服务器：`http://127.0.0.1:6221`

## 2. 接口清单

### 2.1 健康与运行态

- `GET /api/health`
- `GET /api/runtime/metrics`
- `GET /api/runtime/paths`

### 2.2 任务链路

- `POST /api/tasks/url`
- `POST /api/tasks/path`
- `POST /api/tasks/upload`
- `POST /api/tasks/upload/batch`
- `GET /api/tasks`
- `GET /api/tasks/stats`
- `GET /api/tasks/recent`
- `GET /api/tasks/:taskId`
- `GET /api/tasks/:taskId/source-media`
- `GET /api/tasks/:taskId/artifacts/file`
- `GET /api/tasks/:taskId/open-location`
- `PATCH /api/tasks/:taskId/title`
- `PATCH /api/tasks/:taskId/artifacts`
- `DELETE /api/tasks/:taskId`
- `POST /api/tasks/:taskId/cancel`
- `POST /api/tasks/:taskId/pause`
- `POST /api/tasks/:taskId/resume`
- `POST /api/tasks/:taskId/rerun-stage-d`
- `GET /api/tasks/:taskId/events`
- `GET /api/tasks/:taskId/export/:kind`

### 2.3 设置中心

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
- `POST /api/config/models/migrate-local`
- `POST /api/config/models/:modelId/download`
- `DELETE /api/config/models/:modelId/download`
- `GET /api/config/prompts`
- `PUT /api/config/prompts/selection`
- `POST /api/config/prompts/templates`
- `PATCH /api/config/prompts/templates/:templateId`
- `DELETE /api/config/prompts/templates/:templateId`
- `GET /api/config/ui`
- `PUT /api/config/ui`

### 2.4 自检与问答

- `POST /api/self-check/start`
- `POST /api/self-check/:sessionId/auto-fix`
- `GET /api/self-check/:sessionId/report`
- `GET /api/self-check/:sessionId/events`
- `POST /api/search`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/traces/:traceId`

## 3. 模型与运行时基线

- Whisper：
  - 运行方式：`whisper.cpp` CLI 或兼容 ASR API
  - 默认模型目录：`storage/models/whisper`
  - 默认模型条目：`ggml-small.bin`
- LLM：
  - 默认提供方：`ollama`
  - 默认模型：`qwen2.5:3b`
  - 兼容 OpenAI-style chat/completions
- Embedding / VLM / Rerank：
  - 默认通过 Ollama 或 OpenAI-compatible API 接入
- 媒体工具：
  - `ffmpeg`
  - `ffprobe`
  - `yt-dlp`

## 4. 存储基线

- 根目录：`storage/`
- 关键文件：
  - `storage/model_config.json`
  - `storage/config.toml`
  - `storage/models/catalog.json`
  - `storage/ollama-runtime.json`
  - `storage/prompts/templates/*.json`
  - `storage/prompts/selection.json`
- 关键目录：
  - `storage/tasks/records/`
  - `storage/tasks/analysis-results/`
  - `storage/tasks/stage-artifacts/`
  - `storage/vector-index/`
  - `storage/event-logs/`
  - `storage/uploads/`
  - `storage/tmp/`

## 5. 运维检查入口

- 构建类型检查：`pnpm typecheck`
- 单元测试：`pnpm test`
- 生产构建：`pnpm build`
- OpenSpec 检查：`node scripts/check-openspec.mjs`
- 工作区清理：
  - `powershell -ExecutionPolicy Bypass -File .\\scripts\\clean-workspace.ps1`
  - `bash ./scripts/clean-workspace.sh`

## 6. 故障定位入口

- 启动失败：
  - 检查端口 `8666`
  - 检查 `pnpm install` 是否完成
  - 检查 `apps/api` 类型错误或运行期异常
- 媒体处理失败：
  - 检查 `ffmpeg`、`ffprobe`、`yt-dlp` 是否可执行
- Whisper 转写失败：
  - 检查 `storage/models/whisper/`
  - 检查 `VIDGNOST_WHISPER_BIN` 或兼容 ASR 配置
- 问答与生成失败：
  - 检查 `storage/model_config.json`
  - 检查 Ollama 服务或远端 OpenAI-compatible 配置
- 事件回放：
  - 检查 `storage/event-logs/<task_id>.jsonl`
  - 检查 `storage/event-logs/traces/*.jsonl`
