# VidGnost 当前技术栈

更新时间：2026-09-26

## 1. 架构边界

- 交付形态：Electron 本地桌面应用 + 本地 API 服务
- 前端：`React 19 + Vite 6 + Electron 31 + Tailwind CSS 4`
- 后端：`Fastify 5 + TypeScript 5`
- 契约层：`packages/contracts`（zod 校验请求体）
- 共享常量：`packages/shared`
- 通信方式：HTTP JSON + SSE（任务事件流、问答流）
- 运行时数据：仓库根目录 `storage/`
- 模型接入：在线优先（阿里云百炼 + OpenRouter），本地 `faster-whisper` 作为离线兜底

## 2. 分层结构

```text
apps/api/src
├─ core/        配置解析、错误模型、文件工具、ID/指纹、文本工具、进程与下载
├─ providers/   模型目录、角色路由与设置仓库、HTTP 客户端、DashScope、OpenRouter、本地 Whisper、网关、健康自检
├─ media/       来源解析与探测、音频抽取与分片、关键帧抽取、感知哈希
├─ asr/         转写编排（在线优先 / 本地兜底）与标准化
├─ insight/     语义分段、章节切分、摘要、思维导图、知识图谱、校对、翻译、逐帧图注
├─ retrieval/   切块、BM25、向量索引、上下文前缀、混合检索、时间锚定问答
├─ pipeline/    阶段定义、任务 runner、任务管理器、事件总线
├─ store/       任务仓库、工件索引与读取
├─ routes/      health / catalog / tasks / media / events / ask / config / export
└─ server/      应用上下文装配与 Fastify 装配
```

## 3. 前端技术栈

### 3.1 运行与构建

- Vite 6、React 19、TypeScript 5、Electron 31
- Tailwind CSS 4（`@theme inline` 设计令牌）+ `tw-animate-css`

### 3.2 UI 与交互

- Radix UI 原始组件（dialog / select / switch / tabs / tooltip / scroll-area / slider / dropdown-menu 等）
- Lucide React 图标
- Zustand 5（`app-store` 应用状态、`player-store` 播放状态）
- Mermaid 11（思维导图渲染，懒加载，失败降级为源码）
- 自研受控 Markdown 渲染（答案排版，不引入完整 Markdown 依赖）

### 3.3 设计系统

- 开发约束：界面的开发、优化与调整必须在 `oil-frontend` 与 `ui-ux-pro-max` 两个 skill 的约束下进行
  （见 `AGENTS.md` §1「前端 UI 约束」），配色只消费语义令牌并须通过 `scripts/check-theme-contrast.mjs`
- 文件：`apps/desktop/src/app/globals.css`
- 主题：`:root` 为浅色（冷纸：微冷近白画布 + 纯白卡片），`.dark` 为深色（石墨：近黑画布 + 抬起的卡片）；
  组件只消费语义令牌，不写死颜色值
- 令牌：表面（`background / card / popover / elevated`）、文本（`foreground / text-muted / text-subtle`）、
  描边（`border / border-strong / input / hairline`）、动作（`primary / secondary / accent`）、
  语义（`success / warning / destructive / info`）、时间锚点（`timestamp / timestamp-surface`）、
  浮层（`scrim`）、噪点强度（`noise-opacity`）
- 主题控制：`stores/theme-store.ts`（`light / dark / system`，持久化于 `localStorage`）；
  `index.html` 内联脚本在首屏绘制前应用主题，避免闪烁
- 排版：`--font-sans`（Inter + 系统中文字体栈）、`--font-mono`（JetBrains Mono 栈）；
  字号阶梯 11/12/13/15/20/28，阅读区行高 1.78
- 动效：`--ease-out-quint`、140/220/360ms 三档时长，并遵守 `prefers-reduced-motion`
- 图形：Mermaid 使用与主题对齐的十六进制配色（其解析器不支持 `oklch()`），
  `mindmap` 的 section 色阶在渲染后按主题重写
- 桌面壳：`frame: false` + 自定义标题栏 + `-webkit-app-region` 拖拽区；标题栏（`bg-background/70` + 背景模糊）
  与导航轨（`bg-background/60`）使用半透明画布底色，让极光氛围透出，文字与图标对比度由语义令牌保证
- 对比度校验：`node scripts/check-theme-contrast.mjs`（两种模式下 42 组配对，正文 4.5:1、图标 3:1）

## 4. 后端技术栈

- Fastify 5、`@fastify/cors`、pino、zod、tsx、tsup
- 测试：Vitest（`apps/api/test`、`apps/desktop/src/**/*.test.ts`）

## 5. 模型与外部运行时

### 5.1 协议适配层与自定义接入

- 适配层：`apps/api/src/providers/protocols/`，六种协议各自实现可用能力：
  `openai`（对话/多模态/向量化/重排/转写/翻译）、`anthropic`（对话/多模态/翻译）、
  `gemini`（对话/多模态/向量化/翻译）、`dashscope`（对话/多模态/向量化/转写/翻译）、
  `openrouter`（对话/多模态/向量化/重排/翻译）、`local`（本地转写）。
- 分发：`gateway.ts` 按提供方声明的协议取适配器，不按提供方 id 特判；协议未实现的能力统一报
  `PROTOCOL_CAPABILITY_UNSUPPORTED`，未实现流式时回退为一次性返回。
- 自定义渠道：界面可登记提供方（协议 + Base URL + 密钥）与模型（ID、显示名、能力类型、
  上下文长度、向量维度），落在 `storage/config/settings.json`（版本 4）；
  与内置目录合并后一并参与角色路由与阶段缓存键。
- 出参安全：提供方列表只返回凭据来源与脱敏尾码，内联密钥不出后端。

### 5.2 系统依赖

- `ffmpeg` / `ffprobe`：音频抽取、分片、关键帧抽取（场景检测）
- `yt-dlp`：在线视频下载
- Python 3.10+ 与 `uv`：仅在启用本地 Whisper 时需要

### 5.3 在线能力（阿里云百炼）

| 能力 | 模型 | 接入方式 |
| --- | --- | --- |
| 对话 | `qwen3.8-flash` / `qwen3.8-27b` / `glm-5.3` / `deepseek-v4-*` / `qwen3.8-max-0902` / `qwen3.8-2.4t-a95b` | OpenAI 兼容 `POST /compatible-mode/v1/chat/completions` |
| 流式对话 | 同上 | `stream: true`，SSE 分片解析 |
| 多模态 | `qwen3.8-omni-flash` | `chat/completions` 携带 `image_url` |
| 向量 | `qwen3.7-text-embedding-flash`（512 维）/ `qwen3.7-text-embedding`（1024 维） | `POST /compatible-mode/v1/embeddings` |
| 翻译 | `qwen-mt-uni` | `chat/completions` + `input.source_texts` 批量翻译 |
| 文件转写 | `qwen-audio-3.1-asr-flash-filetrans` | 上传策略 → OSS 直传 → 异步任务 → 结果下载 |

实现要点：

- 结构化任务默认携带 `enable_thinking: false`；模型拒绝该参数时按模型缓存并重试一次（实测把结构化任务延迟从 6.7s 降到 3.4s）。
- 文件转写采用「临时上传策略 + `oss://` 引用 + `X-DashScope-OssResourceResolve: enable`」，
  单个分片上限受策略返回的 `max_file_size_mb` 约束。
- 推理类模型（`deepseek-v4-pro-0813`）需要较大的 `max_tokens`，否则可能只返回推理内容。

### 5.4 重排序（OpenRouter）

- 模型：`nvidia/llama-nemotron-rerank-vl-1b-v2:free`
- 接入：`POST {OPENROUTER_BASE_URL}/rerank`，body 为 `{model, query, documents, top_n}`
- 不可用时自动回退到 RRF 顺序，并在检索 trace 的 `degradation` 字段说明

### 5.5 本地兜底

- `faster-whisper`（CTranslate2）：通过 `apps/api/python/transcribe_faster_whisper.py` 子进程调用，
  支持 `--probe` 环境探测与一次性转写；设备与精度由设置页控制
- 触发条件：未配置百炼密钥、显式选择本地、或在线失败且偏好为 `auto`

## 6. 数据与存储

```text
storage/
├─ config/settings.json             # 处理默认值、角色路由、提供方配置
├─ media/                           # 下载或导入的原始媒体
├─ tmp/                             # 中间媒体
└─ tasks/<taskId>/
   ├─ task.json                     # 任务记录（来源、选项、阶段、工件、统计）
   ├─ events.ndjson                 # 事件日志（可回放）
   ├─ checkpoints/<stage>.json      # 阶段缓存键与摘要
   ├─ chapter-notes.json            # 章节要点（摘要/导图/图谱/问答/导出共用）
   ├─ media/audio.wav               # 归一化音频
   ├─ media/chunks/*.mp3            # 在线 ASR 分片
   ├─ transcript.json/.srt/.txt
   ├─ paragraphs.json / outline.json
   ├─ summary.json / mindmap.json / mindmap.mmd / notes.md
   ├─ knowledge.json
   ├─ frames.json + frames/*.jpg
   ├─ translation.json
   ├─ index/chunks.json / vectors.bin / bm25.json
   └─ export/report.md / pack.json
```

## 7. 检索链路

1. 章节内切块：目标 320 token，回带最多 2 个段落作为重叠前缀
2. 上下文前缀：每个块 50-80 token 的定位说明 + 3 个问题变体
3. 索引：embedding 输入为「章节 + 前缀 + 正文」；BM25 同时索引正文、前缀与问题（附加字段权重 0.8）
4. 分词：拉丁按单词小写化，CJK 只切二元组（避免单字噪声匹配）
5. 召回：向量 top-40 + BM25 top-40 → RRF(k=60) → rerank 前 30 → top-K=8
6. 全局意图问题（整体/主题/总结）改走章节摘要 map-reduce
7. 回答流式生成后，服务端把 `[mm:ss]` 映射到证据区间并生成 `Citation`

## 8. 观测与可解释性

- 任务事件流（SSE）：`snapshot / stage / log / artifact / status / done`
- 阶段就绪度：按阶段权重加权计算，前端展示为进度条与百分比
- 检索 trace：`subQueries`、`candidateCounts`、`hits`（含 bm25/vector/rrf/rerank 分数）、`rerankModel`、
  `embeddingModel`、`latencyMs`、`degradation`
- 运行时自检：百炼对话、百炼向量、百炼文件转写通道、OpenRouter 模型列表、本地 Whisper 目录，全部为真实调用

## 9. 测试与质量保障

- 类型检查：`pnpm typecheck`
- 单元测试：`pnpm --filter @vidgnost/api test`、`pnpm --filter @vidgnost/desktop test`
- 生产构建：`pnpm build`
- OpenSpec 校验：`node scripts/check-openspec.mjs`
