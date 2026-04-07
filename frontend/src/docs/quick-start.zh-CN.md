# VidGnost 快速开始

## 1. 运行拓扑

VidGnost 的单任务分析链路如下：

1. 来源接入与媒体准备（`A`）
2. 音频转换与分块规划（`B`）
3. 本地 `Systran/faster-whisper-small` CPU 转写（`C`）
4. 阶段 D 有序子链：`transcript_optimize -> fusion_delivery`（`D`）
5. 在线 LLM 生成结构化笔记与导图 Markdown

## 2. 环境准备

- Python 3.12
- `uv`
- Node.js 18+（启用 Corepack）
- `pnpm`
- `ffmpeg` 在系统 `PATH` 中可用
- 可用的在线 LLM API 凭证（`base_url`、`model`、`api_key`）

## 3. 安装依赖

在仓库根目录执行：

```bash
uv sync --project backend --python 3.12 --index-url https://pypi.tuna.tsinghua.edu.cn/simple/
pnpm --dir frontend install
```

## 4. 启动服务

后端：

```bash
cd backend
uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

前端：

```bash
cd frontend
pnpm dev --host 0.0.0.0 --port 5173
```

访问 `http://localhost:5173`。

## 5. 配置运行参数

在页头打开“运行配置”，依次填写：

1. `在线 LLM`
   - `base_url`
   - `model`
   - `api_key`
2. `Faster-Whisper`
   - `model_default=small`
   - `device=cpu`
   - `compute_type` 选择 `int8` 或 `float32`
   - `language`、`chunk_seconds` 等转写参数
3. `Prompt Templates`
   - 选择阶段 D 的笔记模板与导图模板

## 6. 提交并观察任务

1. 打开来源弹窗，提交 URL/路径/上传文件。
2. 在运行时分栏实时查看 SSE 事件（`A`、`B`、`C`、`transcript_optimize`、`D`）。
3. 任务完成后查看结果：
   - 转写文本
   - 笔记 Markdown
   - 导图 Markdown 与可视化渲染
   - 字幕导出（`SRT`、`VTT`）

## 7. 导出与历史

- 下载任务打包产物（Windows 默认 `zip`，Linux/macOS 默认 `tar`）
- 在历史弹窗中重放终态任务
- 编辑任务标题
- 对终态任务编辑笔记/导图 Markdown，并导出最新内容

## 8. 快速排查

### 8.1 阶段 D API 调用失败

检查端点连通性、模型名、API Key 有效性与额度。

### 8.2 Whisper 报 CUDA DLL 相关错误

将运行配置保存为 `device=cpu` 后重试。

### 8.3 `uv` hardlink 警告

若缓存目录与项目目录跨文件系统，设置 `UV_LINK_MODE=copy`。
