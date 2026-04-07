# VidGnost 快速开始（当前版本）

## 1. 当前架构

当前版本分析链路已简化为：

1. 本地音频预处理与分块
2. 本地 `Systran/faster-whisper-small`（CPU）转写
3. 阶段 D 执行 `transcript_optimize -> fusion_delivery`
4. 在线 LLM 生成详细笔记与思维导图

已移除：

- 本地视频抽帧阶段
- VLM 帧语义识别阶段
- OCR 相关流水线

## 2. 环境准备

- Python 3.12
- `uv`
- Node.js + `pnpm`
- `ffmpeg`（必需）
- CPU 环境（Faster-Whisper 当前固定 CPU 推理）

## 3. 启动

在项目根目录：

- 后端依赖：`uv sync --project backend`
- 前端依赖：`pnpm --dir frontend install`

然后分别启动后端和前端开发服务。

## 4. 运行配置

在“运行配置中心”中：

1. `在线 LLM` 分栏填写：
   - `base_url`
   - `model`
   - `api_key`
2. `Faster-Whisper` 分栏确认：
   - `model_default`（固定为 `small`）
   - `language`
   - `compute_type`
   - `chunk_seconds`

## 5. 常见问题

### 5.1 阶段 D 报 API 鉴权或超时

检查：

- `base_url` 是否可达
- `model` 是否正确
- `api_key` 是否有效且额度充足

### 5.2 转写速度偏慢（CPU 模式）

检查：

- 后端虚拟环境是否完成 `uv sync`
- `compute_type` 是否设置为 `int8`（通常更省资源）
- 是否同时运行了其他高占用进程
