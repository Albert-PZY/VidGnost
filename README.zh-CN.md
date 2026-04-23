<div align="center">
  <img src="./apps/desktop/public/icon.png" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>面向 Electron 桌面的本地优先学习工作台</strong></p>
  <p>围绕在线视频与本地视频双通路、字幕优先转写、学习工件沉淀与 transcript-only QA 构建。</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## 项目简介

VidGnost 是一个以本地运行体验为核心的 Electron 学习工作台。当前仓库采用标准 TS 全栈单仓结构：

- `apps/desktop` 负责 React + Electron 渲染与桌面壳层
- `apps/api` 负责 Fastify API、任务编排、配置中心、事件流、自检与导出
- `packages/contracts` 负责前后端共享 schema
- 运行时数据统一写入根目录 `storage/`
- 业务主服务保持 TS 主线，本地 ASR 通过 `apps/api/python` 下的隔离 Python worker 调用 `faster-whisper`

新的 study-first 基线不再把 VidGnost 定义成“重型多模态分析台”，而是强调：

- 在线视频与本地视频双通路进入同一学习工作台
- 在线视频优先走平台字幕轨道，本地视频优先走 Whisper 路径
- 平台无字幕时再回退 Whisper
- 翻译是可选层，不是默认阻塞链路
- `study-domain` 是挂在现有任务骨架上的投影视图与持久化域，不是新的 workflow
- Study Pack、Knowledge 与学习资料库是长期资产层
- QA 以 transcript-only 检索和引用为主
- 默认主链路收口到字幕、transcript 与文本学习工件，不再以多模态分析为前提

## 当前能力状态

| 状态 | 能力 |
| --- | --- |
| `implemented` | 本地视频上传、本地绝对路径任务、YouTube / Bilibili 链接任务创建，并统一落到 `youtube` / `bilibili` / `local_file` / `local_path` 来源类型 |
| `implemented` | 本地 `faster-whisper` Python worker 与兼容 ASR API 转写 |
| `implemented` | SSE 任务状态流、阶段日志、任务导出、自检与诊断 |
| `partial` | 学习工作台向 Study-first 结构收口，默认进入 `Study`，并保留 `QA / Flow / Trace / Knowledge` 观察与沉淀能力 |
| `partial` | 任务列表与详情已返回 `study_preview` 元数据，Study 首屏可用这些元数据兜底；历史页升级为学习资料库样式仍在推进 |
| `partial` | QA 主链路向 transcript-only 检索收口，兼容旧多模态工件读取 |
| `planned` | 在线视频平台字幕轨道优先、平台翻译轨道优先，以及完整 study-pack / 字幕轨 / 翻译层联动 |
| `planned` | 可选 LLM 翻译、Knowledge 视图、学习资料库增强、Study Pack 导出 |

## 主路径与边界

### 1. 输入双通路

- 在线视频：面向 YouTube / Bilibili 等链接任务，目标是保持在线视频播放体验并优先消费平台字幕轨道
- 本地视频：继续支持上传文件与绝对路径导入，默认进入本地音频提取与 Whisper 路径

### 2. 字幕与转写优先级

- 在线任务优先使用平台原字幕轨道
- 若平台提供翻译轨道，优先使用平台翻译轨道
- 若平台没有可用字幕，再回退到 Whisper
- 本地视频默认使用 Whisper，翻译仅在用户显式配置时触发

### 3. 学习工件与长期沉淀

study-first 基线关注的主工件包括：

- transcript
- overview
- highlights
- themes
- suggested questions
- study pack
- Knowledge / 学习资料库条目
- transcript-only QA 引用结果

`study-domain` 在实现上负责把这些学习工件、字幕轨、翻译记录、学习状态、知识笔记和导出记录挂到已有 `task_id` 上；它复用现有 `notes / vqa` 任务边界，不额外引入新的任务工作流。

### 4. 明确收口的方向

以下能力不再作为主路径叙述：

- VLM
- 视频抽帧
- 图像语义检索
- 依赖视觉证据的默认 QA 主链路

旧任务与兼容层仍可能暴露历史视觉证据字段，但新的 Study-first 基线不再把这些链路定义成默认前提或继续扩张方向。

兼容层仍可能读取历史多模态工件，但新的学习工作台不以这些能力作为默认前提。

## 核心能力

### 1. 端到端任务流水线

任务处理保持 `A -> B -> C -> D` 四阶段：

1. `A`：来源校验、来源归类与媒体准备
2. `B`：音频提取与预处理
3. `C`：字幕 / transcript 解析、Whisper fallback 与标准化
4. `D`：学习工件生成、导出工件整理与 QA 预热

### 2. 工作台视图

- `Study`：默认学习入口，承接字幕、overview、highlights、themes、questions 与知识摘录
- `QA`：围绕 transcript-only 检索与引用问答
- `Flow`：查看任务进度、阶段日志和运行状态
- `Trace`：查看检索链路、调试信息与兼容工件细节

### 3. 学习资料库

- `History Library`：从历史任务列表升级为学习资料库，承接 continue learning、最近导出、study pack 就绪度与知识条目数量等元数据
- `Knowledge`：承接 transcript 摘录、问答摘录、summary / highlight 摘录等长期学习资产

### 4. 模型与运行时架构

| 组件 | 当前基线 | 说明 |
| --- | --- | --- |
| Whisper | 本地 `faster-whisper` Python worker / 兼容 ASR API | 本地路径需手动准备 Python 运行时与 `CTranslate2` 模型 |
| LLM | Ollama 或在线 OpenAI-compatible API | 用于学习工件生成、可选翻译、问答 |
| Embedding | Ollama 或在线 API | 用于 transcript-only 检索向量化 |
| Rerank | Ollama 或在线 API | 用于结果重排 |

## 仓库结构

```text
VidGnost/
├─ apps/
│  ├─ api/                       # Fastify + TypeScript 后端
│  │  ├─ python/                 # faster-whisper 隔离 Python worker
│  │  ├─ src/                    # 后端源码
│  │  └─ test/                   # 后端测试
│  └─ desktop/                   # Electron 桌面应用
│     ├─ electron/               # 主进程 / preload / splash
│     ├─ public/                 # 静态资源
│     └─ src/                    # 渲染层源码
│        ├─ app/                 # 应用装配与全局样式
│        ├─ components/          # UI 与业务组件
│        ├─ hooks/               # 渲染层 hooks
│        ├─ lib/                 # 客户端服务与工具
│        ├─ stores/              # Zustand 运行时 store
│        └─ workers/             # 渲染层 worker
├─ packages/
│  ├─ contracts/                 # 前后端共享 schema
│  └─ shared/                    # 共享常量
├─ docs/
├─ scripts/
├─ storage/                      # 运行时数据目录（默认本地生成）
├─ start-all.ps1
├─ start-all.sh
├─ README.md
└─ README.zh-CN.md
```

## 环境要求

- Node.js `18+`
- 已启用 Corepack
- `pnpm`
- 若启用本地 Whisper：
  - Python `3.10` - `3.13`
  - `uv`（用于 `apps/api/python` 隔离依赖）
- 系统中可直接调用：
  - `ffmpeg`
  - `ffprobe`
  - `yt-dlp`
- 至少具备一种模型接入方式：
  - 本地 Ollama
  - 或在线 OpenAI-compatible API

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

### 方式二：手动启动开发环境

安装依赖：

```bash
pnpm install
```

启动后端：

```bash
pnpm --filter @vidgnost/api dev
```

启动前端 Web 调试模式：

```bash
pnpm --filter @vidgnost/desktop dev --host 127.0.0.1 --port 6221
```

启动 Electron 桌面开发模式：

```bash
pnpm --filter @vidgnost/desktop desktop:dev
```

默认本地地址：

- 后端 API：`http://127.0.0.1:8666/api`
- 前端 Vite：`http://127.0.0.1:6221`

## 常用校验命令

```bash
pnpm typecheck
pnpm test
pnpm build
node scripts/check-openspec.mjs
```

## 相关文档

- [English README](./README.md)
- [OpenSpec 索引](./docs/openspec/README.md)
- [当前技术栈](./docs/current-tech-stack.zh-CN.md)
- [学习工作台改造方案](./docs/vidgnost-study-workbench-refactor-plan.zh-CN.md)
- [学习工作台差距分析](./docs/vidgnost-study-workbench-gap-analysis.zh-CN.md)
- [Git 提交规范](./docs/git-commit-convention.md)

## License

本仓库基于 [MIT License](./LICENSE) 发布。
