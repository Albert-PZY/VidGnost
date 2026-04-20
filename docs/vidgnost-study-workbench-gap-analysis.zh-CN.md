# VidGnost 学习工作台改造差距分析

更新时间：2026-04-20

状态：planned

## 1. 文档目的

这份文档不再从 LongCut 仓库视角描述方案，而是直接站在 VidGnost 当前代码基线出发，回答三个问题：

- VidGnost 当前已经具备哪些可复用能力；
- VidGnost 当前距离目标学习工作台还缺什么；
- 后续在 VidGnost 仓库里改造时，哪些方向应该做，哪些方向不应该继续投入。

## 2. VidGnost 当前基线

### 2.1 当前架构基线

VidGnost 当前已经形成了明确的本地桌面端架构：

- 前端：`apps/desktop`
- 后端：`apps/api`
- 契约层：`packages/contracts`
- 持久化根目录：`storage/`
- 前后端通信：HTTP JSON + SSE

当前项目的优势不是“在线平台能力”，而是：

- 本地运行；
- 本地模型配置；
- 本地任务控制；
- 本地文件导出；
- 自检和诊断能力；
- Electron 工作台对复杂任务流程的承载能力。

### 2.2 当前任务处理链路

从当前 `apps/api/src/modules/tasks/task-orchestrator.ts` 可以看到，VidGnost 目前任务主链路以本地媒体工件为中心，采用 `A -> B -> C -> D` 四阶段流水线：

- `A`：Source Ingestion
- `B`：Audio Extraction
- `C`：Speech Transcription
- `D`：Detailed Notes and Mindmap Generation

在 `D` 阶段里，当前代码基线还包含：

- `transcript_optimize`
- `multimodal_prewarm`
- `transcript_vectorize`
- `frame_extract`
- `frame_semantic`
- `multimodal_index_fusion`

这说明 VidGnost 当前的 VQA 仍然带有明显的“多模态预热迁移中”设计痕迹。

### 2.3 当前模块基线

当前和本次改造最相关的后端模块包括：

- `apps/api/src/modules/tasks/task-orchestrator.ts`
- `apps/api/src/modules/tasks/task-repository.ts`
- `apps/api/src/modules/media/media-pipeline-service.ts`
- `apps/api/src/modules/media/video-frame-service.ts`
- `apps/api/src/modules/asr/asr-service.ts`
- `apps/api/src/modules/summary/summary-service.ts`
- `apps/api/src/modules/summary/transcript-correction-service.ts`
- `apps/api/src/modules/vqa/retrieval-index-service.ts`
- `apps/api/src/modules/vqa/vqa-runtime-service.ts`
- `apps/api/src/modules/vqa/vlm-runtime-service.ts`

前端侧最相关的基线文件包括：

- `apps/desktop/src/components/views/task-processing-workbench.tsx`
- `apps/desktop/src/components/views/task-processing-view.tsx`
- `apps/desktop/src/components/views/history-view.tsx`
- `apps/desktop/src/components/views/new-task-view.tsx`
- `apps/desktop/src/components/views/settings-view.tsx`

契约层当前最相关的文件包括：

- `packages/contracts/src/tasks.ts`
- `packages/contracts/src/vqa.ts`
- `packages/contracts/src/config.ts`

### 2.4 当前持久化基线

当前 VidGnost 的任务域主要仍然基于文件系统与 JSON：

- `storage/tasks/records/*.json`
- `storage/tasks/stage-artifacts/<task_id>/**`
- `storage/tasks/analysis-results/**`
- `storage/event-logs/*.jsonl`
- `storage/event-logs/traces/*.jsonl`

这套结构适合当前以任务和 artifact 为中心的设计，但一旦要承接：

- 学习状态；
- 主题切换；
- highlights；
- 推荐问题；
- 知识卡片；
- 学习资料库筛选；
- 字幕轨道切换；
- 翻译缓存；

继续把这些结构化数据长期直接放在 JSON 文件里，会越来越不适合。

### 2.5 当前 UI 心智

从现有页面和 OpenSpec 基线看，VidGnost 当前更像：

- 本地视频分析工作台；
- 任务执行和诊断工作台；
- transcript / notes / VQA / Trace 的工程型工具。

它当前最强的是：

- 可控性；
- 可诊断性；
- 本地化；
- 模型配置灵活性。

但它当前最弱的是：

- 缺少真正的学习首屏；
- 缺少“先看重点，再决定深挖”的路径；
- 缺少个人知识沉淀闭环；
- 缺少更接近用户观看在线视频时的字幕与语言切换体验。

## 3. 目标改造方向

### 3.1 新的产品心智

改造后的 VidGnost 不应再只被理解为“本地转写 + 摘要 + VQA 工具”，而应被理解为：

- 本地优先的长视频学习工作台；
- 能承接在线视频与本地视频两种场景；
- 能先给用户重点，再给用户深入分析入口；
- 能把用户的学习过程沉淀为长期可复用资产。

### 3.2 新的核心能力边界

目标形态下，VidGnost 应该新增或重构出以下主能力：

- Study-first 工作台；
- 在线 YouTube / B 站视频 iframe 观看；
- `yt-dlp` 字幕轨道探测与自动翻译轨道列举；
- 字幕实时切换；
- 无字幕时 Whisper 兜底；
- 可选 LLM 翻译；
- SQLite 学习域主存储；
- 知识卡片与学习资料库；
- 自动格式化导出。

### 3.3 明确要去掉的方向

这次方案必须明确收缩范围。

后续 VidGnost 的学习工作台不再把下面这些方向作为目标主链路：

- VLM 图像语义识别；
- 视频抽帧；
- frame semantic 索引；
- 图像语义检索；
- 视觉证据卡片；
- 依赖画面语义的多模态召回增强。

原因很直接：

- 对用户高频痛点帮助有限；
- 成本高；
- 结果稳定性一般；
- 让本地机器负担过重；
- 会显著拖慢产品向“学习工作台”收敛的速度。

## 4. 差距总览

| 维度 | VidGnost 当前基线 | 目标形态 | 主要差距 |
| --- | --- | --- | --- |
| 工作台主入口 | 任务流程与 artifact 优先 | Study 优先 | 缺少学习首屏 |
| 在线视频处理 | 当前链路以本地媒体路径和后续处理为核心 | 在线链接直接 iframe 播放 | 缺少在线看与学的轻入口 |
| 字幕来源 | 以 ASR 和后续 transcript 为主 | `yt-dlp` 原字幕轨道优先，Whisper 兜底 | 缺少平台字幕轨道层 |
| 翻译策略 | 还没有形成按平台轨道与用户配置分层的闭环 | 平台翻译轨道优先，无轨道时按用户配置触发 LLM 翻译 | 缺少翻译决策层 |
| 学习工件 | summary / notes / mindmap / transcript | overview / highlights / themes / questions / top quotes / notes | 缺少完整 Study Pack |
| QA 主链 | 当前仍带有多模态迁移痕迹 | transcript-only 检索与引用为主 | 需要把 VQA 主链收口回文本证据 |
| 知识沉淀 | 系统生成结果为主 | 用户摘录 + 知识卡片库 | 缺少长期沉淀层 |
| 历史页心智 | 任务管理 | 学习资料库 | 缺少 continue learning 心智 |
| 持久化 | JSON + artifact 文件为主 | SQLite 主存储 + 文件系统辅存储 | 缺少结构化主库 |
| 导出 | 以任务导出为主 | 学习包、字幕、翻译、知识卡片按类型自动格式化导出 | 导出粒度还不够学习化 |

## 5. 当前 VidGnost 的主要不足

### 5.1 缺少 Study-first 结构

当前 `task-processing-workbench.tsx` 主要承载：

- 流水线过程；
- transcript；
- notes；
- VQA；
- Trace；
- 诊断与运行状态。

这套结构对工程排障很好，但不适合作为普通用户的默认学习入口。

用户真正需要先看到的内容应该是：

- 这个视频值不值得继续看；
- 有哪些重点；
- 可以从哪个主题切入；
- 现在就能点哪些问题继续探索。

### 5.2 缺少“在线视频观看痛点”视角

用户这次明确提出的核心痛点其实非常清晰：

- YouTube / B 站字幕来源复杂；
- 字幕语言切换麻烦；
- 平台自动翻译轨道不透明；
- 没字幕时还需要本地兜底；
- 本地视频和在线视频的字幕策略不一样。

当前 VidGnost 的架构更偏向“统一做成本地处理对象”，但目标形态更应该是：

- 在线视频优先保持在线视频；
- 本地视频继续走本地文件；
- 只把 transcript、学习工件和导出结果沉淀到本地。

### 5.3 缺少按需翻译闭环

当前 VidGnost 还没有形成清晰的翻译优先级：

- 平台已有自动翻译轨道时怎么办；
- 平台没翻译轨道但用户配置了默认目标语言时怎么办；
- 用户没配置目标语言时是不是完全不翻译；
- 本地视频是不是只能 Whisper + 可选 LLM 翻译。

这层如果不单独设计，最后会出现：

- 用户感觉翻译行为不可预测；
- 在线与本地视频体验不一致；
- 导出结果也缺少稳定语义。

### 5.4 学习域不能继续长期依赖 JSON 主存储

VidGnost 当前的 JSON 存储结构对于任务执行已经够用，但对于未来学习域会出现明显问题：

- 主题、highlights、questions、knowledge notes 都会频繁查找和排序；
- History 需要组合筛选；
- 学习状态需要高频增量更新；
- 翻译记录和字幕轨道切换需要结构化缓存；
- 导出状态需要稳定追踪。

所以这次改造里，学习域必须尽量切到 SQLite。

### 5.5 当前 VQA 还背着过重的迁移负担

从当前代码和现有文档可以看出，VidGnost 的 VQA 仍然背着这些迁移中设计：

- `video-frame-service.ts`
- `vlm-runtime-service.ts`
- `frame_extract`
- `frame_semantic`
- `multimodal_index_fusion`

这对学习工作台方向来说已经不是“加分项”，而是明显的复杂度负担。

更合理的改造方向是：

- 保留 VQA；
- 保留 transcript 引用；
- 保留 text retrieval；
- 去掉画面语义和抽帧这条重链路。

## 6. 改造后的 VidGnost 应怎么理解

### 6.1 不是把 VidGnost 变成 LongCut 的离线壳

正确方向不是：

- 完整复制某个 SaaS 产品页面；
- 强行保留在线平台节奏；
- 把所有在线视频先下载后再处理；
- 继续追求重型多模态堆叠。

### 6.2 而是用 VidGnost 的本地底座承接更强的学习体验

合理方向应该是：

- 保留 VidGnost 的本地化、任务控制、设置、自检、导出优势；
- 让工作台结构更接近“学习先行”的路径；
- 让在线视频和本地视频都能顺畅进入同一学习工作台；
- 让字幕、翻译、问答、笔记、导出形成稳定闭环。

### 6.3 结构借鉴 LongCut，视觉继续继承 VidGnost

这次改造可以明确借鉴：

- 左侧重点导航；
- 中间播放器与 transcript 联动；
- 右侧 overview / questions / note capture；
- 用户先看重点再深挖的交互顺序。

但不应复制：

- LongCut 的 Web SaaS 白底皮肤；
- 在线平台即时再生成节奏；
- SaaS 用户增长、分享、订阅相关结构。

## 7. 建议的最终收敛方向

把这次方案压缩成一句话，就是：

- VidGnost 保留本地优先底座；
- 在线视频改为 iframe 观看；
- 字幕以 `yt-dlp` 轨道优先、Whisper 兜底；
- 翻译默认关闭，只在平台无轨道且用户显式配置目标语言时才走 LLM；
- 学习域主存储尽量改成 SQLite；
- 工作台结构改成 Study-first；
- 彻底移除 VLM、抽帧和图像语义检索这条高成本低收益链路。

这才是最符合当前 VidGnost 用户需求、机器现实条件和本地离线初心的方向。
