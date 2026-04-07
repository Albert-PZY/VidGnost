<div align="center">
  <img src="./frontend/public/light.svg" alt="VidGnost Logo" width="120" />
  <h1>VidGnost</h1>
  <p><strong>API 优先的多模态视频分析工作台</strong></p>
  <p>从视频输入到结构化笔记、思维导图、字幕与产物导出，配合实时运行态可视化完成分析闭环。</p>
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

## 1. 你能获得什么

- 输入来源：Bilibili URL / 本地文件路径 / 文件上传
- 实时工作台：
  - 通过 SSE 展示阶段进度、日志、耗时与运行告警
  - 支持任务状态流转与取消反馈
- 语音识别：
  - Faster-Whisper（CPU）
  - 转录优化模式：`off` / `strict` / `rewrite`
- 阶段 D 语义生成：
  - 仅保留 `transcript_optimize -> fusion_delivery`
  - 不包含本地视频抽帧、VLM 帧语义识别、OCR 流水线
- 产物输出：
  - 详细笔记、思维导图、字幕（`SRT` / `VTT`）
  - 一键打包导出（`zip` / `tar`）
- 持久化能力：
  - 历史任务回放、标题编辑、终态任务删除
  - 可编辑 `notes.md` 与 `mindmap.md`，并与导出保持一致

## 2. 处理流程

1. 阶段 `A`：来源接入与媒体归一化
2. 阶段 `B`：音频预处理与分块规划
3. 阶段 `C`：Faster-Whisper 流式转写
4. 阶段 `D`：有序子阶段链路
   - `transcript_optimize -> fusion_delivery`

实现说明：

- 笔记/导图生成是在线 LLM API-only。

## 3. 仓库结构

```text
VidGnost/
├─ backend/                     # FastAPI 后端（Python 3.12 + uv）
│  ├─ app/
│  │  ├─ api/                   # tasks/config/health/self-check 路由
│  │  ├─ services/              # 流水线编排、运行时、守卫、导出
│  │  ├─ models.py              # 数据记录模型
│  │  ├─ schemas.py             # API 请求/响应模型
│  │  └─ main.py                # FastAPI 入口
│  ├─ tests/                    # pytest 测试集
│  ├─ pyproject.toml            # 后端依赖
│  └─ uv.lock                   # 依赖锁
├─ frontend/                    # React + Vite + TypeScript
│  ├─ src/
│  │  ├─ App.tsx                # 主工作台 UI
│  │  ├─ lib/api.ts             # 前端 API 客户端
│  │  ├─ docs/                  # 内置快速开始文档
│  │  └─ i18n/                  # 多语言资源
│  ├─ package.json
│  └─ pnpm-lock.yaml
├─ docs/
│  ├─ openspec/                 # OpenSpec 文档
│  ├─ ui/                       # UI Prompt 文档
│  └─ optimization-checklist.zh-CN.md
├─ scripts/                     # 启动 / 自检 / OpenSpec 校验脚本
└─ AGENTS.md                    # 维护者/代理索引
```

## 4. 运行要求

- 操作系统：
  - Linux / macOS / WSL（`scripts/bootstrap-and-run.sh`）
  - Windows PowerShell 7+（`scripts/bootstrap-and-run.ps1`）
- Python：`3.12.x`
- Node.js：`>= 18`（启用 Corepack）
- 包管理：后端 `uv`，前端 `pnpm`
- 系统依赖：`ffmpeg` 已在 `PATH`
- Faster-Whisper 转写采用 CPU 运行时
- API 凭证：
  - LLM API Key（阶段 `D` 文本生成必需）

## 5. 快速启动

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

### 5.2 手动启动（推荐，环境更可控）

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
pnpm dev --host 0.0.0.0 --port 5173
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:8000`

### 5.3 启动后配置清单

1. 打开运行配置弹窗。
2. 在 `在线 LLM` 分栏填写：
   - LLM API（`base_url`、`model`、`api_key`）
3. 在 `Faster-Whisper` 分栏确认 ASR 默认参数（`model_default`、`language`、`compute_type`、`chunk_seconds`）。
4. 保存配置并提交任务。

## 6. 运行配置与存储

关键持久化文件：

- LLM 配置：`backend/storage/model_config.json`
- Whisper 运行配置：`backend/storage/config.toml`
- 提示词模板：`backend/storage/prompts/templates/*.json`
- 提示词选择：`backend/storage/prompts/selection.json`
- 任务记录：`backend/storage/tasks/records/*.json`
- 阶段产物：`backend/storage/tasks/stage-artifacts/<task_id>/<stage>/**`
- 分析快照：`backend/storage/tasks/analysis-results/<task_id>/*.json`

配置中心分栏：

- `在线 LLM`
  - LLM API 运行参数
- `Faster-Whisper`
  - ASR 运行参数与转录优化参数
- `提示词模板`
  - 笔记/导图模板增删改与切换

## 7. 故障排查

| 现象 | 含义 | 处理建议 |
| --- | --- | --- |
| `Task failed: RuntimeError: Library cublas64_12.dll is not found` | 旧环境/旧配置仍按 GPU 方式初始化 | 更新到最新代码，并在运行配置中保持 Whisper 设备为 `cpu` |
| `warning: Failed to hardlink files; falling back to full copy.` | `uv` 缓存与目标目录跨文件系统，硬链接不可用 | 设置 `UV_LINK_MODE=copy` 可消除该提示 |
| 阶段 D 报 API 鉴权或连通性错误 | API 凭证错误或 endpoint 不可达 | 核对 LLM 的 `base_url`、`model`、`api_key` 并做连通性检查 |

## 8. 开发命令

后端测试：

```bash
cd backend
uv run pytest
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
powershell -ExecutionPolicy Bypass -File scripts/check-openspec.ps1
```

## 9. 相关文档

- [快速开始（EN）](./frontend/src/docs/quick-start.en.md)
- [快速开始（ZH）](./frontend/src/docs/quick-start.zh-CN.md)
- [错误码字典（ZH）](./docs/error-codes.zh-CN.md)
