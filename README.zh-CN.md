<div align="center">
  <img src="./frontend/public/light.svg" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>面向 Electron 桌面的本地优先多模态视频分析工作台</strong></p>
  <p>支持视频接入、本地转写、结构化笔记生成、检索问答、实时追踪与可复现导出。</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![uv](https://img.shields.io/badge/backend-uv-6C47FF)
![pnpm](https://img.shields.io/badge/frontend-pnpm-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## 项目简介

VidGnost 是一个以本地运行体验为核心的视频分析工作台，采用 Python 后端与 React + Electron 前端组合实现。它面向“导入视频后得到可搜索、可追踪、可编辑、可导出结果”的完整工作流，当前重点支持：

- 从 Bilibili 链接、本地绝对路径或上传文件创建任务
- 使用 `faster-whisper` 在本地完成转写
- 通过可配置的 OpenAI Compatible 模型生成笔记与导图
- 通过 Dense、Sparse、RRF、Rerank 组成证据检索链路
- 借助 VLM 与可选全模态链路处理图像和关键帧
- 通过 SSE 实时输出任务状态、日志、告警和问答流
- 持久化任务记录、Trace、Markdown 产物与导出包，便于回放和复查

Electron 是当前主要产品形态；浏览器模式主要用于前端调试和 API 联调。

## 核心能力

### 1. 端到端任务流水线

VidGnost 将视频处理拆分为明确的阶段：

1. `A`：来源校验与媒体准备
2. `B`：音频转换与分块规划
3. `C`：转写
4. `D`：转录优化与融合交付

其中 D 阶段会产出用户最常使用的结构化结果：

- 清洗后的转录文本
- Markdown 笔记
- Mermaid 导图内容
- `srt` / `vtt` 字幕
- 可回放的事件与 Trace 数据

### 2. 工作台视图

- `flow`：查看任务进度、阶段日志、转写、笔记和导图产物
- `qa`：基于证据检索进行问答，支持流式回答与引用
- `debug`：查看 Dense、Sparse、RRF、Rerank 与 Trace 级别明细
- `diagnostics`：执行系统自检、查看问题摘要，并在支持时触发自动修复

### 3. 模型与运行时架构

不同能力模块采用不同的运行路径：

| 组件 | 默认运行方式 | 说明 |
| --- | --- | --- |
| Whisper | 本地 `faster-whisper` | 不依赖 Ollama |
| LLM | Ollama 或在线 OpenAI Compatible API | 用于生成 |
| Embedding | Ollama 或在线 API | 用于向量检索 |
| VLM | Ollama 或在线 API | 用于关键帧 / 图像理解 |
| Rerank | Ollama 或在线 API | 用于重排序 |
| MLLM | 可选在线 API | 启用图文联合检索与回答链路 |

当前实现中几个关键点：

- 本地模型目录统一以绝对路径持久化
- Ollama 安装目录、模型目录和服务地址可在设置中心配置
- 在线服务默认按 OpenAI Compatible 方式接入，必要的协议兼容由后端处理
- 发送到远端视觉模型的图片会在上传前按阈值压缩，降低带宽与延迟成本

### 4. Mermaid 与可复现笔记产物

生成笔记中的 Mermaid 代码块会被渲染为 PNG 并落盘到任务产物目录。Markdown 内使用相对路径引用这些图片，因此历史记录查看、导出打包和回放时都能保持一致。

## 支持的输入与输出

### 输入来源

- Bilibili 链接
- 本地绝对视频路径
- 单文件或批量上传

### 本地视频格式

当前仅支持以下四种本地视频格式：

- `MP4`
- `MOV`
- `AVI`
- `MKV`

### 输出产物

- 转录文本
- 笔记
- 导图
- 字幕：`srt`、`vtt`
- 导出包：`zip`、`tar`
- 事件日志与 Trace 回放数据

## 仓库结构

```text
VidGnost/
├─ backend/                      # FastAPI 后端、任务编排、模型运行时、存储
│  ├─ app/
│  │  ├─ api/                   # HTTP 路由
│  │  ├─ services/              # pipeline、retrieval、config、export、diagnostics
│  │  ├─ schemas.py
│  │  └─ main.py
│  ├─ tests/
│  ├─ pyproject.toml
│  └─ uv.lock
├─ frontend/                     # React 渲染层 + Electron 壳层
│  ├─ components/
│  ├─ hooks/
│  ├─ lib/
│  ├─ src/
│  ├─ electron/
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/                         # 项目文档、OpenSpec、设计说明
├─ scripts/                      # 启动、清理、OpenSpec 校验脚本
├─ start-all.ps1
├─ start-all.sh
├─ README.md
└─ README.zh-CN.md
```

## 环境要求

- Python `3.12.x`
- Node.js `18+`
- 已启用 Corepack
- 使用 `uv` 管理后端依赖
- 使用 `pnpm` 管理前端依赖
- 系统中可直接调用 `ffmpeg`
- 至少具备一种模型配置方式：
  - 本地 Ollama，用于本地 LLM / Embedding / VLM / Rerank
  - 或在线 OpenAI Compatible API 凭据

## 快速开始

### 方式一：一键启动

Windows PowerShell：

```powershell
cd F:\in-house project\VidGnost
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

Linux / macOS / WSL：

```bash
cd /path/to/VidGnost
./start-all.sh
```

说明：

- 根脚本会安装前后端依赖并启动所需进程
- 默认启动模式为 `electron`
- 底层 bootstrap 脚本也支持 `web`、`electron` 等模式切换

### 方式二：手动启动开发环境

后端：

```bash
uv sync --directory backend --group dev
uv run --directory backend python -m uvicorn app.main:app --host 127.0.0.1 --port 8666 --reload
```

前端 Web 调试模式：

```bash
pnpm --dir frontend install
pnpm --dir frontend dev --host 127.0.0.1 --port 6221
```

Electron 桌面开发模式：

```bash
pnpm --dir frontend install
pnpm --dir frontend desktop:dev
```

前端构建：

```bash
pnpm --dir frontend build
```

默认本地地址：

- 后端 API：`http://127.0.0.1:8666/api`
- 前端 Vite：`http://127.0.0.1:6221`

## 配置说明

大部分运行时设置都已集中到设置中心。

### 可配置项

- Ollama 运行时
  - 安装目录
  - 可执行文件路径
  - 模型目录
  - 服务地址
  - 重启与迁移流程
- Whisper 运行时
  - 语言
  - 设备
  - 计算类型
  - 分块参数
- 托管模型目录
  - LLM
  - Embedding
  - VLM
  - Rerank
  - MLLM
- 提示词模板
- UI 偏好设置
- 系统自检

### 关键持久化文件

- `backend/storage/model_config.json`
- `backend/storage/config.toml`
- `backend/storage/models/catalog.json`
- `backend/storage/ollama-runtime.json`
- `backend/storage/prompts/templates/*.json`
- `backend/storage/prompts/selection.json`

## 当前 HTTP API 一览

基础前缀：`/api`

### 健康检查

- `GET /health`

### 任务相关

- `POST /tasks/url`
- `POST /tasks/path`
- `POST /tasks/upload`
- `POST /tasks/upload/batch`
- `GET /tasks`
- `GET /tasks/stats`
- `GET /tasks/recent`
- `GET /tasks/{task_id}`
- `GET /tasks/{task_id}/source-media`
- `GET /tasks/{task_id}/artifacts/file`
- `GET /tasks/{task_id}/open-location`
- `PATCH /tasks/{task_id}/title`
- `PATCH /tasks/{task_id}/artifacts`
- `DELETE /tasks/{task_id}`
- `POST /tasks/{task_id}/cancel`
- `POST /tasks/{task_id}/pause`
- `POST /tasks/{task_id}/resume`
- `POST /tasks/{task_id}/rerun-stage-d`
- `GET /tasks/{task_id}/events`
- `GET /tasks/{task_id}/export/{kind}`

### 运行时配置

- `GET /config/llm`
- `PUT /config/llm`
- `GET /config/ollama`
- `PUT /config/ollama`
- `POST /config/ollama/migrate-models`
- `POST /config/ollama/restart-service`
- `GET /config/whisper`
- `PUT /config/whisper`
- `GET /config/models`
- `POST /config/models/reload`
- `PATCH /config/models/{model_id}`
- `POST /config/models/migrate-local`
- `POST /config/models/{model_id}/download`
- `DELETE /config/models/{model_id}/download`
- `GET /config/prompts`
- `PUT /config/prompts/selection`
- `POST /config/prompts/templates`
- `PATCH /config/prompts/templates/{template_id}`
- `DELETE /config/prompts/templates/{template_id}`
- `GET /config/ui`
- `PUT /config/ui`

### 诊断与运行指标

- `POST /self-check/start`
- `POST /self-check/{session_id}/auto-fix`
- `GET /self-check/{session_id}/report`
- `GET /self-check/{session_id}/events`
- `GET /runtime/metrics`
- `GET /runtime/paths`

### 检索与问答

- `POST /analyze`
- `POST /search`
- `POST /chat`
- `POST /chat/stream`
- `GET /traces/{trace_id}`

## 存储目录说明

后端运行时数据默认写入 `backend/storage/`。

重点目录包括：

- `tasks/records/`
- `tasks/analysis-results/`
- `tasks/stage-artifacts/`
- `vector-index/`
- `event-logs/`
- `prompts/`
- `models/`

示例：

- `backend/storage/tasks/stage-artifacts/<task_id>/D/fusion/notes-images/`
- `backend/storage/event-logs/<task_id>.jsonl`
- `backend/storage/event-logs/traces/*.jsonl`

## 开发流程

### 安装依赖

后端：

```bash
uv sync --directory backend --group dev
```

前端：

```bash
pnpm --dir frontend install
```

### 常用校验命令

后端测试：

```bash
uv run --directory backend python -m pytest
```

后端导入编译检查：

```bash
uv run --directory backend python -m compileall app
```

前端类型检查：

```bash
pnpm --dir frontend exec tsc --noEmit
```

前端生产构建：

```bash
pnpm --dir frontend build
```

OpenSpec 一致性校验：

```bash
python scripts/check-openspec.py
bash scripts/check-openspec.sh
powershell -ExecutionPolicy Bypass -File .\scripts\check-openspec.ps1
```

工作区清理：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\clean-workspace.ps1
```

```bash
bash ./scripts/clean-workspace.sh
```

## 相关文档

- [English README](./README.md)
- [OpenSpec 索引](./docs/openspec/README.md)
- [当前变更集 build-lightweight-v2](./docs/openspec/changes/build-lightweight-v2/proposal.md)
- [当前完整技术栈](./docs/current-tech-stack.zh-CN.md)
- [前端驱动后端执行清单](./docs/frontend-driven-backend-execution-checklist.zh-CN.md)
- [Git 提交规范](./docs/git-commit-convention.md)

## License

本仓库基于 [MIT License](./LICENSE) 发布。
