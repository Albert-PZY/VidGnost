<div align="center">
  <img src="./frontend/public/light.svg" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>面向 Electron 的多模态视频分析工作台</strong></p>
  <p>本地转写、在线生成、VQA 检索问答、实时可观测与可复现导出的一体化方案。</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19.2.4-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-41.2.0-47848F?logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![uv](https://img.shields.io/badge/backend-uv-6C47FF)
![pnpm](https://img.shields.io/badge/frontend-pnpm-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## 1. 项目概览

VidGnost 是一个本地优先的视频分析工作台，支持 Web 与 Electron 两种运行形态：

- 输入方式：Bilibili 链接、本地路径、文件上传
- 异步流水线：`A -> B -> C -> D`，其中 D 阶段子流程为 `transcript_optimize -> fusion_delivery`
- 本地 ASR：`faster-whisper`（`small`，CPU）
- 在线生成：通过 OpenAI 兼容接口生成笔记与导图
- VQA 工作流：检索、问答流式返回、trace 回放
- 运行态可观测：SSE 日志/进度/告警 + trace 元数据
- 历史可回放：任务历史、标题编辑、笔记/导图 Markdown 编辑
- 可复现导出：转写、笔记、导图、字幕（`srt`/`vtt`）、打包（`zip`/`tar`）

## 2. 运行流程与架构

### 2.1 端到端流程

1. 阶段 `A`：来源校验与媒体准备
2. 阶段 `B`：音频转换与分块规划
3. 阶段 `C`：流式转写
4. 阶段 `D`：转录优化与笔记/导图融合生成

### 2.2 工作台模式

- `flow`：运行状态、分阶段日志、转写与生成编辑/预览
- `qa`：证据检索增强问答，支持流式回答与引用
- `debug`：Dense/Sparse/RRF/Rerank 对照与 trace 事件回放

### 2.3 宿主形态

- Web：React + Vite，默认后端地址 `http://localhost:8000/api`
- Desktop：Electron（`main/preload/renderer`）
  - Electron 启动时会探测 `/api/health`，必要时可通过 `uv run uvicorn` 自动拉起后端

## 3. 当前 API 一览

基础前缀：`/api`

- 健康检查
  - `GET /health`
- 任务与运行态
  - `POST /tasks/url`
  - `POST /tasks/path`
  - `POST /tasks/upload`
  - `GET /tasks`
  - `GET /tasks/{task_id}`
  - `PATCH /tasks/{task_id}/title`
  - `PATCH /tasks/{task_id}/artifacts`
  - `DELETE /tasks/{task_id}`
  - `POST /tasks/{task_id}/cancel`
  - `POST /tasks/{task_id}/rerun-stage-d`
  - `GET /tasks/{task_id}/events`（SSE）
  - `GET /tasks/{task_id}/export/{kind}`
- 运行时配置
  - `GET/PUT /config/llm`
  - `GET/PUT /config/whisper`
  - `GET /config/prompts`
  - `PUT /config/prompts/selection`
  - `POST /config/prompts/templates`
  - `PATCH /config/prompts/templates/{template_id}`
  - `DELETE /config/prompts/templates/{template_id}`
- 自检
  - `POST /self-check/start`
  - `POST /self-check/{session_id}/auto-fix`
  - `GET /self-check/{session_id}/report`
  - `GET /self-check/{session_id}/events`（SSE）
- VQA
  - `POST /search`
  - `POST /chat`
  - `POST /chat/stream`（流式响应）
  - `POST /analyze`
  - `GET /traces/{trace_id}`

## 4. Mermaid 笔记渲染约定

- D 阶段笔记支持 Mermaid 代码块。
- 后端会将 Mermaid 代码渲染为 PNG，存放到 `notes-images/`。
- Markdown 内通过相对路径引用图片（例如 `![Mermaid 图示 1](notes-images/mermaid-001.png)`），不使用 base64。
- 打包导出会包含 `notes-images/**/*.png`。

## 5. 仓库结构

```text
VidGnost/
├─ backend/                              # FastAPI 后端（Python 3.12 + uv）
│  ├─ app/
│  │  ├─ api/                            # health/tasks/config/self-check/vqa 路由
│  │  ├─ services/                       # pipeline/summarizer/retriever/trace/exporters
│  │  ├─ schemas.py
│  │  └─ main.py
│  ├─ tests/
│  ├─ pyproject.toml
│  └─ uv.lock
├─ frontend/                             # React + Electron + TypeScript
│  ├─ src/
│  │  ├─ main/                           # Electron 主进程入口
│  │  ├─ preload/                        # Electron 预加载桥接
│  │  ├─ components/
│  │  ├─ hooks/
│  │  ├─ lib/
│  │  └─ App.tsx
│  ├─ electron.vite.config.ts
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/
│  ├─ openspec/
│  └─ electron-fullstack-rebuild-plan.zh-CN.md
├─ scripts/
└─ AGENTS.md
```

## 6. 环境要求

- Python `3.12.x`
- Node.js `>=18`（启用 Corepack）
- 后端包管理：`uv`
- 前端包管理：`pnpm`
- 系统可用 `ffmpeg`
- 阶段 D 和 VQA 问答需配置可用的在线 LLM 凭据

## 7. 启动方式

### 7.1 一键启动脚本

Linux/macOS/WSL：

```bash
cd VidGnost
./scripts/bootstrap-and-run.sh
```

Windows PowerShell：

```powershell
cd VidGnost
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-and-run.ps1
```

### 7.2 手动启动（Web 模式）

后端：

```bash
cd backend
uv sync --python 3.12
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

前端：

```bash
cd frontend
pnpm install
pnpm dev --host 0.0.0.0 --port 5173
```

### 7.3 Electron 桌面模式

```bash
cd frontend
pnpm install
pnpm desktop:dev
```

构建桌面包：

```bash
cd frontend
pnpm desktop:build
```

## 8. 存储目录

- 运行配置
  - `backend/storage/model_config.json`
  - `backend/storage/config.toml`
  - `backend/storage/prompts/templates/*.json`
  - `backend/storage/prompts/selection.json`
- 任务状态与产物
  - `backend/storage/tasks/records/*.json`
  - `backend/storage/tasks/analysis-results/<task_id>/<stage>.json`
  - `backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
  - `backend/storage/tasks/stage-artifacts/<task_id>/D/fusion/notes-images/**/*.png`
- 可观测日志
  - `backend/storage/tasks/runtime-warnings/<task_id>.jsonl`
  - `backend/storage/event-logs/<task_id>.jsonl`
  - `backend/storage/event-logs/traces/*.jsonl`

## 9. 开发检查命令

后端：

```bash
cd backend
uv run pytest
uv run python -m compileall app
```

前端：

```bash
cd frontend
pnpm lint
pnpm build
pnpm test
```

OpenSpec：

```bash
python scripts/check-openspec.py
bash scripts/check-openspec.sh
powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1
```

## 10. 相关文档

- [OpenSpec 索引](./docs/openspec/README.md)
- [当前变更集 build-lightweight-v2](./docs/openspec/changes/build-lightweight-v2/proposal.md)
- [Electron 全栈重构计划](./docs/electron-fullstack-rebuild-plan.zh-CN.md)
- [Git 提交规范](./docs/git-commit-convention.md)
