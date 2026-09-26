## Why

现有的 VidGnost（`build-lightweight-v2`）是一条以本地 Ollama 为中心的「视频分析台」，产物以
「一段摘要文本」为终点：没有时间锚点、没有章节结构、问答只能给片段文本，用户无法回到原片核对；
同时百炼提供的文件级 ASR、多模态、embedding、rerank、翻译能力全部被闲置在「兼容性兜底」的位置。
历史上为兼容旧链路保留的 `vqa-prewarm` / `frame-semantic` / `study-domain` / `bilibili-auth` /
`ollama-service-manager` 也让主干变得难以演进。

本次是**彻底重构**：替换模型层、管线主干、检索层、前端信息架构与设计语言，
把产品重新定义为「视频知识引擎」——把视频变成**带时间锚点的、可检索、可问答、可导出的知识资产**。

## What Changes

### 架构

- 删除 `study-domain`、`knowledge-note`、`vqa-*`、`ollama-service-manager`、`model-catalog`、
  `bilibili-auth`、`platform-subtitle*`、`prompt-template`、`translation-decision` 等 24 个旧模块。
- 新增六层主干：`providers`（能力注册 + 路由解析）、`media`、`pipeline`（阶段引擎 + 任务仓库 + SSE）、
  `asr`、`insight`、`retrieval`。
- 任务处理改为 **10 阶段可续跑管线**：`ingest → audio → transcribe → structure → insight → mindmap →
  knowledge → vision → index → finalize`，每阶段写检查点，缓存键为
  `sha1(stageId | 输入指纹 | 相关模型路由 | 相关选项)`。

### 模型层

- 引入**角色路由**：`llm.fast / llm.balanced / llm.reasoning / llm.quality / llm.bulk / llm.fallback /
  vision.primary / asr.online / asr.local / embedding / rerank / translate`，管线只依赖角色不依赖模型名。
- **在线优先**：默认全部走阿里云百炼（DashScope），仅 `asr.local` 走本地 `faster-whisper` 兜底。
- 新增 DashScope 原生能力实现：临时上传策略（OSS 直传）、文件级异步 ASR、批量翻译（`input.source_texts`）。
- 新增 OpenRouter rerank 实现（`nvidia/llama-nemotron-rerank-vl-1b-v2:free`）。
- API Key 一律从环境变量读取（`DASHSCOPE_API_KEY` / `OPENROUTER_API_KEY`），支持内联覆盖，对外序列化脱敏。

### 知识产物

- 新增 `TranscriptParagraph`（语义段落）、`Chapter`（章节，含要点与时间锚点）、`SummaryDoc`
  （TL;DR / 核心结论 / 行动项 / 疑问 / 术语表 / 标签 / 受众）、`MindMapDoc`（树 + Mermaid 源码）、
  `KnowledgeGraphDoc`（实体关系三元组，节点带时间锚点）、`FrameDoc`（关键帧图注与屏上文字）。
- 所有洞察结论强制携带 `[mm:ss]` 锚点，服务端校验引用落在证据时间范围内。

### 检索与问答

- 章节绑定切块（目标 320 token / 80 token 重叠）。
- 每个 chunk 生成 50-80 token 的**上下文前缀**与 3 个**问题变体**，共同参与 embedding 与 BM25 索引。
- 混合检索：向量 top-40 + BM25 top-40 → RRF(k=60) 融合 → OpenRouter rerank 前 30 → top-K=8。
- 全局意图问题（「整体讲什么」）路由到章节摘要 map-reduce，而非片段 top-k。
- SSE 流式答案 + 引用 chip + 「播放片段」。

### 前端

- 用新的信息架构替换旧工作台：`Library`（资产库）/ `Studio`（工作台）/ `Providers`（模型与密钥）/
  `Settings`（处理设置）。
- 新的设计语言：石墨黑画布 + 极光微光、发丝描边、8pt 栅格、等宽时间码、`Ctrl+K` 命令面板、
  Electron frameless 自定义标题栏。
- 删除旧视图：`study-view`、`knowledge-view`、`history-view`、`diagnostics-view`、`settings-view`、
  `task-processing-workbench`、`custom-skin-dialog`、`app-background-layer`、`webgl-blur-canvas`。

## Capabilities

### Core Capabilities

- `video-ingestion`：本地文件 / 路径 / URL 接入，媒体探测与指纹。
- `transcription-pipeline`：在线文件级 ASR 优先 + 本地 `faster-whisper` 兜底 + 转写标准化。
- `insight-generation`：语义分段、章节大纲、分层摘要、导图、知识图谱、翻译。
- `visual-enrichment`：关键帧抽取、感知哈希去重、多模态图注与屏上文字。
- `knowledge-retrieval`：切块、上下文前缀、混合检索、重排、时间锚定问答。
- `model-routing`：提供方配置、角色路由、密钥解析与脱敏、健康自检。
- `pipeline-runtime`：阶段引擎、检查点续跑、任务仓库、SSE 事件流。
- `library-and-export`：资产库索引与导出包。
- `desktop-studio-ui`：桌面工作台界面与交互契约。

### Engineering Capabilities

- 阶段级幂等与缓存：换模型只重跑受影响阶段。
- 在线模型调用的并发上限、超时、重试与降级路径。
- SSE 事件协议：`snapshot / stage / log / artifact / status / done`。
