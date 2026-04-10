# VidGnost 当前完整技术栈（前后端）

更新时间：2026-04-10

## 1. 架构边界（已收敛）

- 前端：纯客户端渲染（CSR），只负责界面渲染与交互，不承担服务端渲染。
- 后端：Python 服务，负责任务编排、模型调用、数据处理、检索与存储、接口输出。
- 通信方式：HTTP JSON + SSE（任务流与问答流）。

## 2. 前端技术栈

## 2.1 运行与构建

- Node.js（运行环境）
- pnpm（包管理）
- Vite 6（开发与打包）
- React 19（UI 渲染）
- TypeScript 5（类型系统）

## 2.2 UI 与交互

- Tailwind CSS 4
- tw-animate-css
- Radix UI（Accordion/Dialog/Select/Tabs 等）
- Lucide React（图标）
- next-themes（主题切换，仅前端主题管理，不依赖 Next SSR）
- sonner（通知）
- recharts（图表）
- react-hook-form + zod（表单与校验）

## 2.3 前端工程事实

- 不使用 Next.js 运行链路
- 无 SSR/SSG 服务端渲染职责
- 前端入口：
  - `frontend/index.html`
  - `frontend/src/main.tsx`
  - `frontend/src/App.tsx`
- 常用命令：
  - `pnpm dev`
  - `pnpm build`
  - `pnpm preview`

## 3. 后端技术栈

## 3.1 运行与框架

- Python 3.12
- uv（虚拟环境与依赖管理）
- FastAPI（API 框架）
- Uvicorn（ASGI 服务）
- Pydantic v2（数据模型与校验）
- orjson（高性能 JSON）

## 3.2 核心能力组件

- 视频下载与处理：`yt-dlp`、`ffmpeg-python`
- 转写：`faster-whisper`
- 网络调用：`httpx`
- LLM 调用：`openai`（兼容 OpenAI 协议）
- 向量检索：`chromadb`（持久化向量库）
- 稀疏检索：SQLite FTS5（本地全文索引）
- 系统指标：`psutil` + `nvidia-smi`（GPU 信息）
- 加密存储：`cryptography`（密钥与密文）

## 3.3 后端接口与流式

- REST：任务、配置、历史、自检、VQA、运行指标
- SSE：
  - 任务事件流：`/api/tasks/{task_id}/events`
  - 问答流：`/api/chat/stream`
  - 自检流：`/api/self-check/{session_id}/events`

## 4. 检索与问答（RAG）栈

- 检索链路：Dense + Sparse + RRF + Rerank
- Dense：ChromaDB PersistentClient
- Sparse：SQLite FTS5
- 融合：RRF（`rrf_k=60`）
- 重排：本地重排评分
- Trace：JSONL 可回放（按 `trace_id`）

## 5. 数据与存储

- 主目录：`backend/storage`
- 关键路径：
  - `backend/storage/model_config.json`
  - `backend/storage/config.toml`
  - `backend/storage/prompts/**`
  - `backend/storage/tasks/**`
  - `backend/storage/vector-index/**`
  - `backend/storage/event-logs/**`

## 6. 测试与质量保障

- 后端测试：`pytest` + `pytest-asyncio`
- 前端构建验证：`vite build`
- 已验证状态：
  - 后端：`61 passed`
  - 前端：`vite build` 成功

## 7. 结论

当前项目已明确为：

- 前端：CSR 可视化与交互层
- 后端：Python 统一业务与数据处理层

不存在前端 SSR 框架承担后端职责的链路。
