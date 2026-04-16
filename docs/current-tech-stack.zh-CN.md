# VidGnost 当前完整技术栈

更新时间：2026-04-16

## 1. 架构边界

- 交付形态：Electron 本地桌面工作台
- 前端：`React 19 + Vite 6 + Electron 31 + TypeScript 5`
- 后端：`Fastify 5 + TypeScript 5`
- 契约层：`packages/contracts`
- 共享常量：`packages/shared`
- 通信方式：HTTP JSON + SSE
- 运行时持久化：仓库根目录 `storage/`
- 后端形态：纯 TS 全栈，不再依赖 Python 后端或 Python sidecar

## 2. 前端技术栈

### 2.1 运行与构建

- Node.js
- pnpm workspace
- Vite 6
- React 19
- TypeScript 5
- Electron 31

### 2.2 UI 与交互

- Tailwind CSS 4
- Radix UI
- Lucide React
- Zustand 5
- next-themes
- react-hot-toast
- react-resizable-panels
- `@tanstack/react-virtual`
- `@uiw/react-md-editor`
- `@uiw/react-markdown-preview`
- Mermaid（前端预览渲染）

## 3. 后端技术栈

### 3.1 运行与框架

- TypeScript 5
- Fastify 5
- `@fastify/cors`
- `@fastify/multipart`
- tsx
- tsup
- pino
- Zod

### 3.2 核心后端模块

- `apps/api/src/modules/media/`
- `apps/api/src/modules/asr/`
- `apps/api/src/modules/summary/`
- `apps/api/src/modules/tasks/`
- `apps/api/src/modules/runtime/`
- `apps/api/src/modules/models/`
- `apps/api/src/modules/vqa/`
- `apps/api/src/modules/events/`

### 3.3 标准单仓目录边界

- `apps/api/`：服务端应用
- `apps/desktop/`：桌面端应用
- `packages/contracts/`：前后端共享 schema
- `packages/shared/`：共享常量与通用类型

## 4. AI 与外部运行时

### 4.1 媒体与系统依赖

- `ffmpeg`
- `ffprobe`
- `yt-dlp`

### 4.2 ASR

- 本地：`whisper.cpp` CLI
- 远程：OpenAI-compatible ASR API
- 当前实现边界：
  - 本地路径要求用户提前准备 `whisper-cli` 和 `ggml` 模型文件
  - 当前 TS 运行时不内置 Whisper 模型自动下载
  - 输出统一标准化为 `text + segments`

### 4.3 LLM / 检索 / 问答

- LLM：Ollama / OpenAI-compatible API
- Embedding：Ollama / OpenAI-compatible API
- VLM：Ollama / OpenAI-compatible API
- Rerank：Ollama / OpenAI-compatible API
- 当前实现边界：
  - LLM 自检会真实探测远端 `/models`
  - VQA 默认主链是 transcript-only `vector-index`
  - `mllm-default` 仍是保留配置位，不代表当前已启用 multimodal retrieval

### 4.4 模型管理边界

- `/config/models`、`/config/ollama`、`/config/whisper` 负责配置、状态探测和说明性快照
- 当前实现边界：
  - 不接管 Ollama pull
  - 不自动搬迁 Ollama 现有模型文件
  - `restart-service` 当前是 probe-first 行为，不是完整自托管进程管理

## 5. 数据与存储

- 主目录：`storage/`
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

## 6. 当前关键能力基线

- 任务流水线：`A -> B -> C -> D`
- 转录纠错：`off / strict / rewrite`
- 纠错产物：
  - `D/transcript-optimize/index.json`
  - `D/transcript-optimize/full.txt`
  - `D/transcript-optimize/strict-segments.json`
  - `D/transcript-optimize/rewrite.txt`
- 摘要回退可解释化：
  - `D/fusion/manifest.json`
  - `generated_by`
  - `fallback_reason`
- VQA 预热产物：
  - `D/vqa-prewarm/index.json`

## 7. 测试与质量保障

- 类型检查：`pnpm typecheck`
- 单元测试：`pnpm test`
- 生产构建：`pnpm build`
- OpenSpec 校验：`node scripts/check-openspec.mjs`
- 后端测试框架：Vitest

## 8. 结论

当前项目已经稳定收口为：

- 前端：Electron + React 渲染层
- 后端：本地 Fastify TS 服务
- 契约：共享 TypeScript schema
- 模型运行：本地 CLI 或远程 OpenAI-compatible / Ollama
- 存储：统一写入根目录 `storage/`
