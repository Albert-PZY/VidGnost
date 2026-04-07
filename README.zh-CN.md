<div align="center">
  <img src="./frontend/public/light.svg" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>API 优先的多模态视频分析工作台</strong></p>
  <p>以本地转写和在线语义生成为核心，提供可观测、可回放、可导出的端到端视频分析体验。</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19.2.4-61DAFB?logo=react&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![uv](https://img.shields.io/badge/backend-uv-6C47FF)
![pnpm](https://img.shields.io/badge/frontend-pnpm-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

<div align="center">

[快速开始（EN）](./frontend/src/docs/quick-start.en.md) · [快速开始（ZH）](./frontend/src/docs/quick-start.zh-CN.md)

</div>

## 1. 产品能力

VidGnost 面向视频分析全链路，提供以下核心能力：

- 输入接入：Bilibili 链接、本地文件路径、文件上传
- 运行态可视化：通过 SSE 展示阶段进度、日志、耗时、告警与任务状态
- 语音转写：本地 `Systran/faster-whisper-small`（CPU）
- 阶段 D 生成：有序执行 `transcript_optimize -> fusion_delivery`
- 产物输出：结构化笔记、Markmap 导图 Markdown、字幕（`SRT`/`VTT`）、打包导出（`zip`/`tar`）
- 历史回放：任务检索、详情重放、标题编辑、笔记/导图内容可编辑并参与导出

## 2. 处理流程

1. 阶段 `A`：来源校验与媒体准备
2. 阶段 `B`：音频转换与分块规划
3. 阶段 `C`：Faster-Whisper 流式转写
4. 阶段 `D`：转录优化与在线 LLM 并行生成笔记/导图

关键运行约束：

- ASR 运行时固定 CPU。
- 阶段 `D` 通过配置中心提供的在线 LLM 参数执行。
- 运行告警以结构化 SSE 事件推送并写入本地持久化文件。

## 3. 仓库结构

```text
VidGnost/
├─ backend/                     # FastAPI 后端（Python 3.12 + uv）
│  ├─ app/
│  │  ├─ api/                   # tasks/config/health/self-check 路由
│  │  ├─ services/              # 流水线编排、运行时、守卫、导出
│  │  ├─ models.py              # 数据模型
│  │  ├─ schemas.py             # 接口模型
│  │  └─ main.py                # FastAPI 入口
│  ├─ tests/                    # pytest 测试
│  ├─ pyproject.toml            # 后端依赖
│  └─ uv.lock                   # 依赖锁
├─ frontend/                    # React + Vite + TypeScript
│  ├─ src/
│  │  ├─ App.tsx                # 工作台入口
│  │  ├─ lib/api.ts             # 前端 API 客户端
│  │  ├─ docs/                  # 内置快速开始文档
│  │  └─ i18n/                  # 多语言资源
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/
│  ├─ openspec/                 # OpenSpec 规格文档
│  ├─ ui/                       # UI Prompt 文档
│  └─ optimization-checklist.zh-CN.md
├─ scripts/                     # 启动 / 自检 / OpenSpec 校验脚本
└─ AGENTS.md                    # 维护说明与索引
```

## 4. 环境要求

- 操作系统：
  - Linux / macOS / WSL（`scripts/bootstrap-and-run.sh`）
  - Windows PowerShell 7+（`scripts/bootstrap-and-run.ps1`）
- Python `3.12.x`
- Node.js `>=18`（启用 Corepack）
- 包管理：后端 `uv`，前端 `pnpm`
- 系统依赖：`ffmpeg` 在 `PATH` 中可用
- 阶段 `D` 需可用的在线 LLM API Key

## 5. 启动方式

### 5.1 一键启动

Linux / macOS / WSL：

```bash
cd VidGnost
./scripts/bootstrap-and-run.sh
```

Windows PowerShell：

```powershell
cd VidGnost
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-and-run.ps1
```

### 5.2 手动启动

后端：

```bash
cd backend
uv sync --python 3.12 --index-url https://pypi.tuna.tsinghua.edu.cn/simple/
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

前端：

```bash
cd frontend
pnpm install
# 可选：通过环境变量覆盖后端 API 地址，便于本地多环境切换。
# 示例：VITE_API_BASE_URL=http://127.0.0.1:18000/api
pnpm dev --host 0.0.0.0 --port 5173
```

默认访问地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8000`

### 5.3 启动后配置清单

1. 打开运行配置弹窗。
2. 在 `在线 LLM` 分栏填写 `base_url`、`model`、`api_key`。
3. 在 `Faster-Whisper` 分栏确认：
   - `model_default=small`
   - `device=cpu`
   - `compute_type=int8|float32`
   - `language`、`chunk_seconds` 等参数
4. 保存配置并提交任务。

## 6. 配置与持久化目录

关键文件与目录：

- LLM 配置：`backend/storage/model_config.json`
- Whisper 配置：`backend/storage/config.toml`
- Prompt 模板：`backend/storage/prompts/templates/*.json`
- 模板选择：`backend/storage/prompts/selection.json`
- 任务记录：`backend/storage/tasks/records/*.json`
- 阶段产物：`backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
- 阶段快照：`backend/storage/tasks/analysis-results/<task_id>/<stage>.json`
- 运行告警：`backend/storage/tasks/runtime-warnings/<task_id>.jsonl`
- SSE 事件日志：`backend/storage/event-logs/<task_id>.jsonl`

## 7. 常见问题

| 现象 | 含义 | 处理建议 |
| --- | --- | --- |
| `Task failed: RuntimeError: Library cublas64_12.dll is not found` | 当前环境以 CUDA 方式初始化 Whisper | 在运行配置中保存 `device=cpu` 后重试 |
| `warning: Failed to hardlink files; falling back to full copy.` | `uv` 缓存目录与目标目录不在同一文件系统 | 设置 `UV_LINK_MODE=copy` 以消除提示 |
| 阶段 D API 鉴权或连通性失败 | 在线 LLM 端点或凭证不可用 | 核对 `base_url`、`model`、`api_key` 与配额 |

## 8. 开发命令

后端检查：

```bash
cd backend
uv run pytest
uv run python -m compileall app
```

前端检查：

```bash
cd frontend
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

OpenSpec 校验：

```bash
python scripts/check-openspec.py
bash scripts/check-openspec.sh
powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1
```

## 9. 相关文档

- [快速开始（EN）](./frontend/src/docs/quick-start.en.md)
- [快速开始（ZH）](./frontend/src/docs/quick-start.zh-CN.md)
- [错误码字典（ZH）](./docs/error-codes.zh-CN.md)
