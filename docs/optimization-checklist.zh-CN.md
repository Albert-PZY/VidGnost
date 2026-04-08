# VidSense 低配高性能融合优化总清单（16G 内存 + 8G 显存）

更新时间：2026-04-03  
适用范围：VidGnost 当前 `master` 基线（包含多模态配置矩阵、本地/API 模式、SSE 流）

## 1. 文档定位

目标：

- 在不牺牲分析质量前提下，提升 16G 内存 + 8G 显存场景的稳定性和性能；
- 统一“方案边界、工程清单、验收标准”，避免信息分散；
- 以可落地增量改造为主，不做高风险大重构。

## 2. 设计原则与硬约束

1. 资源锁级调度：同一时刻只允许一个重模型处于活跃推理状态。
2. 模态分层执行：CPU 仅负责抽帧/去重/质量过滤等非模型计算，模型推理统一使用 GPU。
3. 质量弹性：非核心环节允许轻量化，核心识别与语义理解优先保精度。
4. 流式处理：音频、关键帧、文本分块处理并及时释放，避免内存堆积。
5. 降级可见：所有自动回退必须通过 `runtime_warning` 实时通知用户。
6. 模型侧统一 GPU-only：禁止降级到 CPU；GPU 条件不满足时，分析处理阶段直接失败并提示原因。

资源目标值（建议）：

- 内存峰值 <= 12 GiB（保留 >= 4 GiB 系统余量）。
- 显存峰值 <= 6 GiB（保留 >= 2 GiB 安全余量）。

默认禁用项：

- 重模型并行驻留；
- 高分辨率关键帧批量缓存；
- 引入向量库/消息队列作为本轮前置依赖。

## 3. 豆包方案融合后的取舍结论

## 3.1 直接吸收

1. 单模型串行占显存。
2. 轻重任务分层。
3. 长视频流式释放。
4. 功能分级启用（核心能力优先保障）。
5. OCR 与 VLM 分工互补。

## 3.2 校正后吸收

1. “自动关闭冗余进程”改为“检测 + 提示 + 用户确认”。
2. 统一 GPU-only 运行策略：无 GPU 或 CUDA 条件不满足时，分析阶段直接失败，不做 CPU 兜底。
3. “性能提升 30%+”改为“基于基准测试给区间目标，不写死绝对值”。

## 3.3 暂不采用

1. 激进“零缓存”口号式策略（改为小缓存 + 流式释放）。
2. 未验证的大规模跨框架替换。

## 4. 目标架构（增量改造）

1. `Resource Guard`（增强）
   - 磁盘/内存/显存预检查、配置回退、warning 标准化。
2. `Model Runtime Manager`（新增）
   - 统一管理 LLM/VLM/OCR 生命周期，保证串行激活与释放。
3. `Multimodal Enrichment`（增强）
   - 保留镜头检测与去重，补齐片段级证据链结构。
4. `Summarizer`（增强）
   - 从“纯 Markdown 生成”升级为“结构化中间结果 + 渲染”。
5. `SSE + 前端提示`（增强）
   - 回退和降级必须可见、可解释、可追踪。

## 5. 四阶段流水线重构（保持 A/B/C/D 编号不变）

1. A 阶段：预检与输入标准化
   - 内容：资源预检（磁盘/GPU/CUDA）、配置回退、视频入库、音频标准化。
   - 输出产物：`media_artifact`（视频路径、音频路径、时长、基础元数据）。
   - 失败策略：模型条件不满足直接失败（`GPU_RUNTIME_REQUIRED`），不进入后续阶段。

2. B 阶段：ASR 主链路
   - 内容：分块转写、段落拼接、`strict/rewrite` 纠错策略。
   - 输出产物：`transcript_artifact`（`segments`、`transcript_text`、`correction_meta`）。
   - 关键约束：`strict` 保时间轴；`rewrite` 仅用于总结输入，不回写时间轴。

3. C 阶段：视觉证据链（OCR/VLM）
   - 内容：场景检测、抽帧、去重、帧质过滤、OCR、VLM、与转写片段对齐。
   - 输出产物：`visual_evidence_artifact`（按 `segment` 聚合，而非散乱字符串）。
   - 失败策略：按功能开关降级（如关闭 VLM），但不走 CPU 模型兜底。

4. D 阶段：融合生成与交付
   - 内容：融合 `transcript_artifact + visual_evidence_artifact`，生成 `notes/mindmap/subtitles/export`。
   - 输出产物：最终 DB 持久化与导出包。
   - 关键约束：LLM 全不可用时直接失败，不再 fallback 硬编码笔记。

## 6. 统一优化清单（执行主表）

| ID | 优先级 | 问题 | 优化动作 | 主要改动位置 | 验收标准 |
|---|---|---|---|---|---|
| A01 | 高 | 音画对齐仍偏最近时间戳映射，证据链弱 | 引入 `segment_evidence`（每段含 ASR/OCR/VLM/时间窗/置信度），汇总按段注入 | `backend/app/services/multimodal_enrichment.py` `backend/app/services/task_runner.py` `backend/app/services/summarizer.py` | 任一结论可追溯到时间锚点；同视频重复运行结构一致 |
| A02 | 高 | 本地 LLM/VLM 可能长期驻留显存，8G 易 OOM | 新增模型运行时管理器：串行激活、任务后释放、跨任务 LRU 驱逐 | 新增 `backend/app/services/model_runtime_manager.py` 并接入推理链路 | 连续 3 个长视频任务无 CUDA OOM；任务间显存可回落 |
| A03 | 高 | 本地模型缺少量化/加载档位，8G 弹性不足 | 增加 `load_profile`（`balanced`/`memory_first`），低配默认优先节省显存 | `backend/app/schemas.py` `backend/app/services/runtime_config_store.py` `backend/app/services/llm_config_store.py` `frontend/src/types.ts` `frontend/src/App.tsx` | 前端可配置；8G 下 `memory_first` 成功率高于默认档 |
| A04 | 高 | scene 策略阈值未完整外置 | 暴露 `scene_mode`、`scene_threshold`、`max_frames`、`long_scene_interval_seconds` | `backend/app/schemas.py` `backend/app/services/runtime_config_store.py` `frontend/src/App.tsx` | 配置可持久化；越界值被校正并返回 warning |
| A05 | 高 | 降级可见性不统一，存在静默回退风险 | 统一 `runtime_warning` 结构：`code/component/action/message` | `backend/app/services/task_runner.py` `backend/app/api/routes_tasks.py` `frontend/src/types.ts` `frontend/src/App.tsx` | 所有降级都可在 toast+终端实时看到原因码 |
| A06 | 高 | 下载/解压模型全量读内存且缺少安全校验 | 流式下载、解包路径校验、防路径穿越、失败重试与校验和 | `backend/app/services/multimodal_enrichment.py` | 大包下载内存稳定；异常包不会写到目标目录外 |
| A07 | 中 | 视觉链路中间结果难复盘 | 增加调试产物 `visual-evidence.json`（默认不进 bundle） | `backend/app/services/task_runner.py` `backend/app/api/routes_tasks.py` | 可复盘每帧去留原因与片段映射 |
| A08 | 中 | 输出结构可控性不足，笔记波动偏大 | 先生成结构化 JSON，再渲染 Markdown；解析失败可回退 | `backend/app/services/summarizer.py` | 同输入多次运行结构稳定；失败可回退不中断 |
| A09 | 中 | 资源保护偏磁盘，内存/GPU 前置判断不足 | 扩展 `resource_guard` 内存和 GPU 阈值检查，并支持功能级配置回退（不回退到 CPU） | `backend/app/services/resource_guard.py` `backend/app/api/routes_config.py` | 保存配置时可提前阻断高风险组合并提示原因 |
| A10 | 中 | 依赖安装负担偏重 | 拆分可选依赖组（`ocr`/`vision-local`/`llm-local`），默认保持轻量安装 | `backend/pyproject.toml` `README.md` `README.zh-CN.md` | 最小安装可跑纯转写；按需安装可开高级能力 |
| A11 | 中 | 可观测性偏日志，指标不足 | 增加阶段耗时、帧候选/保留、OCR/VLM 命中率、降级次数等指标 | `backend/app/services/task_runner.py` `backend/app/models.py` 或 metrics 文件 | 历史任务可查看关键指标并用于定位瓶颈 |
| A12 | 中 | 长文本汇总裁剪粗糙，后段信息可能丢失 | 引入“分段聚合 + 滑窗摘要 + 最终汇总” | `backend/app/services/summarizer.py` | 超长文本下后段信息保留率明显提升 |
| A13 | 中 | 并发策略固定，不区分本地/API 模式 | 本地模型模式自动收敛并发，API 模式适度放开并发 | `backend/app/config.py` `backend/app/services/task_runner.py` | 本地模式显存竞争减少，API 模式吞吐不受限 |
| A14 | 低 | 文档与产物描述不一致（历史残留） | 修正 quick-start 与 README 中 `summary.md` 等过期描述 | `frontend/src/docs/quick-start.zh-CN.md` `frontend/src/docs/quick-start.en.md` `README*` | 文档与实际导出文件完全一致 |
| A15 | 低 | Python 版本门槛偏高 | 评估 `requires-python` 下调可行性并做兼容性验证 | `backend/pyproject.toml` CI 脚本 | 下调后测试通过；若冲突记录原因并保留现状 |
| A16 | 高 | LLM 全不可用时仍可能输出低质量硬编码笔记 | 明确禁止 `_fallback_summary/_fallback_mindmap` 作为线上兜底；本地/API 都不可用时直接标记“分析生成失败”并给出可读错误 | `backend/app/services/summarizer.py` `backend/app/services/task_runner.py` `frontend/src/App.tsx` | LLM 不可用时任务状态为失败，前端看到明确失败原因，不再产出硬编码 notes/mindmap |
| A17 | 高 | 用户编辑 `notes/mindmap` 后若不持久化，导出可能仍是旧内容 | 持久化用户编辑后的 `notes_markdown/mindmap_markdown`（含更新时间或版本号），导出统一读取最新持久化值 | `backend/app/models.py` `backend/app/api/routes_tasks.py` `frontend/src/App.tsx` | 页面展示、历史详情、导出内容三者一致，不出现“看见新内容导出旧内容” |
| A18 | 中 | 不记录任务大小和产物索引，无法自动清理，磁盘会长期膨胀 | 持久化任务产物索引（路径、大小、更新时间），引入按容量阈值与保留策略的自动清理（LRU/过期） | `backend/app/models.py` `backend/app/services/task_runner.py` `backend/app/services/startup_cleanup.py` | 磁盘低于阈值时可自动清理旧任务产物；清理后索引与实际文件一致 |
| A19 | 中 | 四阶段在前端展示术语偏工程化，普通用户理解成本高 | 为 A/B/C/D 设计“专业且大众化”的双层文案（阶段名 + 一句话解释），并在运行面板统一显示 | `frontend/src/App.tsx` `frontend/src/i18n/resources.ts` `docs/ui/vidsense-ui-prompt.md` | 普通用户可在不懂技术细节时理解当前阶段在做什么；中英文文案语义一致 |
| A20 | 高 | 日志链路可读性不足，用户难以直观看到进度与卡点 | 完善日志事件规范与展示：阶段/子阶段/动作/耗时/warning 统一格式，前端按时间线渲染并支持关键日志高亮 | `backend/app/services/task_runner.py` `backend/app/api/routes_tasks.py` `frontend/src/App.tsx` `frontend/src/types.ts` | 虚拟机界面可直观看到“当前在做什么、做了多久、是否异常”；排障不依赖后端控制台 |
| A21 | 中 | 分析执行中缺少明显“正在工作”反馈，等待感强 | 在正在执行的阶段末尾增加 `Working` 动画（仿 Codex CLI）并实时刷新阶段执行时长（秒级） | `frontend/src/App.tsx` `frontend/src/index.css` | 任务进行时可持续看到动态状态与累计耗时；阶段完成后动画自动停止并冻结最终耗时 |

### 执行进展（2026-04-03）

已完成（代码已落地并通过后端单测 + 前端类型/构建）：

1. `A01` 片段级证据链（`segment_evidence`）与调试导出。
2. `A02` GPU 重模型串行调度（`ModelRuntimeManager`）+ 跨任务 LRU 驱逐（含驱逐日志与阶段指标）。
3. `A03` 模型栈加载档位 `load_profile`（`balanced` / `memory_first`）前后端贯通。
4. `A04` 抽帧策略参数外置（`scene_mode` / `scene_threshold` / `max_frames` / `long_scene_interval_seconds`）。
5. `A05` 统一 `runtime_warning` 事件结构与前端可见性。
6. `A06` OCR 模型下载解压安全加固（流式 + 安全解包）。
7. `A07` `visual-evidence` 调试产物链路（默认不进主 bundle）。
8. `A08` 笔记输出增加结构化中间层（Markdown -> 结构化摘要 -> 规范化 Markdown），解析异常自动回退原文。
9. `A09` GPU 运行前检测失败快速失败（不降级 CPU）。
10. `A11` 阶段指标补全（耗时、日志计数、视觉命中等）。
11. `A16` LLM 全不可用时直接失败（移除硬编码笔记兜底）。
12. `A17` 用户编辑 `notes/mindmap` 持久化后导出一致性。
13. `A18` 新增任务产物索引与大小统计，启动时按预算自动清理历史终态任务。
14. `A19` 四阶段 UI 文案专业化 + 大众化双层描述。
15. `A20` 日志链路可读性增强（阶段/子阶段/耗时/warning）。
16. `A21` 运行中 `Working` 动画与阶段耗时实时刷新。
17. `A10` 后端依赖按能力拆分为可选 extras（`ocr` / `llm-local` / `vision-local`），最小安装保留轻量链路。
18. `A12` 汇总链路升级为“滑窗全程覆盖 + 分段聚合 + 上下文压缩汇总”（避免仅截断前段文本）。
19. `A13` 并发策略按模式分流（本地模式收敛并发，API 模式放宽并发）。
20. `A14` README 与 Quick Start 清理 `summary.md` 过期描述，导出说明与实际一致。
21. `A15` 按当前约束固定 `requires-python ==3.12.*`，并在脚本中统一使用 `uv sync --python 3.12`。

## 7. 统一降级矩阵（必须落地）

| 触发条件 | 自动动作 | 前端可见事件码 |
|---|---|---|
| GPU 不可用或 CUDA 运行库缺失 | 分析处理阶段直接失败（禁止 CPU 兜底） | `GPU_RUNTIME_REQUIRED` |
| 磁盘不足以下载 OCR 模型 | 关闭 OCR | `OCR_MODEL_DISK_LOW` |
| 磁盘不足以下载本地 VLM | 关闭 VLM 本地模式 | `VLM_MODEL_DISK_LOW` |
| 磁盘不足以部署本地 LLM | 回退到 API 模式 | `LLM_MODEL_DISK_LOW` |
| 运行时显存不足 | 关闭 VLM，仅保留 ASR/OCR 核心 | `VLM_RUNTIME_OOM_GUARD` |
| 在线 API 不可用 | 切换到本地 LLM（若本地可用） | `LLM_API_UNAVAILABLE` |
| 本地与在线 LLM 均不可用 | 直接标记“分析生成失败”，禁止硬编码笔记兜底 | `LLM_ALL_UNAVAILABLE` |

约束：后端事件至少包含 `code`、`component`、`action`、`message` 四字段。

## 8. 实施顺序（不分阶段版本）

1. 先做稳定底座：A02、A05、A06、A09。
2. 再做质量增强：A01、A08、A12。
3. 最后做工程收敛：A03、A04、A10、A11、A13、A14、A15、A17、A18、A19、A20、A21。

说明：虽然不按 P0/P1/P2 命名，但执行顺序仍按“风险优先”推进。

## 9. 回归测试清单（每次变更必跑）

1. 后端单测：`backend/tests` 全量通过。
2. 前端类型检查：`pnpm -C frontend exec tsc --noEmit` 通过。
3. 前端构建：`pnpm -C frontend build` 通过。
4. OpenSpec 校验：`python scripts/check-openspec.py` 通过。
5. 端到端最小覆盖：
   - 仅转写（OCR/VLM 关闭）；
   - OCR 开启、VLM 关闭；
   - OCR 关闭、VLM API 开启；
   - 本地 LLM + 本地 VLM（8G 压力路径）；
   - 资源不足触发自动回退与实时告警。
   - 用户编辑 `notes/mindmap` 后重新导出，导出内容与最新编辑一致；
   - 自动清理后 DB 索引与文件系统状态一致。
   - 四阶段 UI 显示“阶段名 + 易懂说明”且与实际运行阶段一致；
   - 日志时间线可追踪阶段、子阶段、warning，并能直观看到当前处理进度；
   - 正在运行阶段显示 `Working` 动画与实时累计耗时，完成后自动停止。

## 10. 完成定义（Definition of Done）

1. 高优先级项（A01-A06）全部完成并通过回归。
2. 无静默降级，所有回退都能在前端看到原因和动作。
3. 60 分钟以上视频处理无显著内存/显存失控。
4. 文档、导出产物、实际行为三者一致。

