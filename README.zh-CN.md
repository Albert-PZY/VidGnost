<div align="center">
  <img src="./apps/desktop/public/icon.png" alt="VidGnost Logo" width="112" />
  <h1>VidGnost</h1>
  <p><strong>视频知识引擎</strong></p>
  <p>把任意视频或音频变成带时间锚点的、可检索、可问答、可导出的知识资产。</p>
</div>

<div align="center">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

## 它解决什么问题

看完一段视频后，你真正需要的是「这段内容讲了什么、在哪一分钟讲的、我还能问它什么」。
普通的转写工具只给你一坨文字，普通的摘要工具给你一段无法核对的结论。

VidGnost 的做法是：**先建立一条带时间戳的结构化主线，再让所有产物挂在这条主线上。**

- 每个结论都带 `[mm:ss]`
- 每个问答的引用都能跳到原片对应片段并开始播放
- 章节、摘要、导图、概念图谱共用同一套时间坐标

## 三条产品原则

1. **每一句结论都能回到原片**：摘要、原文、导图、概念与问答共用同一个 `seek` 实现，
   点击时间码即跳转播放。
2. **在线优先、本地兜底**：默认使用阿里云百炼的对话、视觉、向量、翻译与文件级 ASR；
   未配置密钥或网络不可用时回退本地 `faster-whisper`。
3. **产物即结构**：章节是结构单元，检索块绑定章节，索引同时覆盖正文、上下文前缀与问题变体。

## 处理管线

任务按十个阶段顺序执行，每个阶段写检查点，中断后可续跑：

| # | 阶段 | 产出 |
| --- | --- | --- |
| 1 | `ingest` | 媒体落盘、时长与指纹 |
| 2 | `audio` | 16kHz 单声道音频、ASR 分片 |
| 3 | `transcribe` | 句级 + 词级时间戳转写、SRT、纯文本 |
| 4 | `structure` | 语义段落、章节（含要点与时间锚点） |
| 5 | `insight` | TL;DR、核心结论、行动项、疑问、术语表、标签 |
| 6 | `mindmap` | 导图树 + Mermaid 源码 |
| 7 | `knowledge` | 概念与关系的轻量知识图谱 |
| 8 | `vision` | 关键帧、屏上文字、多模态图注 |
| 9 | `index` | 上下文前缀、问题变体、向量与 BM25 索引 |
| 10 | `finalize` | Markdown 报告、JSON 数据包、翻译工件 |

阶段缓存键为 `sha1(阶段 | 来源指纹 | 相关模型路由 | 相关选项)`，
因此**换模型只会重跑受影响的阶段**。

## 模型接入

流水线只依赖角色，不依赖具体模型名：

| 角色 | 默认模型 | 提供方 |
| --- | --- | --- |
| `llm.fast` | `qwen3.8-flash` | 百炼 |
| `llm.balanced` | `qwen3.8-27b` | 百炼 |
| `llm.reasoning` | `deepseek-v4-pro-0813` | 百炼 |
| `llm.quality` | `qwen3.8-max-0902` | 百炼 |
| `llm.bulk` | `qwen3.8-2.4t-a95b` | 百炼 |
| `llm.fallback` | `deepseek-v4-flash-0731` | 百炼 |
| `vision.primary` | `qwen3.8-omni-flash` | 百炼 |
| `asr.online` | `qwen-audio-3.1-asr-flash-filetrans` | 百炼 |
| `asr.local` | `faster-whisper` | 本地 |
| `embedding` | `qwen3.7-text-embedding-flash` | 百炼 |
| `rerank` | `nvidia/llama-nemotron-rerank-vl-1b-v2:free` | OpenRouter |
| `translate` | `qwen-mt-uni` | 百炼 |

密钥从环境变量读取，设置页也可以填写内联密钥，界面只显示脱敏尾码：

```bash
DASHSCOPE_API_KEY=sk-xxxxxxxx      # 阿里云百炼
OPENROUTER_API_KEY=sk-or-v1-xxxx   # OpenRouter（重排序）
```

## 检索与问答

1. 以章节为边界切块（目标 320 token / 80 token 重叠）。
2. 为每块生成 50-80 token 的上下文前缀与 3 个问题变体（解决指代丢失与口语化提问）。
3. 向量 top-40 与 BM25 top-40 并行召回，RRF（k=60）融合。
4. OpenRouter 重排前 30 条，取 top-K（默认 8）。
5. 「整体讲了什么」这类全局问题走章节摘要 map-reduce，而不是片段 top-k。
6. 回答流式生成，服务端把 `[mm:ss]` 校验并映射成结构化引用。

## 快速开始

环境要求：Node.js 18+、`pnpm`、`ffmpeg`/`ffprobe` 在 PATH 中；需要下载在线视频时还需要 `yt-dlp`。
使用本地 Whisper 需要 Python 3.10+ 与 `uv`。

```bash
pnpm install

# 终端一：后端
pnpm --filter @vidgnost/api dev

# 终端二：桌面渲染层（浏览器调试）
pnpm --filter @vidgnost/desktop dev --host 127.0.0.1 --port 6221

# 或者直接启动 Electron 桌面窗口
pnpm --filter @vidgnost/desktop desktop:dev
```

默认地址：

- 后端 API：`http://127.0.0.1:8666/api`
- 渲染层调试：`http://127.0.0.1:6221`

## 工作台

- **资产库**：所有已处理视频的唯一入口，展示就绪度、标签与规模，支持搜索与删除。
- **工作台**：章节轨 / 内容舞台 / Copilot 三栏，底部常驻播放条；
  笔记、原文、导图、概念、画面五个页签；处理中显示实时阶段看板。
- **模型**：提供方密钥状态、角色路由切换与运行时自检（真实网络调用）。
- **设置**：默认处理参数、本地 Whisper 配置与工具链探测。

界面设计为暗色优先的石墨画布 + 极光微光，发丝描边、8pt 栅格、等宽时间码，
全局 `Ctrl/⌘ + K` 命令面板。

## 仓库结构

```text
VidGnost/
├─ apps/
│  ├─ api/                    # Fastify + TypeScript 后端
│  │  ├─ python/              # faster-whisper 隔离 Python worker
│  │  ├─ src/core/            # 配置、错误、文件、文本、进程
│  │  ├─ src/providers/       # 模型目录、角色路由、提供方客户端、健康自检
│  │  ├─ src/media/           # 来源解析、音频抽取、关键帧与感知哈希
│  │  ├─ src/asr/             # 在线/本地转写编排与标准化
│  │  ├─ src/insight/         # 分段、章节、摘要、导图、知识图谱、校对、翻译
│  │  ├─ src/retrieval/       # 切块、BM25、向量索引、混合检索、问答
│  │  ├─ src/pipeline/        # 阶段引擎、任务管理器、事件总线
│  │  ├─ src/store/           # 任务与工件仓库
│  │  ├─ src/routes/          # HTTP 与 SSE 路由
│  │  └─ test/                # Vitest 单元测试
│  └─ desktop/                # Electron + React 桌面端
│     ├─ electron/            # 主进程、preload、启动闪屏
│     └─ src/                 # 渲染层：shell / library / studio / config
├─ packages/
│  ├─ contracts/              # 前后端共享领域契约（zod 校验请求体）
│  └─ shared/                 # 共享常量
├─ docs/openspec/             # 变更提案、设计与能力规格
├─ storage/                   # 运行时数据（任务、工件、索引、配置）
└─ scripts/                   # 校验与运维脚本
```

## 校验

```bash
pnpm typecheck                                        # 三个包的类型检查
pnpm --filter @vidgnost/api test                      # 后端单元测试
pnpm --filter @vidgnost/desktop test                  # 前端单元测试
node scripts/check-openspec.mjs                       # OpenSpec 规范校验
```

## 相关文档

- [OpenSpec 索引](./docs/openspec/README.md)
- [当前技术栈](./docs/current-tech-stack.zh-CN.md)
- [Git 提交规范](./docs/git-commit-convention.md)

## License

本仓库基于 [MIT License](./LICENSE) 发布。
