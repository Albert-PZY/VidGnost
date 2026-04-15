# VidGnost 当前完整技术栈

更新时间：2026-04-15

## 1. 架构边界

- 前端：`React 19 + Vite 6 + Electron 31 + TypeScript 5`
- 后端：`Fastify 5 + TypeScript 5`
- 契约层：`packages/contracts`
- 共享常量：`packages/shared`
- 通信方式：HTTP JSON + SSE
- 运行时持久化：仓库根 `storage/`

## 2. 前端技术栈

### 2.1 运行与构建

- Node.js
- pnpm
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
- @tanstack/react-virtual
- @uiw/react-md-editor
- @uiw/react-markdown-preview

## 3. 后端技术栈

### 3.1 运行与框架

- TypeScript 5
- Fastify 5
- `@fastify/cors`
- `@fastify/multipart`
- tsx
- tsup
- pino

### 3.2 核心后端模块

- `backend-ts/src/modules/media/`
- `backend-ts/src/modules/asr/`
- `backend-ts/src/modules/summary/`
- `backend-ts/src/modules/tasks/`
- `backend-ts/src/modules/runtime/`
- `backend-ts/src/modules/models/`
- `backend-ts/src/modules/vqa/`
- `backend-ts/src/modules/events/`

## 4. AI 与外部运行时

- 媒体处理：`ffmpeg`、`ffprobe`
- 来源拉取：`yt-dlp`
- ASR：`whisper.cpp` CLI 或兼容 ASR API
- LLM：Ollama / OpenAI-compatible API
- Embedding：Ollama / OpenAI-compatible API
- VLM：Ollama / OpenAI-compatible API
- Rerank：Ollama / OpenAI-compatible API

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

## 6. 测试与质量保障

- 类型检查：`pnpm typecheck`
- 单元测试：`pnpm test`
- 生产构建：`pnpm build`
- OpenSpec 校验：`node scripts/check-openspec.mjs`
- 后端测试框架：`vitest`
- contracts 测试框架：`vitest`

## 7. 结论

当前项目已经定义为：

- 前端：桌面工作台渲染层
- 后端：TS 本地服务
- 契约：共享 TypeScript schema
- 存储：根目录 `storage/`
