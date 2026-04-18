# apps/api API 与运维基线

更新时间：2026-04-18

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
- `POST /api/analyze`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/traces/:traceId`

## 3. 当前运行时合同

### 3.1 Whisper / ASR

- 本地转写：
  - 通过隔离 Python worker 调用 `faster-whisper`
  - 需要现有 Python 运行时、`faster-whisper` 依赖和本地 `CTranslate2` 模型目录
  - GPU 优先请求 `cuda`，并优先复用已存在的 CUDA/cuDNN 动态库路径
  - 当前不提供托管模型下载或依赖安装
- 远程转写：
  - 通过 OpenAI-compatible `/audio/transcriptions`
  - 会对空 `segments` 和异常时间戳做错误分类

### 3.2 LLM / 摘要 / 导图

- 通过 OpenAI-compatible `/chat/completions`
- 纠错模式：`off`、`strict`、`rewrite`
- 回退链：
  - `generated_by=llm|fallback`
  - `fallback_reason`
  - `D/fusion/manifest.json`

### 3.3 VQA / 检索

- 默认主链：transcript-only `vector-index`
- 预热产物：`D/vqa-prewarm/index.json`
- 当前边界：
  - 统一使用 transcript 向量索引 + rerank 的单路线检索

### 3.4 Ollama / 模型管理

- `/config/ollama`：配置持久化 + 状态探测
- `/config/ollama/restart-service`：Windows 下会按当前 `executable_path`、`models_dir`、`base_url` 执行项目内重启并轮询可达性
- `/config/ollama/migrate-models`：更新目标目录配置并返回说明；当前不搬迁现有模型文件
- `/config/models/:modelId/download`：
  - 已就绪模型返回 completed snapshot
  - 未就绪模型返回说明性 failed / guidance snapshot
  - 当前不触发 `Ollama pull`
- Ollama 模型安装状态：
  - 以 `/api/tags` 返回的真实模型标签为准
  - 不再通过 `models_dir/<model-id-sanitized>` 伪路径判断是否已安装

### 3.5 自检

- LLM / Embedding 会复用 `/models` 远程探测
- 自检结果包含 `check_depth`

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
  - 检查 Python 是否可执行，以及 `apps/api/python` 或配置路径下是否已安装 `faster-whisper`
  - 检查 `storage/models/whisper/`、自定义 Whisper 模型目录，或其下的 `whisper-default/` 是否包含 `config.json + model.bin`
  - 检查 CUDA/cuDNN 动态库是否可通过 Ollama 安装目录或系统 `PATH` 被发现
  - 检查远程 ASR 提供方配置
- 问答与生成失败：
  - 检查 `storage/model_config.json`
  - 检查 Ollama 服务或远端 OpenAI-compatible 配置
  - 检查 `/models` 探测是否包含当前配置模型
- 事件回放：
  - 检查 `storage/event-logs/<task_id>.jsonl`
  - 检查 `storage/event-logs/traces/*.jsonl`
