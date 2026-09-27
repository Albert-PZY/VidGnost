# VidGnost v3 — 视频知识引擎（彻底重构）

- 状态：`implemented`（目标态）
- 变更根目录：`docs/openspec/changes/v3-video-knowledge-engine/`
- 取代：`build-lightweight-v2`（study-first 基线，已归档为历史）

## 1. 为什么重构

v2 基线把 VidGnost 定义成「学习工作台」，主链路是「平台字幕优先 + transcript-only QA + study-domain 投影」，
模型层以本地 Ollama 为中心，同时保留了大量历史多模态兼容层（`VQA prewarm`、`frame-semantic`、`evidence_fusion`、
`study-domain` 投影、`bilibili-auth` 登录态、`ollama-service-manager` 等）。

它带来三个结构性问题：

1. **模型层不是能力导向**：配置里出现的是「LLM / Embedding / Rerank / VLM」四个扁平位，而不是「快、准、深」的
   能力档位；换模型要改配置里的具体模型名，管线里也散落了模型选择的假设。
2. **产物不是可检索的知识**：摘要是「一段文本」，没有时间锚点、没有章节结构、没有可点击证据，
   QA 只能给文本片段，用户无法回到原片核对。
3. **在线模型能力被闲置**：百炼提供了文件级 ASR、512/1024 维 embedding、多模态 omni、批量翻译、
   免费 rerank，但在线路径始终是「兼容性兜底」而非「首选路径」。

v3 的目标是换掉整条主干：**在线模型优先、时间锚定、章节结构化、可续跑管线、极简桌面工作台**。

## 2. 定位

> VidGnost 是一个本地优先的桌面端「视频知识引擎」。
> 把任意视频 / 音频变成**带时间锚点的、可检索、可问答、可导出的知识资产**。

三条产品原则：

1. **每一句结论都能回到原片**：所有要点、引用、问答答案都携带 `[mm:ss]` 锚点，前端一键跳转并播放片段。
2. **在线优先、本地兜底**：默认走百炼（ASR / LLM / 多模态 / 向量 / 翻译），断网或未配置密钥时才退回本地
   `faster-whisper` 与本地模型。
3. **产物即结构**：章节是结构单元，chunk 绑定章节，索引同时覆盖「原文 + 上下文前缀 + 问题变体」。

## 3. 目标能力（v3 基线）

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 来源接入 | `implemented` | 本地文件 / 绝对路径 / 远程 URL（yt-dlp、直链） |
| 在线转写 | `implemented` | 百炼 `qwen-audio-3.1-asr-flash-filetrans`：临时上传 → 异步任务 → 句级 + 词级时间戳 |
| 本地转写 | `implemented` | 隔离 Python worker 调用 `faster-whisper`，作为兜底与离线路径 |
| 语义分段 | `implemented` | 停顿 + 长度 + 标点 + 话题切分，产出 `TranscriptParagraph` |
| 章节化大纲 | `implemented` | LLM 按时间锚点切章，每章含标题 / 一句话概括 / 要点 |
| 分层摘要 | `implemented` | 章节级 map → 全局 reduce；TL;DR、核心结论、行动项、疑问、术语表、标签、受众 |
| Markdown 大纲 | `implemented` | 模型直接输出 Markdown 标题层级，同一份数据驱动笔记、大纲与思维导图 |
| 思维导图 | `implemented` | `MindNode` 树 + Mermaid `mindmap` 源码 |
| 知识图谱 | `implemented` | 实体 / 关系三元组，节点带时间锚点与所属章节 |
| 视觉增强 | `implemented` | 场景变化 + 感知哈希去重抽帧 → `qwen3.8-omni-flash` 图注（携带前帧上下文）→ 屏上文字提取 |
| 混合检索 | `implemented` | 向量 + BM25 → RRF 融合 → OpenRouter rerank |
| 上下文前缀索引 | `implemented` | 每个 chunk 生成 50-80 token 定位前缀与问题变体，参与 embedding 与 BM25 |
| 全局问题路由 | `implemented` | 「整体讲了什么」类问题走章节摘要 map-reduce，而非 top-k 片段 |
| 时间锚定问答 | `implemented` | SSE 流式答案 + 强制 `[mm:ss]` 引用 + 可播放片段 |
| 导出 | `implemented` | Markdown 报告 / JSON pack / SRT 字幕 / 大纲 Markdown |
| 幂等续跑 | `implemented` | 阶段产物按「输入指纹 + 模型配置」缓存，重跑只重算受影响阶段 |
| 模型路由 | `implemented` | 按角色取模型（fast / balanced / reasoning / quality / bulk / fallback / vision / asr / embedding / rerank / translate） |
| 健康自检 | `implemented` | 提供方连通性 + 工具链（ffmpeg/ffprobe/yt-dlp/python）探测 |

## 4. 明确不做（v3 边界）

- 平台账号登录态与 Cookie 抓取（B 站 `bilibili-auth`、WBI 签名、`aisubtitle` CDN）——**移除**。
  在线视频统一走 yt-dlp / 直链下载后在本地转写，避免维护登录态与风控对抗。
- `study-domain` 投影、`Knowledge` 笔记库、`Study Pack` 概念——被「章节 + 摘要 + 知识图谱 + 导出」取代。
- Ollama 服务管理（启动 / 重启 / 端口清退）——**移除**，本地模型只保留 `faster-whisper` 一条路径。
- 多模态帧的向量检索（ImageBind 类）——被「帧图注文本参与文本检索」取代，规避非商用权重。
- 社区摘要 / GraphRAG 全量索引——知识图谱保留为轻量证据层，全局问题由章节摘要承接。

## 5. 架构总览

```
apps/desktop (Electron + React 19 + Vite)
  ├─ shell      自定义标题栏 / 侧边轨 / 命令面板
  ├─ library    资产库（卡片、搜索、就绪度）
  ├─ studio     工作台：播放器 + 时间轴 + 章节轨 / transcript / 摘要 / 导图 / 知识 / Copilot
  └─ providers  模型：在线 / 本地两域 → 提供方 → 能力 → 模型
        │  HTTP + SSE
apps/api (Fastify 5 + TypeScript)
  ├─ core       配置 / 错误 / 文件 / 进程 / 文本 / 事件
  ├─ providers  能力注册表 + 路由解析 + DashScope / OpenRouter / OpenAI 兼容 / 本地 Whisper
  ├─ media      ffprobe / ffmpeg 抽音频 / 抽帧
  ├─ pipeline   阶段引擎（可续跑）+ 任务仓库 + SSE 事件总线
  ├─ asr        在线 filetrans / 本地 faster-whisper / 转写标准化
  ├─ insight    分段 / 章节 / 摘要 / 导图 / 知识图谱 / 翻译
  ├─ retrieval  切块 / BM25 / 向量 / RRF / rerank / 问答
  └─ routes     tasks / events / library / config / ask / export / health
packages/contracts  共享领域契约（zod 校验请求体）
storage/            运行时数据（任务、工件、索引、配置）
```

## 6. 管线：10 个阶段

阶段按固定顺序执行，每个阶段写入 `stage-state.json` 检查点，支持中断续跑与单阶段重算。

| # | 阶段 | 产物 | 权重 |
| --- | --- | --- | --- |
| 1 | `ingest` | 媒体落盘、`source.json` | 4 |
| 2 | `audio` | 归一化音频（16k mono wav） | 6 |
| 3 | `transcribe` | `transcript.json` / `.srt` / `.txt` | 26 |
| 4 | `structure` | `paragraphs.json` / `outline.json` | 16 |
| 5 | `insight` | `summary.json` | 16 |
| 6 | `mindmap` | `mindmap.json` / `mindmap.mmd` | 6 |
| 7 | `knowledge` | `knowledge.json` | 8 |
| 8 | `vision` | `frames.json` + `frames/*.jpg` | 8 |
| 9 | `index` | `index/chunks.json` / `index/vectors.bin` / `index/bm25.json` | 8 |
| 10 | `finalize` | `export/report.md` / `export/pack.json` | 2 |

阶段缓存键：`sha1(stageId | 输入指纹 | 相关模型路由 | 相关选项)`。命中缓存则直接复用工件并标记 `succeeded`。

## 7. 在线模型与角色路由

| 角色 | 默认模型 | 提供方 | 用途 |
| --- | --- | --- | --- |
| `llm.fast` | `qwen3.8-flash` | dashscope | 分段、图注整理、查询改写 |
| `llm.balanced` | `qwen3.8-27b` | dashscope | 章节、思维导图、知识抽取 |
| `llm.reasoning` | `deepseek-v4-pro-0813` | dashscope | 高难问题、深预设摘要 |
| `llm.quality` | `qwen3.8-max-0902` | dashscope | 全局归并（reduce） |
| `llm.bulk` | `qwen3.8-2.4t-a95b` | dashscope | 超长上下文批量归并 |
| `llm.fallback` | `deepseek-v4-flash-0731` | dashscope | 任一角色失败时兜底 |
| `vision.primary` | `qwen3.8-omni-flash` | dashscope | 关键帧图注与屏上文字 |
| `asr.online` | `qwen-audio-3.1-asr-flash-filetrans` | dashscope | 文件级异步转写 |
| `asr.local` | `faster-whisper large-v3` | local | 离线兜底 |
| `embedding` | `qwen3.7-text-embedding-flash` | dashscope | 512 维向量 |
| `rerank` | `nvidia/llama-nemotron-rerank-vl-1b-v2:free` | openrouter | 重排 |
| `translate` | `qwen-mt-uni` | dashscope | 批量翻译（`input.source_texts`） |

密钥只从环境变量读取（`DASHSCOPE_API_KEY`、`OPENROUTER_API_KEY`），设置页可覆盖为内联密钥，
接口返回一律脱敏（`sk-…3f9a`）。

## 8. 检索与问答

1. **切块**：以章节为边界，在章节内按目标 320 token / 80 token 重叠切块，块继承章节标题与时间范围。
2. **上下文前缀**：`llm.fast` 为每块生成 50-80 token 的「本块在全文中的位置与指代消解」前缀；
   同一次调用顺带产出 3 个该块能回答的问题。
3. **索引**：`embedding` 向量化 `前缀 + 正文`；BM25 同时索引正文、前缀与问题变体（问题权重 ×0.8）。
4. **召回**：向量 top-40 与 BM25 top-40 并行 → RRF（k=60）融合。
5. **重排**：`rerank` 对融合前 30 条重排 → top-K（默认 8）。
6. **路由**：命中「全局意图」（整体 / 主题 / 讲了什么 / 总结）时不走片段 top-k，而是把章节摘要
   作为证据做 map-reduce 回答。
7. **回答**：流式生成，系统提示强制「每个事实后必须跟随 `[mm:ss]`」，服务端事后校验引用是否落在证据时间范围内。
8. **前端**：引用渲染为 chip，点击跳转播放器并高亮对应 transcript 行，支持「播放片段」。

## 9. 前端设计语言

- **基调**：暗色优先的石墨黑画布 + 极光微光背景，1px 发丝描边，克制的高光与层次。
- **排版**：UI 字体系统栈，时间码与统计用等宽字体；字号阶梯 11/12/13/15/20/28。
- **空间**：8pt 栅格；内容区最大宽度受控，阅读区行高 1.75。
- **交互**：`Ctrl+K` 命令面板；卡片 hover 微抬升；播放器与 transcript 双向同步；流式答案逐字呈现。
- **桌面优先**：自定义标题栏（frameless）、窗口控制内嵌、`titleBarStyle: hidden`；
  最小可用宽度 1024，主要布局在 1280-1920 区间打磨。
