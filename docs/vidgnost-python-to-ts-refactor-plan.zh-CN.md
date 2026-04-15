# VidGnost Python 全量重构为 TypeScript 执行方案

更新时间：2026-04-15

## 1. 文档目标

本文档用于指导当前 VidGnost 项目将后端 Python 运行链路完整重构为 TypeScript 的执行工作，目标是：

- 统一项目主业务语言为 TypeScript
- 在不破坏现有 Electron + React 前端体验的前提下完成后端替换
- 保留当前本地优先、任务型、流式反馈、可回放导出的产品特征
- 提供一份可逐项勾选的实施清单，便于排期、分工和验收
- 明确列出当前技术栈与重构后推荐技术栈，便于逐项对比校正

## 2. 重构定义与边界

这里的“把 Python 完全重构为 TS”建议按下面的工程定义执行：

- 业务编排、HTTP API、SSE、配置管理、任务存储、检索问答、模型编排、自检、运行时治理全部迁移到 TypeScript
- 前端继续保持 React + Electron，不引入 SSR
- 允许继续依赖外部原生工具或独立二进制，只要核心业务代码不再由 Python 承担
- 可继续保留的外部工具包括：
  - `ffmpeg` / `ffprobe`
  - `yt-dlp`
  - `Ollama`
  - Mermaid CLI 渲染器
  - Whisper 对应的非 Python 运行时实现，例如 `whisper.cpp`

不建议把“无 Python”误解成“无任何原生依赖”。当前产品本身就依赖本地多媒体工具、模型运行时和桌面壳层，完全纯 JS 并不是这类桌面 AI 工作台的合理目标。

## 3. 当前项目分析摘要

基于当前仓库代码与文档，项目现状可以概括为：

- 前端已经是 TypeScript 栈，包含 React 19、Vite 6、Electron 31、Zustand 等
- 后端仍是完整 Python 服务，承担 API、任务编排、Whisper 转写、LLM 摘要、RAG 检索、模型管理、自检和系统指标采集
- 前后端通过 `HTTP JSON + SSE` 通信，前端 API 依赖后端接口较深，适合“先保持协议兼容，再替换实现”
- 当前 Python 后端不是薄胶水层，而是重逻辑系统
- 当前技术债不在“代码是否能跑”，而在“语言分裂、契约重复、模块过大、存储形式分散”

### 3.1 规模量化

- Python 文件数：`93`
- Python 总行数：`23191`
- 其中后端服务文件数：`44`
- 后端服务总行数：`15184`
- API 文件数：`8`
- API 总行数：`2367`
- 后端测试文件数：`31`
- 后端测试总行数：`4233`
- 前端 TS/TSX 文件数：`60`
- 前端 TS/TSX 总行数：`18013`
- 当前 API 路由处理器数量：`53`

### 3.2 当前高风险热点

以下模块应视为迁移难点，而不是普通搬运对象：

| 模块 | 约行数 | 现职责 | 重构风险 |
| --- | ---: | --- | --- |
| `backend/app/services/task_runner.py` | 2691 | 全任务编排、阶段状态、暂停恢复、事件派发、工件写入 | 体量最大，耦合 ingestion/transcription/summarizer/vqa/store |
| `backend/app/services/summarizer.py` | 1436 | 转录纠错、摘要、笔记、导图、Mermaid 修复和渲染 | 涉及多轮 LLM、子进程、提示词模板和产物规范 |
| `backend/app/services/vqa_ollama_retriever.py` | 1212 | Dense/Sparse/RRF/Rerank 检索主链路 | 同时耦合 SQLite FTS5、Chroma、视觉帧描述和模型调用 |
| `backend/app/services/vqa_model_runtime.py` | 682 | VLM / Embedding / Rerank / 多模态路由 | 与模型目录、Ollama、OpenAI Compatible 适配深度绑定 |
| `backend/app/services/transcription.py` | 657 | Whisper 下载、缓存、模型复用、分段转写 | 当前实现高度依赖 `faster-whisper` |
| `backend/app/services/self_check.py` | 638 | 本地环境检查、自动修复、运行时诊断 | 牵涉磁盘、命令、模型、GPU、依赖探测 |
| `backend/app/api/routes_tasks.py` | 1452 | 任务入口、工件导出、字幕、SSE 和查询接口 | 直接决定前端兼容性与切换成本 |

### 3.3 当前结构问题

- 前后端类型重复定义：
  - 后端在 `backend/app/schemas.py`
  - 前端在 `frontend/lib/types.ts`
  - 这会导致协议漂移风险
- Mermaid 渲染从 Python 后端反向调用 `pnpm exec mmdc`
  - 说明当前系统已经存在跨语言、跨运行时倒挂
- 任务数据采用多种持久化方式并行存在：
  - JSON
  - JSONL
  - SQLite FTS5
  - Chroma PersistentClient
- 后端能力不是单一 API 服务，而是“本地 AI 任务平台”
  - 任何试图一次性整体改写的方案都很容易失控

## 4. 当前项目技术栈清单

本节用于完整盘点当前实际技术栈，便于后续对照。

### 4.1 当前总体架构

- 前端：`React + TypeScript + Vite` 的 CSR 桌面工作台
- 桌面壳层：`Electron`
- 后端：`Python + FastAPI + Uvicorn`
- 通信：`HTTP JSON + SSE`
- 运行模式：本地开发主要通过两个独立进程运行，Electron 前端连接本地后端端口

### 4.2 当前前端技术栈

#### 运行与构建

- `Node.js`
- `pnpm`
- `Vite 6`
- `React 19`
- `TypeScript 5.7`
- `Electron 31`

#### UI 与状态管理

- `Tailwind CSS 4`
- `@tailwindcss/postcss`
- `Radix UI`
- `Lucide React`
- `next-themes`
- `react-hot-toast`
- `react-resizable-panels`
- `@tanstack/react-virtual`
- `Zustand`
- `@uiw/react-md-editor`
- `@uiw/react-markdown-preview`
- `Mermaid`

#### 前端工程形态

- Vite SPA，不使用 Next.js 运行链路
- Electron 主进程与 preload 使用 CommonJS 文件：
  - `frontend/electron/main.cjs`
  - `frontend/electron/preload.cjs`
  - `frontend/electron/splash-preload.cjs`
- 前端通过 `fetch` 和 `EventSource` 访问后端

### 4.3 当前后端技术栈

#### 语言与基础框架

- `Python 3.12`
- `uv`
- `FastAPI`
- `Uvicorn`
- `Pydantic v2`
- `orjson`
- `aiofiles`

#### 媒体接入与处理

- `yt-dlp`
- `ffmpeg-python`
- 本地 `ffmpeg` / `ffprobe`

#### 转写与音频处理

- `faster-whisper`
- 独立 GPU Stage Worker Python 进程
- Windows GPU 运行库探测与环境注入

#### 模型与远程调用

- `openai` Python SDK
- `httpx[http2]`
- `Ollama`
- OpenAI Compatible API 适配

#### 检索与问答

- `chromadb`
- `sqlite3` 标准库 + `FTS5`
- Dense + Sparse + `RRF` + `Rerank`
- 视觉帧抽取与视觉文本入库

#### 本地系统治理

- `psutil`
- `nvidia-smi`
- `cryptography`
- 子进程：`subprocess`

### 4.4 当前数据与持久化栈

- 任务记录：文件系统 JSON
- 事件日志：JSONL
- Trace：JSONL
- 稀疏检索：SQLite FTS5
- 向量检索：Chroma PersistentClient
- 工件：Markdown、字幕、图片、导出压缩包
- 配置：JSON / TOML
- 模板：JSON

### 4.5 当前测试与验证栈

- `pytest`
- `pytest-asyncio`
- 前端类型检查：`pnpm exec tsc --noEmit`
- 前端构建：`pnpm build`

### 4.6 当前运行与脚本栈

- 根启动脚本：`PowerShell` / `Shell`
- 后端依赖安装：`uv sync`
- 前端依赖安装：`pnpm install`
- 桌面联调：`concurrently + wait-on + electron`

## 5. 推荐的重构后技术栈

本节给出推荐目标栈。原则是：

- 尽量复用当前前端与桌面形态
- 保持现有 HTTP/SSE 契约，降低前端改造量
- 先完成语言统一，再考虑第二阶段的架构进一步收敛

### 5.1 推荐总体架构

- 统一语言：`TypeScript`
- 统一包管理：根级 `pnpm workspace`
- 目标形态：
  - `frontend/` 继续承载 React + Electron UI
  - 新建 `backend-ts/` 承载 Node/TS 后端
  - 新建 `packages/contracts/` 承载前后端共享协议类型
  - 新建 `packages/shared/` 承载通用工具、路径、日志、错误模型
- 运行模式：
  - 第一阶段保留 `http://127.0.0.1:8666/api` 本地服务形态
  - Electron 仍通过 HTTP/SSE 接后端
  - 切换成本最低

### 5.2 推荐后端 TS 栈

#### 语言与运行时

- `Node.js 22 LTS`
- `TypeScript 5.x`
- `pnpm`
- 开发运行：`tsx`
- 构建打包：`tsup`

#### API 与协议

- `Fastify 5`
- `@fastify/cors`
- `@fastify/multipart`
- `fastify-sse-v2` 或等价 SSE 方案
- `zod`
- `fastify-type-provider-zod`

#### 存储与查询

- `better-sqlite3`
- `SQLite FTS5`
- 文件系统工件目录继续保留
- JSONL 事件日志与 Trace 可继续兼容保留

#### 任务编排与进程控制

- `worker_threads`
- `AbortController`
- `p-limit` 或 `p-queue`
- `execa`

#### 模型与远程调用

- Node 原生 `fetch` / `undici`
- `Ollama` 继续保留
- OpenAI Compatible 调用改为 TS 适配层

#### 媒体与转写

- `ffmpeg` / `ffprobe` CLI
- `yt-dlp` CLI
- `whisper.cpp` 二进制 + TS 适配层

说明：

- 这是最现实的“去 Python”方案
- 不建议在第一阶段用纯 JS 模型库硬顶本地转写
- 应优先保证桌面稳定性和可部署性

#### 检索与问答

- 稀疏检索：`SQLite FTS5`
- Dense 检索：
  - 第一阶段：文件缓存向量 + TS 余弦相似度检索
  - 第二阶段：按性能数据决定是否接入 `hnswlib-node` 或其他 ANN 方案
- 融合逻辑：TS 实现 `RRF + Rerank`

#### 日志与可观测

- `pino`
- 结构化 JSON 日志
- 任务事件日志继续以 JSONL 方式落盘

#### 测试

- `Vitest`
- `Playwright`
- API 集成测试可基于 Fastify 注入或本地 HTTP 实例

### 5.3 推荐前后端共享栈

- `packages/contracts`
  - 存放 Zod schema
  - 导出前后端共享类型
  - 导出接口路径、SSE 事件 schema、错误码枚举
- `packages/shared`
  - 日志工具
  - 文件路径工具
  - 时间格式与 ID 生成
  - 任务状态机常量

## 6. 当前技术栈与重构后技术栈对照表

| 领域 | 当前技术栈 | 推荐重构后技术栈 | 说明 |
| --- | --- | --- | --- |
| 后端语言 | Python 3.12 | TypeScript 5.x | 完成语言统一 |
| 后端运行时 | Uvicorn / ASGI | Node.js 22 | 与前端同语言运行时 |
| API 框架 | FastAPI | Fastify 5 | 保持轻量、适合本地服务 |
| 数据校验 | Pydantic | Zod | 与前端共享更直接 |
| 前后端类型 | 手写重复定义 | `packages/contracts` 共享 | 消除协议漂移 |
| JSON 性能 | orjson | 原生 JSON + Fastify 序列化 | 足够满足本地桌面服务 |
| 文件上传 | FastAPI Multipart | `@fastify/multipart` | 保持接口能力 |
| SSE | Starlette StreamingResponse | Fastify SSE 插件/原生流 | 保持前端订阅方式 |
| 任务编排 | `asyncio` + 自定义 TaskRunner | `worker_threads` + `AbortController` + queue | 更贴合 Node 模型 |
| 子进程调用 | `subprocess` | `execa` | 更好地处理流和取消 |
| 媒体处理 | `ffmpeg-python` + `ffmpeg` | 直接调用 `ffmpeg` CLI | 减少绑定层 |
| 视频下载 | `yt-dlp` Python 包 | `yt-dlp` CLI | 降低语言耦合 |
| 转写 | `faster-whisper` | `whisper.cpp` + TS 适配层 | 去 Python 的关键替换 |
| GPU 运行库治理 | Python 探测 + PATH/DLL 注入 | TS 进程环境管理 | 可继续保留 Windows 逻辑 |
| 模型调用 | `openai` SDK + `httpx` | 原生 `fetch`/`undici` | 精简依赖 |
| Ollama 管理 | Python 客户端 + `psutil` | TS 客户端 + `execa` + `systeminformation` 或原生命令 | 保持本地模型治理 |
| 元数据存储 | 文件 JSON | SQLite + 文件工件 | 提升一致性和事务性 |
| Prompt 模板 | JSON 文件 | SQLite 或兼容 JSON 迁移层 | 建议统一收口 |
| 事件日志 | JSONL | JSONL | 可保持兼容 |
| Trace | JSONL | JSONL + SQLite 索引可选 | 第一阶段不必重写 |
| 稀疏检索 | SQLite FTS5 | SQLite FTS5 | 直接保留 |
| 向量库 | Chroma PersistentClient | 向量文件缓存 + TS Dense 检索 | 避免引入 Python sidecar |
| RRF / Rerank | Python 自研逻辑 | TS 自研逻辑 | 算法层可直接迁移 |
| 自检 | Python 服务类 | TS runtime diagnostics 模块 | 需保留本地环境探测能力 |
| 系统指标 | `psutil` + `nvidia-smi` | `systeminformation` / 原生命令 + `nvidia-smi` | 以 Windows 兼容为主 |
| 后端测试 | pytest | Vitest | 统一 JS/TS 测试体系 |
| 启动脚本 | `uv + pnpm` 双栈 | `pnpm` 单栈 | 开发和 CI 更简单 |

## 7. 模块迁移映射

下面是建议的 Python -> TypeScript 模块映射，用于拆解实施任务。

| 当前 Python 模块 | 目标 TS 模块 | 迁移说明 |
| --- | --- | --- |
| `backend/app/main.py` | `backend-ts/src/server/app.ts` | 负责 Fastify app 装配与生命周期 |
| `backend/app/api/*.py` | `backend-ts/src/routes/*.ts` | 路由按 capability 保持拆分 |
| `backend/app/config.py` | `backend-ts/src/core/config.ts` | 统一环境变量、路径解析、默认值 |
| `backend/app/models.py` | `packages/contracts/src/domain.ts` | 域模型与状态枚举共享化 |
| `backend/app/schemas.py` | `packages/contracts/src/api.ts` | API 请求/响应 schema 共享化 |
| `task_store.py` | `backend-ts/src/modules/tasks/task-repository.ts` | 建议改为 SQLite Repository |
| `events.py` | `backend-ts/src/modules/events/event-bus.ts` | 支持历史回放与 SSE 订阅 |
| `task_runner.py` | `backend-ts/src/modules/tasks/task-orchestrator.ts` | 拆成 orchestrator + stage handlers |
| `ingestion.py` | `backend-ts/src/modules/ingestion/*.ts` | 改为 CLI 适配层 |
| `transcription.py` | `backend-ts/src/modules/asr/asr-service.ts` | 对接 `whisper.cpp` |
| `gpu_stage_worker_client.py` | `backend-ts/src/modules/asr/asr-worker-client.ts` | `worker_threads` 或 child process |
| `workers/gpu_stage_worker.py` | `backend-ts/src/workers/asr-worker.ts` | Node Worker 替代 Python worker |
| `summarizer.py` | `backend-ts/src/modules/summary/summary-service.ts` | 分拆为 correction / notes / mindmap / mermaid |
| `prompt_template_store.py` | `backend-ts/src/modules/prompts/prompt-template-repository.ts` | 与共享 contracts 对齐 |
| `prompt_constants.py` | `backend-ts/src/modules/prompts/default-prompts.ts` | 默认模板静态资源化 |
| `llm_config_store.py` | `backend-ts/src/modules/llm/llm-config-repository.ts` | 配置存储统一 |
| `remote_model_client.py` | `backend-ts/src/modules/llm/openai-compatible-client.ts` | 原生 fetch 流式/非流式调用 |
| `ollama_client.py` | `backend-ts/src/modules/models/ollama-client.ts` | Ollama API 适配 |
| `ollama_service_manager.py` | `backend-ts/src/modules/models/ollama-service-manager.ts` | 进程、端口、目录探测 |
| `model_catalog_store.py` | `backend-ts/src/modules/models/model-catalog-repository.ts` | 模型清单统一管理 |
| `model_download_service.py` | `backend-ts/src/modules/models/model-download-service.ts` | 下载、取消、快照 |
| `model_migration_service.py` | `backend-ts/src/modules/models/model-migration-service.ts` | 目录迁移与任务阻塞校验 |
| `vqa_runtime_service.py` | `backend-ts/src/modules/vqa/vqa-runtime-service.ts` | 串联 search/chat/trace |
| `vqa_ollama_retriever.py` | `backend-ts/src/modules/vqa/retriever.ts` | Dense/Sparse/RRF/Rerank 迁移热点 |
| `vqa_chat_service.py` | `backend-ts/src/modules/vqa/chat-service.ts` | 问答拼装与流式输出 |
| `vqa_trace_store.py` | `backend-ts/src/modules/vqa/trace-store.ts` | JSONL 兼容写入 |
| `self_check.py` | `backend-ts/src/modules/runtime/self-check-service.ts` | 自检主流程 |
| `runtime_metrics.py` | `backend-ts/src/modules/runtime/runtime-metrics-service.ts` | CPU/GPU/内存指标 |
| `whisper_gpu_runtime_service.py` | `backend-ts/src/modules/runtime/whisper-runtime-service.ts` | Windows 运行库探测 |
| `resource_guard.py` | `backend-ts/src/modules/runtime/resource-guard.ts` | 启动告警、配置守护 |
| `ui_settings_store.py` | `backend-ts/src/modules/ui/ui-settings-repository.ts` | UI 设置配置仓储 |

## 8. 推荐目标目录结构

建议采用“并行重构、最终切换”的目录策略。

### 8.1 重构期目录

```text
VidGnost/
├─ backend/                      # 保留现有 Python 后端，作为对照与回归基线
├─ backend-ts/                   # 新建 TS 后端
│  ├─ src/
│  │  ├─ server/
│  │  ├─ routes/
│  │  ├─ core/
│  │  ├─ modules/
│  │  └─ workers/
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ vitest.config.ts
├─ frontend/
├─ packages/
│  ├─ contracts/
│  └─ shared/
├─ docs/
└─ scripts/
```

### 8.2 切换后目录

切换完成后再把 `backend-ts/` 收敛为 `backend/`，不要一开始就改目录名，否则会增加联调和回滚成本。

## 9. 分阶段执行方案清单

以下清单按推荐执行顺序排列。建议严格按阶段推进，不建议一开始就直接重写业务逻辑。

### 阶段 0：建立基线与冻结兼容面

目标：在动手重构前，先把“必须兼容什么”固定下来。

- [ ] 梳理当前 `53` 个 API handler 的路径、方法、参数、返回体、状态码
- [ ] 固化当前 SSE 事件结构：
  - 任务事件流
  - VQA 聊天流
  - 自检事件流
- [ ] 从真实任务记录中抽取至少 5 组样例数据：
  - URL 任务
  - 本地路径任务
  - 上传任务
  - `notes` 工作流
  - `vqa` 工作流
- [ ] 固化关键工件目录结构和命名规则
- [ ] 对现有后端测试做能力归档，形成 Python -> TS 测试迁移清单
- [ ] 记录当前启动命令、端口、环境变量、依赖目录
- [ ] 明确第一阶段“不改”的内容：
  - API 基础前缀继续为 `/api`
  - 前端请求方式继续为 HTTP + SSE
  - 任务产物目录结构第一阶段保持兼容

验收标准：

- 有一份可对照的 API/SSE 契约清单
- 有一组真实样本用于新后端回归
- 所有后续开发都以这套基线为准

### 阶段 1：搭建 TS 后端骨架与统一工作区

目标：让仓库进入“前后端均由 pnpm 管理”的迁移状态。

- [ ] 在仓库根目录建立统一 `pnpm workspace`
- [ ] 新建 `backend-ts/`
- [ ] 新建 `packages/contracts/`
- [ ] 新建 `packages/shared/`
- [ ] 配置根级脚本：
  - `pnpm dev:backend`
  - `pnpm dev:frontend`
  - `pnpm dev:desktop`
  - `pnpm build`
  - `pnpm test`
- [ ] 为 `backend-ts` 接入：
  - `Fastify`
  - `Zod`
  - `Vitest`
  - `tsx`
  - `tsup`
  - `pino`
- [ ] 建立基础模块：
  - `config`
  - `logger`
  - `errors`
  - `server lifecycle`
  - `health route`
- [ ] 保持端口不变，先让 TS 服务能在 `8666` 启动

验收标准：

- TS 后端可以独立启动
- `/api/health` 返回结构与旧服务兼容
- 根脚本可以以 `pnpm` 为唯一入口驱动开发环境

### 阶段 2：抽取共享契约，消除类型重复

目标：先把协议统一，再迁移业务。

- [ ] 把 `backend/app/schemas.py` 中的请求/响应模型迁移到 `packages/contracts`
- [ ] 把 `backend/app/models.py` 中的状态枚举和领域对象迁移到 `packages/contracts`
- [ ] 前端改为从 `packages/contracts` 引用类型，而不是继续维护 `frontend/lib/types.ts` 的独立副本
- [ ] 在 `contracts` 中定义：
  - API 路径常量
  - 错误码枚举
  - SSE 事件 schema
  - 任务阶段和子阶段枚举
- [ ] 生成一份契约快照文件，作为前后端回归基线

验收标准：

- 前端与 TS 后端共享同一套类型源
- 不再新增“后端一份、前端一份”的 DTO 定义

### 阶段 3：迁移基础仓储层与配置层

目标：先把所有“读写配置/记录”的基础设施迁到 TS。

建议策略：

- 第一小步：保留原有文件布局，写兼容 Repository，先跑通
- 第二小步：再把元数据逐步收口到 SQLite

- [ ] 实现 `settings/config` 仓储
- [ ] 实现 `ui settings` 仓储
- [ ] 实现 `prompt template` 仓储
- [ ] 实现 `model catalog` 仓储
- [ ] 实现 `task repository`
- [ ] 实现 `event log` 写入器
- [ ] 实现 `trace log` 写入器
- [ ] 决定第一阶段任务记录策略：
  - 方案 A：兼容 JSON 文件
  - 方案 B：直接迁 SQLite

推荐：

- 第一阶段任务记录和配置优先做“兼容读写层”
- 第二阶段稳定后再统一 SQLite

原因：

- 可以先降低重构风险
- 可以更快做 Python/TS 双后端影子比对

验收标准：

- TS 后端可以完整读写任务、配置、模板和日志
- 前端设置页、任务列表页、历史页可接入 TS 后端

### 阶段 4：迁移公共 API 路由骨架

目标：先让读多写少、风险较低的接口迁移完成。

- [ ] 迁移 `health`
- [ ] 迁移 `runtime paths`
- [ ] 迁移 `runtime metrics`
- [ ] 迁移 `config/ui`
- [ ] 迁移 `config/prompts`
- [ ] 迁移 `config/llm`
- [ ] 迁移 `config/models`
- [ ] 迁移错误处理与统一错误码
- [ ] 对这些路由建立 TS 集成测试

验收标准：

- 前端设置中心可在 TS 后端下正常工作
- 错误响应结构与前端预期兼容

### 阶段 5：迁移任务入口与事件总线

目标：让任务创建、查询、SSE 先在 TS 后端下跑通。

- [ ] 实现 TS 版 `EventBus`
- [ ] 实现任务创建接口：
  - `POST /tasks/url`
  - `POST /tasks/path`
  - `POST /tasks/upload`
  - `POST /tasks/upload/batch`
- [ ] 实现任务查询接口：
  - 列表
  - 详情
  - recent
  - stats
- [ ] 实现任务控制接口：
  - cancel
  - pause
  - resume
- [ ] 实现 `GET /tasks/{task_id}/events`
- [ ] 实现任务删除、标题编辑、工件编辑接口
- [ ] 保持当前 SSE 数据结构兼容

验收标准：

- 任务可以创建并被前端实时感知
- 暂停、恢复、取消在 UI 上可用
- 事件历史回放能力不退化

### 阶段 6：迁移 A/B 阶段媒体接入链路

目标：先完成不依赖 Python AI 库的媒体准备阶段。

- [ ] 用 `execa` 封装 `yt-dlp`
- [ ] 用 `execa` 封装 `ffmpeg` / `ffprobe`
- [ ] 迁移本地文件校验、扩展名校验、时长探测
- [ ] 迁移下载视频、复制本地视频、上传落盘逻辑
- [ ] 迁移音频提取、分块切片、临时目录清理
- [ ] 确保工件路径和任务路径与旧后端兼容

验收标准：

- 阶段 A/B 在 TS 后端下可以稳定跑通
- 路径、文件名、临时目录、产物目录与现有前端兼容

### 阶段 7：迁移 C 阶段转写能力

目标：用 TS 替代 Python Whisper 运行链路。

这是整个重构的第一关键风险点。

推荐执行方式：

- 第一阶段使用 `whisper.cpp` 二进制 + TS 适配层
- 使用 Node Worker 或子进程隔离长时任务
- 保留流式片段回传与中间 checkpoint

详细清单：

- [ ] 明确 `whisper.cpp` 的模型格式、缓存目录、下载策略
- [ ] 设计 TS 版 `AsrService`
- [ ] 设计 TS 版 `AsrWorker`
- [ ] 支持：
  - 模型缓存
  - 设备选择
  - beam size
  - 分块转写
  - segment 级回调
  - 取消与超时
- [ ] 实现转写结果结构与旧后端兼容：
  - `text`
  - `segments`
  - `language`
- [ ] 迁移 Windows GPU 运行时探测逻辑
- [ ] 做一轮基准测试：
  - CPU 路径
  - GPU 路径
  - 长视频稳定性

验收标准：

- 在至少一条 CPU 路径上完成无 Python 转写
- 在 Windows 目标环境下完成 GPU 可用性评估
- 转写结果字段兼容前端与后续 D 阶段

风险提示：

- `faster-whisper` 到 `whisper.cpp` 不只是语言迁移，也是推理后端替换
- 需要预留时间处理模型文件格式、速度和准确率差异

### 阶段 8：迁移 D 阶段总结、纠错与工件生成

目标：完成 `summarizer.py` 的拆解迁移。

建议不要做 1:1 单文件翻译，应拆成 4 个子模块：

- `transcript-correction-service`
- `summary-generation-service`
- `mindmap-generation-service`
- `mermaid-render-service`

详细清单：

- [ ] 迁移 LLM 配置读取与运行模式解析
- [ ] 迁移转录纠错逻辑：
  - strict
  - rewrite
  - off
- [ ] 迁移文本窗口切分与拼接逻辑
- [ ] 迁移 notes 和 mindmap 提示词装配
- [ ] 迁移 Mermaid 代码抽取、修复、渲染
- [ ] Mermaid 渲染改为 TS 后端直接调用 `pnpm exec mmdc`
- [ ] 输出产物保持兼容：
  - `summary_markdown`
  - `notes_markdown`
  - `mindmap_markdown`
  - `fusion_prompt_markdown`
  - `notes-images/*`
- [ ] 建立 golden fixtures，对比 Python/TS 产物结构

验收标准：

- 同一批输入转录在 TS 后端能产出完整工件
- Mermaid 图片和 Markdown 相对路径与现有前端兼容

### 阶段 9：迁移 VQA / RAG 能力

目标：完成检索问答链路的 TS 化。

这是第二个关键风险点。

建议拆分顺序：

1. 先迁 sparse
2. 再迁 dense
3. 再迁 rerank
4. 最后迁流式聊天和 trace

详细清单：

- [ ] 迁移语料构建逻辑：
  - transcript segment
  - frame manifest
  - visual text
- [ ] 迁移 SQLite FTS5 稀疏索引
- [ ] 迁移向量缓存与 Dense 检索
- [ ] 迁移 RRF
- [ ] 迁移 Rerank
- [ ] 迁移 `analyze`
- [ ] 迁移 `search`
- [ ] 迁移 `chat`
- [ ] 迁移 `chat/stream`
- [ ] 迁移 Trace 生成、读写与脱敏输出
- [ ] 做 Python/TS 检索结果比对：
  - top-k 命中
  - citation 格式
  - trace 结构

验收标准：

- TS 后端能完成 task-based 检索与流式回答
- Trace 可被前端 debug 视图正常消费

### 阶段 10：迁移模型目录、下载、迁移和 Ollama 管理

目标：把本地模型治理能力从 Python 迁到 TS。

- [ ] 迁移 `ollama client`
- [ ] 迁移 `ollama service manager`
- [ ] 迁移 `model catalog`
- [ ] 迁移 `model download service`
- [ ] 迁移 `model migration service`
- [ ] 保留：
  - 模型状态
  - 下载进度
  - 迁移确认
  - 运行中任务阻塞检查
- [ ] 迁移 OpenAI Compatible 模型探测与校验

验收标准：

- 设置中心的模型页可用
- Ollama 安装目录、模型目录、服务状态、下载与迁移都可在 TS 后端下正常工作

### 阶段 11：迁移自检、资源守护和运行指标

目标：补齐“可运维性”，否则桌面产品无法稳定交付。

- [ ] 迁移系统自检主流程
- [ ] 迁移自检事件流
- [ ] 迁移自动修复入口
- [ ] 迁移资源守护逻辑
- [ ] 迁移 CPU / 内存 / GPU 指标采集
- [ ] 迁移 Windows 环境探测逻辑
- [ ] 校正提示文案与错误码

验收标准：

- 诊断页和自检页能完整工作
- 出错时可以给出与当前版本同等级的可操作反馈

### 阶段 12：前端接线、双后端影子比对与切换

目标：在不影响业务流的前提下完成切换。

- [ ] 前端新增后端实现切换开关：
  - Python
  - TS
- [ ] 关键页面做双后端比对：
  - 新建任务
  - 历史列表
  - 设置中心
  - 任务处理页
  - 诊断页
- [ ] 对以下输出做影子比对：
  - API 返回结构
  - SSE 事件序列
  - 字幕内容
  - Markdown 工件结构
  - VQA 引用结构
- [ ] 通过比对后，再把默认后端切换到 TS
- [ ] 切换稳定一段时间后，再移除 Python 启动链路

验收标准：

- 前端默认使用 TS 后端且无主流程回归
- Python 后端仅保留为短期回滚路径

### 阶段 13：清理与最终收口

目标：完成语言统一后的仓库收敛。

- [ ] 删除 `uv` 相关后端启动和安装链路
- [ ] 下线 Python 专用脚本、依赖清单和测试入口
- [ ] 更新 README、启动文档、环境要求文档
- [ ] 更新技术栈文档
- [ ] 更新 OpenSpec 中受影响的运行时、接口、状态、配置说明
- [ ] 将 `backend-ts/` 收敛命名为正式后端目录
- [ ] 清理前端中遗留的旧类型和兼容层

验收标准：

- 仓库主路径只保留 TS 业务后端
- 新人只需要 Node.js + pnpm 即可完成主开发链路

## 10. 测试迁移策略

不建议“先写 TS 代码，再慢慢补测试”。建议直接以现有 Python 测试能力清单做镜像迁移。

### 10.1 需要覆盖的测试面

- [ ] 健康检查
- [ ] 任务创建、暂停、恢复、取消、删除
- [ ] 阶段进度和事件流
- [ ] 任务工件更新与导出
- [ ] Whisper 运行时配置与可用性
- [ ] LLM 配置与提示词模板
- [ ] 模型目录、下载、迁移
- [ ] 自检与自动修复
- [ ] VQA 检索、聊天、流式输出、Trace
- [ ] 资源守护和运行指标

### 10.2 推荐测试栈

- 单元测试：`Vitest`
- 路由集成测试：Fastify 注入测试
- 前后端联调回归：`Playwright`
- Golden fixtures：
  - transcript segments
  - task detail payload
  - task stream event
  - vqa chat stream event
  - prompt template bundle

## 11. 风险清单与对应缓释策略

### 11.1 高风险项

| 风险 | 说明 | 缓释策略 |
| --- | --- | --- |
| ASR 运行时替换风险 | `faster-whisper` 不可直接平移到 TS | 优先落 `whisper.cpp` 方案，并单独验证 CPU/GPU 性能 |
| 检索结果漂移 | Dense/Rerank 迁移后结果可能变化 | 先保 sparse，再逐步恢复 dense/rerank，并做影子比对 |
| 数据兼容风险 | 任务记录和工件结构若变化，会直接打坏前端 | 第一阶段保持路径和返回结构兼容 |
| SSE 事件漂移 | 前端运行态高度依赖事件字段和顺序 | 把 SSE 契约放入 `packages/contracts` |
| Windows 环境问题 | 当前有 DLL、PATH、端口、管理员权限等逻辑 | 把 Windows 专用能力独立成 runtime 模块 |
| 一次性大重写失控 | 当前后端功能面过大 | 必须采用并行后端、阶段切换、影子比对 |

### 11.2 明确不建议的做法

- 不建议直接在现有 `backend/` 目录里边写 TS 边删 Python
- 不建议在第一阶段同时修改 API 契约和前端消费方式
- 不建议先大改目录结构再开始迁移业务
- 不建议把 Chroma、SQLite、日志、工件结构一起一次性重做

## 12. 回滚策略

为避免切换失败导致桌面版本不可用，建议保留以下回滚能力：

- [ ] 在重构期并行保留 Python 后端
- [ ] Electron 启动参数支持选择 `python-backend` / `ts-backend`
- [ ] 根启动脚本保留双入口一段时间
- [ ] 关键页面保留“后端连通性失败”降级提示
- [ ] 任何阶段默认只替换单一能力，不跨多个高风险能力同时切换

## 13. 里程碑建议

以下里程碑适合用作项目管理切片。

### M0：基线冻结

- 输出契约清单
- 输出真实样本
- 输出测试迁移清单

### M1：TS 后端可启动

- `/health`
- 基础配置接口
- 统一 workspace

### M2：任务和工件骨架可跑通

- 任务 CRUD
- SSE
- A/B 阶段

### M3：无 Python 转写可用

- C 阶段可跑通
- CPU 至少可用

### M4：摘要与导出可用

- D 阶段完成
- Markdown / Mermaid / 字幕兼容

### M5：VQA 可用

- search / chat / trace
- 前端问答视图可联调

### M6：运行时治理可用

- 模型管理
- 自检
- 指标

### M7：默认切换到 TS

- 前端默认连 TS 后端
- Python 后端只保留短期回滚通道

## 14. 最终建议

如果这次重构的主目标是“统一语言并降低长期维护成本”，最稳妥的路径不是“边看边翻译 Python”，而是：

1. 先冻结当前契约与工件标准
2. 并行搭建 `backend-ts`
3. 先迁协议与仓储，再迁任务编排
4. 把 `ASR` 和 `RAG` 作为两个独立高风险项目处理
5. 用影子比对完成切换，而不是一次性替换

对当前 VidGnost 而言，这不是一个“小型重构”，而是一次后端平台替换。按现有体量和耦合度，建议把它当作正式工程项目来执行，而不是单轮代码重写任务。
