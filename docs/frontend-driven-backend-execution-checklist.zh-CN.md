# VidGnost 前端驱动后端重构执行清单（首版）

## 1. 文档目标

本清单用于指导下一阶段后端重构工作，目标是让当前前端页面（基于 V0 重建后的 UI）从静态数据进入真实可用状态。
规划依据仅包含当前仓库中的前端与后端实现，不依赖既有 spec 文档。

## 执行状态（2026-04-10）

- 后端重构链路已完整落地到 `backend`，旧 `backend` 不再作为运行入口。
- 字段映射与契约基线见 `docs/frontend-backend-field-mapping.zh-CN.md`。
- API 与运维执行基线见 `docs/backend-api-and-ops-baseline.zh-CN.md`。

## 2. 范围边界

### 2.1 本次范围

- 以 `frontend/app/page.tsx` 与 `frontend/components/views/*.tsx` 展示能力为唯一功能输入
- 重构后端架构逻辑链路与接口契约，使页面上的功能都有真实数据来源
- 建立可验证的任务状态流、结果产物流、配置流与诊断流
- 补齐接口级、服务级、端到端联调验证

### 2.2 非本次范围

- 多端同步与云端协同能力

## 3. 当前页面能力拆解（后端输入基线）

## 3.1 新建任务页（`new-task-view.tsx`）

- 工作流模式：`notes`、`vqa`
- 视频导入：拖拽/选择、多文件、上传进度、文件移除
- 工作流步骤预览：notes 4 步、vqa 6 步
- 开始分析动作：携带文件列表 + 工作流类型

## 3.2 任务处理页（`task-processing-view.tsx`）

- 顶部任务进度、步骤状态、步骤进度、步骤耗时
- 左侧视频播放区 + 转写片段联动跳转（按时间戳）
- 右侧双模式：
  - notes：结构化笔记、思维导图、编辑/导出动作
  - vqa：问题输入、检索回答、相关片段跳转

## 3.3 历史页（`history-view.tsx`）

- 统计卡：总任务、notes 任务、vqa 任务、已完成数
- 搜索、筛选、排序
- 列表操作：查看、导出、打开文件位置、删除

## 3.4 设置页（`settings-view.tsx`）

- 本地模型管理：模型列表、状态、重载、配置、添加
- 提示词模板：列表 + 新建 + 编辑 + 删除（`correction/notes/mindmap/vqa`）
- 外观设置：字体大小、自动保存
- 语言设置：中英文

## 3.5 系统自检页（`diagnostics-view.tsx`）

- 一键检查 + 进度 + 摘要
- 检查项：系统/GPU/Whisper/LLM/Embedding/VLM/ChromaDB/存储
- 运行时信息：运行时间、CPU、内存、GPU

## 4. 后端重构总原则

- 单一真源：任务状态、步骤状态、配置状态统一由后端返回
- 契约优先：先冻结 API 字段，再推进服务实现
- 流式优先：任务处理与问答均以增量事件驱动前端刷新
- 可回放：关键链路写入可追踪日志与 artifact 索引
- 可降级：模型不可用时保证页面可解释反馈，不出现无响应

## 5. 关键差距清单（前端期望 vs 当前后端）

- [x] 工作流字段缺口：前端区分 `notes/vqa`，任务创建接口尚未形成统一 workflow 字段与全链路透传
- [x] 步骤模型缺口：前端展示细粒度步骤（含进度/耗时/日志），后端当前为 A/B/C/D 主阶段 + 子阶段，需要新增页面友好步骤映射
- [x] 设置中心缺口：前端模型列表包含 `whisper/llm/embedding/vlm/rerank`，后端尚无统一模型清单接口
- [x] 提示词模板缺口：前端模板类型 4 类，后端当前模板通道为 `summary/mindmap` 两类
- [x] 自检缺口：前端期望硬件与模型级检查项，后端现有自检项偏环境依赖检查
- [x] 历史统计缺口：前端需要聚合统计与过滤排序，后端仅基础列表查询
- [x] 运行态指标缺口：前端自检页展示 CPU/内存/GPU/运行时间，后端未提供统一 runtime metrics 接口

## 6. 分阶段执行清单（按优先级）

## 阶段 0：契约冻结与脚手架（P0）

- [x] 输出《前端字段到后端字段映射表》：页面组件字段、接口字段、存储字段三向对齐
- [x] 定义统一任务领域模型：
  - `workflow`：`notes | vqa`
  - `status`：`queued | running | completed | failed | cancelled`
  - `steps[]`：`id/name/status/progress/duration/logs`
- [x] 统一错误响应结构：`code/message/hint/retryable`
- [x] 统一时间与数值格式：UTC ISO 时间、文件大小字节值、时长秒值
- [x] 建立接口版本策略：`/api` 下保持向后兼容，新增字段优先扩展不破坏现有调用

验收标准：

- [x] 前后端共同确认字段字典，作为后续开发唯一实现基线
- [x] 至少完成 1 轮接口 mock 联调并通过

## 阶段 1：任务创建与处理主链路（P0）

- [x] 任务创建接口统一：
  - 支持上传文件并返回 `task_id + workflow + initial_steps`
  - 支持多文件入参时的任务拆分策略（单任务单视频 或 批量任务）
- [x] 任务执行状态流重构：
  - 提供页面直接可渲染的 `steps` 结构
  - 提供整体进度 `overall_progress`
  - 细分 `current_step` 与 `eta_seconds`（可选）
- [x] 任务事件流增强（SSE）：
  - 事件类型最小集：`task_started/step_updated/transcript_chunk/artifact_ready/task_completed/task_failed`
  - 每类事件带 `task_id/workflow/timestamp`
- [x] 转写结果接口对齐：
  - 返回 `transcript_segments[]`（含 `start/end/text/speaker?`）
  - 支持按时间戳跳转所需索引信息
- [x] 取消任务接口行为对齐：
  - 统一终态回写
  - 明确可取消窗口与错误码

验收标准：

- [x] 从“新建任务”点击开始后，处理页能持续显示真实步骤变化
- [x] 转写列表可点击跳转到对应时间点且数据来自后端

## 阶段 2：notes 结果链路（P0）

- [x] 输出产物结构统一：`notes_markdown`、`mindmap_markdown`、`summary_markdown`
- [x] 结果编辑保存接口稳定化：支持局部字段更新与并发保护（版本号或更新时间戳）
- [x] 思维导图渲染依赖字段补齐：提供导图源文本 + 渲染资产索引
- [x] 导出接口对齐前端动作：
  - 单项导出（Markdown/字幕）
  - 打包导出（含 notes-images）

验收标准：

- [x] 笔记编辑后刷新页面可回显
- [x] 导出文件内容与页面展示一致

## 阶段 3：vqa 问答链路（P0）

- [x] VQA 请求统一入参：`task_id + question + top_k + stream`
- [x] 检索返回结构对齐处理页：
  - `results[]` 含 `timestamp/relevance/context/source`
  - 支持点击结果跳转视频时间点
- [x] 流式问答稳定化：
  - 统一 `chunk/done/error` 事件
  - 异常自动降级到非流式答案
- [x] Trace 能力收敛：
  - 每次问答生成 `trace_id`
  - 可查询检索命中与回答摘要

验收标准：

- [x] 在 VQA 模式输入问题后，页面可展示实时回复与片段定位
- [x] 任一问答会话都可追溯到 trace 记录

## 阶段 4：历史记录链路（P1）

- [x] 历史列表接口增强：
  - 支持搜索（名称关键字）
  - 支持过滤（workflow/status）
  - 支持排序（时间/名称/大小）
- [x] 历史统计接口：
  - 返回 `total/notes/vqa/completed`
- [x] 任务操作接口对齐：
  - 删除
  - 导出
  - 打开文件位置（返回本地路径）
- [x] 最近任务接口：
  - 支持侧栏“最近任务”展示

验收标准：

- [x] 历史页所有筛选与排序均基于真实数据可复现
- [x] 侧栏最近任务不再依赖前端写死内容

## 阶段 5：设置中心链路（P1）

- [x] 新增模型中心接口：
  - `GET /api/config/models`
  - `POST /api/config/models/reload`
  - `PATCH /api/config/models/{model_id}`
- [x] 模型类型统一：`whisper/llm/embedding/vlm/rerank`
- [x] 模型状态统一：`ready/loading/error`
- [x] 提示词模板通道扩展到前端所需 4 类：
  - `correction`
  - `notes`
  - `mindmap`
  - `vqa`
- [x] 外观与语言配置持久化：
  - 字体大小
  - 自动保存
  - 界面语言

验收标准：

- [x] 设置页所有表单刷新后可回显
- [x] 模板 CRUD 在四类模板上行为一致

## 阶段 6：系统自检与运行态指标（P1）

- [x] 自检项扩展为页面同构检查模型：
  - 系统环境
  - GPU 能力
  - Whisper
  - LLM
  - Embedding
  - VLM
  - ChromaDB
  - 存储空间
- [x] 自检结果结构对齐前端卡片：
  - `status/message/details`
  - 支持逐项事件推送
- [x] 运行态指标接口：
  - 运行时长
  - CPU 使用率
  - 内存占用
  - GPU 使用率

验收标准：

- [x] 点击“开始检查”后，前端可以逐项展示真实进度与结果
- [x] 运行时信息卡片由后端实时数据驱动

## 阶段 7：质量保障与上线准备（P0）

- [x] 后端测试补齐：
  - 接口契约测试（FastAPI TestClient）
  - 服务单测（task/config/vqa/self-check）
  - SSE 事件序列测试
- [x] 联调测试补齐：
  - 新建任务到完成的全流程
  - notes/vqa 两种工作流回归
  - 历史/设置/自检页面回归
- [x] 稳定性保障：
  - 超时、取消、重试、并发、磁盘不足场景
  - 大文件上传和长任务场景
- [x] 文档与运维：
  - API 字段说明
  - 本地运行与故障定位手册

验收标准：

- [x] 主链路用例通过率 100%
- [x] 关键异常场景具备可解释报错与恢复路径

## 7. 里程碑建议（可直接排期）

- [x] M1（阶段 0-1）：任务创建 + 处理页实时链路打通
- [x] M2（阶段 2-3）：notes 与 vqa 两条结果链路打通
- [x] M3（阶段 4-6）：历史、设置、自检全量真实数据化
- [x] M4（阶段 7）：联调验收、回归、发布准备

## 8. 每日执行模板（落地跟踪）

- [x] 今日目标（1 句话）
- [x] 今日接口（新增/变更）
- [x] 今日完成（可验证结果）
- [x] 今日风险（阻塞项）
- [x] 明日计划（下一步）

## 9. RAG 实现细节（补充落地）

本章节用于细化阶段 3（VQA 问答链路）的实现标准，参数基线参考 `F:\in-house project\Local-VQA\docs\optimize.md`，并按 VidGnost 前端页面交互要求进行收敛。

## 9.1 证据构建与切片规范

- [x] 检索证据单元统一为时间片段（window），默认 `window_seconds=2.0`、`stride_seconds=1.0`
- [x] 每个 window 聚合多模态证据字段：
  - `asr_text`
  - `ocr_text`
  - `visual_caption`
  - `start_seconds`
  - `end_seconds`
  - `source_set`（audio/visual/ocr）
- [x] 视觉证据采用“场景切分 + 关键帧采样”策略，默认参数：
  - `preview_fps=1`
  - `scene_diff_threshold=0.42`
  - `max_scene_seconds=30`
  - `candidate_fps=2`
  - `min_gap_seconds=1.5`
  - `quota=clamp(round(scene_len/8),1,4)`
- [x] 每个场景强制保留中点关键帧，保证长场景语义覆盖

验收标准：

- [x] 任意返回证据都可回溯到 `start/end` 时间段
- [x] 检索命中可展示 audio/visual/ocr 来源标签

## 9.2 索引与持久化规范

- [x] Dense 检索落地 ChromaDB `PersistentClient`，持久化目录：`backend/storage/vector-index/chroma-db`
- [x] Collection 命名固定：`video_clips`
- [x] 向量条目最小 metadata：
  - `doc_id`
  - `task_id`
  - `start`
  - `end`
  - `source`
  - `has_image`
  - `language`
- [x] `doc_id` 在 Dense/Sparse/RRF/Rerank 四阶段保持一致，支持全链路追踪
- [x] 索引构建、持久化、批量写入在后台任务线程执行，避免阻塞主线程

验收标准：

- [x] 后端重启后可直接复用历史索引
- [x] 任一命中项都可通过 `doc_id` 查询完整元数据

## 9.3 Hybrid 检索与重排规范

- [x] 检索链路采用 `Dense + Sparse + RRF + Rerank` 四段式
- [x] Dense：ChromaDB 语义召回
- [x] Sparse：SQLite FTS5 关键词召回（与 Dense 并行）
- [x] RRF 融合参数：`rrf_k=60`
- [x] 召回与重排默认参数：
  - `dense_top_k=80`
  - `sparse_top_k=120`
  - `fused_top_k=40`
  - `rerank_top_n=8`
- [x] 输出结果包含 `dense_score/sparse_score/rrf_score/rerank_score/final_score`

验收标准：

- [x] VQA 调试页可显示四阶段命中对比
- [x] 不同参数下可重复复现同一 trace 结果

## 9.4 上下文构建与回答约束

- [x] RAG 上下文构建顺序：相关性优先 + 时间顺序校准
- [x] 上下文预算：`max_context_tokens=6000`
- [x] 默认回答证据规模：`retrieval_top_k=24`、`rerank_top_n=8`
- [x] 回答必须带证据锚点：
  - 时间点或时间段
  - 证据来源（audio/visual/ocr）
  - 片段摘要
- [x] 图文混排输出限制：`max_images_per_answer=3`

验收标准：

- [x] 前端问答消息可展示时间锚点并跳转播放器
- [x] 回答区可渲染文本 + 证据图卡 + 引用片段

## 9.5 流式传输与降级策略

- [x] 首选流式协议：
  - `POST /api/chat/stream`（SSE）
  - 备选 `fetch + ReadableStream`
- [x] 事件规范：`citations -> chunk* -> done | error`
- [x] 流式异常时自动切换到非流式补全，并在事件中标记 `status=fallback`
- [x] 前端必须展示“流式中/降级中/完成”可视状态

验收标准：

- [x] 在网络抖动场景下，问答可稳定完成且用户可见状态一致
- [x] 降级后仍保留证据锚点与可跳转时间链接

## 9.6 可观测与白盒追踪

- [x] 每轮问答生成唯一 `trace_id`
- [x] trace 记录最小字段：
  - `query_text`
  - `config_snapshot`
  - `dense_hits`
  - `sparse_hits`
  - `rrf_hits`
  - `rerank_hits`
  - `final_context_preview`
  - `llm_output_preview`
  - `latency_by_stage`
- [x] trace 存储路径：`backend/storage/event-logs/traces`
- [x] 保留 OpenTelemetry 对接点（可选开关），默认本地 JSONL 可回放

验收标准：

- [x] 通过 `trace_id` 能完整回放一次问答决策链路
- [x] 关键阶段耗时可用于性能分析

## 10. 模型选型与配置基线（补充）

## 10.1 选型原则

- [x] 优先满足“16GB 内存 + 4GB 显存级别设备”的稳定运行
- [x] 模型能力按角色拆分：`whisper/llm/embedding/vlm/rerank`
- [x] 同一角色提供默认模型与扩展模型，便于设置中心动态切换

## 10.2 模型矩阵（建议默认）

| 角色 | 默认模型 | 可选模型 | 资源建议 | 选型理由 |
|---|---|---|---|---|
| ASR | `faster-whisper small` | `faster-whisper medium` | CPU 优先，显存占用低 | 语速与准确率平衡，适配本地转写 |
| Embedding | `bge-m3`（Ollama） | 其它可用 Ollama embedding 模型 | 本地拉取，索引体积与语义覆盖平衡 | 统一走 Ollama，减少本地 Python 推理依赖 |
| Rerank | `sam860/qwen3-reranker:0.6b-q8_0`（Ollama） | 其它可用 Ollama rerank 模型 | 小模型优先，兼顾本地稳定性 | 提升 Top-K 精度，保持 4GB 显存设备可落地 |
| VLM | `moondream`（Ollama） | 其它可用 Ollama vision 模型 | 轻量视觉理解优先 | 抽帧补充画面语义，避免本地 `transformers` OOM |
| LLM（默认本地） | `qwen2.5:3b`（Ollama `/v1`） | 其它 OpenAI-compatible / Ollama 模型 | 本地优先，仍保留兼容远端 API 能力 | 统一走 OpenAI-compatible 调用链，兼顾本地可用性与流式输出 |

## 10.3 设置中心最小配置项

- [x] `model_id`
- [x] `provider`
- [x] `load_profile`
- [x] `device`
- [x] `quantization`
- [x] `max_batch_size`
- [x] `status`（ready/loading/error）
- [x] `last_check_at`

验收标准：

- [x] 设置页可展示五类模型的状态与基础资源信息
- [x] 模型切换后新任务自动按新配置执行

## 10.4 推荐配置片段（文档基线）

```toml
[semantic]
model_id = "bge-m3"
query_prefix = ""
document_prefix = ""

[retrieval]
mode = "hybrid"
dense_top_k = 80
sparse_top_k = 120
rrf_k = 60
fused_top_k = 40
rerank_top_n = 8

[rag]
retrieval_top_k = 24
rerank_top_n = 8
max_context_tokens = 6000
include_modalities = ["audio", "visual", "ocr"]
max_images_per_answer = 3

[llm]
enabled = true
provider = "ollama"
base_url = "http://127.0.0.1:11434/v1"
model = "qwen2.5:3b"
timeout_seconds = 60
stream = true
```

说明：

- 配置读取统一从后端配置中心接口返回，前端只负责展示与提交。
- 密钥统一走环境变量与安全存储，不进入日志与导出内容。
- 参数调优以 trace 评估结果为准，保持可量化迭代。

---

维护说明：本清单为当前前端版本对应的后端执行基线，后续仅在前端页面能力新增或字段契约变化时同步更新。
