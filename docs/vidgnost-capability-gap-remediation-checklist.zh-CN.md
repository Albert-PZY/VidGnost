# VidGnost TS 全栈能力补齐与优化执行清单

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. It will decide whether each batch should run in parallel or serial subagent mode and will pass only task-local context to each subagent. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐当前 TS 全栈版本相对“已删除的 Python 后端能力预期”和“现有 OpenSpec 承诺”之间的真实差距，同时把项目的 Spec 使用方式从“事后补录”改造成“先约束、再实现、再验收”的闭环流程。

**Architecture:** 继续以 `apps/api + apps/desktop + packages/contracts` 作为唯一 TS 全栈主线，不恢复 Python。优先修复“代码、测试、OpenSpec、README 四层不一致”的高风险区域，再补齐纠错、VQA、Ollama 管理、自检与性能稳定性能力；所有新增或修正功能必须同步落在代码、测试、文档与验收命令中。

**Tech Stack:** TypeScript 5, Fastify 5, React 19, Electron 31, pnpm workspace, Vitest, Zod, SSE, whisper.cpp CLI / OpenAI-compatible ASR, Ollama / OpenAI-compatible API

---

## 1. 执行边界

- 不恢复 Python 后端、不引入新的 Python sidecar。
- 不为了“让文档看起来完整”继续保留未实现却标为完成的能力描述。
- 不在没有测试和验收证据的前提下把任务项标记为完成。
- 能收敛到现有目录结构的能力优先在现有目录落地，避免无意义大重排。

## 2. 当前确认的真实差距

| 优先级 | 差距主题 | 当前现状 | 风险 |
| --- | --- | --- | --- |
| P0 | Spec 与代码不一致 | OpenSpec 和 `tasks.md` 中已有多处“已完成”描述明显超前于实现 | 团队误判完成度，后续开发基线失真 |
| P0 | 文本纠错模式未真正落地 | `off/strict/rewrite` 配置存在，但运行时未体现不同语义，`batch/overlap` 未被任务链消费 | 输出质量和 UI 状态说明不可信 |
| P0 | VQA 仍是启发式实现 | 当前检索为 `hybrid-heuristic`，回答为模板拼装，不是真正 embedding/rerank/multimodal 主链 | 检索质量、可解释性和扩展性不足 |
| P0 | Ollama 托管能力未真正实现 | 模型下载、服务重启、模型目录迁移目前多为状态探测或文案占位 | 设置中心存在“可点不可用”的假能力 |
| P0 | 自检深度不足 | LLM 自检未探测 `/models`，Chroma/向量索引自检只看目录存在 | 自检结果乐观失真 |
| P1 | ASR 鲁棒性不足 | `whisper.cpp` 路径基于 SRT 解析，长音频、时间戳、分块与中文修复未形成完整验证基线 | 长视频转写质量和稳定性不确定 |
| P1 | 摘要与导图仍有较重回退逻辑 | LLM 失败后回落到启发式 notes/mindmap 生成 | 输出质量波动较大，失败信息不透明 |
| P1 | 运行期性能与内存稳定性仍需加强 | 后端 CPU 密集逻辑仍在主进程，部分缓存与流式生命周期仍偏松 | 长任务、并发、多会话时存在卡顿或资源滞留风险 |
| P2 | Spec 使用方式仍偏事后同步 | 目前主要依赖 pre-commit 阻止“完全不改 spec”，不是 spec-first | Spec 的指导价值弱于其合规价值 |

## 3. 目标文件布局

以下文件和目录是本轮能力补齐与治理优化的主要落点：

### 3.1 后端核心模块

- `apps/api/src/modules/summary/summary-service.ts`
- `apps/api/src/modules/asr/asr-service.ts`
- `apps/api/src/modules/runtime/self-check-service.ts`
- `apps/api/src/modules/models/ollama-service-manager.ts`
- `apps/api/src/modules/models/model-catalog-repository.ts`
- `apps/api/src/routes/config.ts`
- `apps/api/src/modules/tasks/task-orchestrator.ts`
- `apps/api/src/modules/vqa/vqa-runtime-service.ts`

### 3.2 建议新增的后端文件

- `apps/api/src/modules/summary/transcript-correction-service.ts`
- `apps/api/src/modules/summary/fallback-artifact-service.ts`
- `apps/api/src/modules/vqa/retrieval-index-service.ts`
- `apps/api/src/modules/vqa/embedding-runtime-service.ts`
- `apps/api/src/modules/vqa/rerank-runtime-service.ts`
- `apps/api/src/modules/vqa/multimodal-retrieval-service.ts`
- `apps/api/src/modules/models/ollama-process-supervisor.ts`
- `apps/api/src/modules/runtime/llm-readiness-service.ts`
- `apps/api/src/modules/asr/whisper-cli-runner.ts`
- `apps/api/src/modules/asr/transcript-segment-normalizer.ts`

### 3.3 测试文件

- `apps/api/test/self-check.test.ts`
- `apps/api/test/vqa.test.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/tasks-write.test.ts`
- `apps/api/test/runtime.test.ts`
- 建议新增：
  - `apps/api/test/summary-service.test.ts`
  - `apps/api/test/asr-service.test.ts`
  - `apps/api/test/ollama-service-manager.test.ts`
  - `apps/api/test/retrieval-index-service.test.ts`

### 3.4 文档与规范

- `docs/openspec/changes/build-lightweight-v2/tasks.md`
- `docs/openspec/specs/llm-runtime-config/spec.md`
- `docs/openspec/specs/web-workbench-ui/spec.md`
- `docs/openspec/specs/transcription-pipeline/spec.md`
- `docs/openspec/changes/build-lightweight-v2/specs/**`
- `docs/current-tech-stack.zh-CN.md`
- `docs/backend-api-and-ops-baseline.zh-CN.md`
- `docs/frontend-driven-backend-execution-checklist.zh-CN.md`
- `README.md`
- `README.zh-CN.md`

## 4. P0 执行任务

### Task 1: 冻结真实能力基线并纠正文档失真

**Files:**
- Modify: `docs/openspec/changes/build-lightweight-v2/tasks.md`
- Modify: `docs/openspec/specs/llm-runtime-config/spec.md`
- Modify: `docs/openspec/specs/web-workbench-ui/spec.md`
- Modify: `docs/openspec/specs/transcription-pipeline/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/llm-runtime-config/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/web-workbench-ui/spec.md`
- Modify: `docs/openspec/changes/build-lightweight-v2/specs/transcription-pipeline/spec.md`
- Modify: `docs/current-tech-stack.zh-CN.md`
- Modify: `docs/backend-api-and-ops-baseline.zh-CN.md`

- [ ] 输出一份“代码事实 vs OpenSpec 承诺”对照矩阵，字段至少包含：`能力名称 / 当前实现状态 / 差距说明 / 处理方式（补实现或降级文档） / 责任模块`。
- [ ] 回退所有明显超前的完成标记，尤其是：
  - `Whisper 自动下载`
  - `实时模型下载进度流`
  - `LLM /models 探测型自检`
  - `VQA prewarm 已复用`
  - `joint text-image retrieval 已可用`
  - `Ollama 自动重启与自动迁移已可用`
- [ ] 对每条差距做二选一决策：
  - 继续保留为目标能力，则写成“planned / partial / pending”
  - 近期不做，则收缩 spec，不允许继续描述为已实现能力
- [ ] 在文档里补上统一完成定义：`代码 + 测试 + OpenSpec + README + 验证命令` 全齐，才能把任务项改为完成。
- [ ] 让 `README`、技术栈文档、后端基线文档和 OpenSpec 使用同一套术语，避免一处写“已托管下载”，另一处又写“当前不接管”。

**验证命令：**

```powershell
node scripts/check-openspec.mjs
rg -n "auto-download|download progress|/models|prewarm|multimodal|自动重启|已完成" docs/openspec docs README*
```

**完成标准：**

- `tasks.md` 与代码现实一致
- OpenSpec 不再把未实现能力描述成已完成
- README/技术栈/OpenSpec 的同一能力描述不互相打架

### Task 2: 实现真正可执行的文本纠错模式

**Files:**
- Create: `apps/api/src/modules/summary/transcript-correction-service.ts`
- Modify: `apps/api/src/modules/summary/summary-service.ts`
- Modify: `apps/api/src/modules/tasks/task-orchestrator.ts`
- Modify: `packages/contracts/src/config.ts`
- Modify: `apps/api/test/tasks-write.test.ts`
- Test: `apps/api/test/summary-service.test.ts`

- [ ] 把“转录纠错”从 `summary-service.ts` 中拆出独立服务，明确区分三种模式：
  - `off`: 不调用纠错链，直接进入下游
  - `strict`: 保持时间戳对齐，逐片段纠错
  - `rewrite`: 允许全文重写，但必须保留原文与最终文的可追溯关系
- [ ] 真正消费 `correction_batch_size` 与 `correction_overlap`，不能继续只停留在配置层。
- [ ] 为 `strict` 模式建立“按时间戳对齐”的结果结构，不能只返回一段整体文本。
- [ ] 为 `rewrite` 模式增加显式回退元数据，例如 `fallback_used`、`fallback_reason`、`source_mode`。
- [ ] 把纠错中间产物持久化到清晰路径，例如：
  - `D/transcript-optimize/index.json`
  - `D/transcript-optimize/strict-segments.json`
  - `D/transcript-optimize/rewrite.txt`
- [ ] 前后端统一“跳过 / 回退 / 成功”状态文案，避免 UI 说已优化、后端实际只做了启发式清洗。

**验证命令：**

```powershell
pnpm --filter @vidgnost/api exec vitest run test/summary-service.test.ts test/tasks-write.test.ts
pnpm --filter @vidgnost/api exec vitest run test/config.test.ts
```

**完成标准：**

- `off/strict/rewrite` 三种模式在运行结果、产物和状态机上都有可观测差异
- `batch_size` / `overlap` 被真实消费
- UI 与任务产物都能分辨“成功纠错”和“已回退原文”

### Task 3: 升级 VQA 为真实检索链而非启发式占位

**Files:**
- Create: `apps/api/src/modules/vqa/retrieval-index-service.ts`
- Create: `apps/api/src/modules/vqa/embedding-runtime-service.ts`
- Create: `apps/api/src/modules/vqa/rerank-runtime-service.ts`
- Modify: `apps/api/src/modules/vqa/vqa-runtime-service.ts`
- Modify: `apps/api/src/modules/tasks/task-orchestrator.ts`
- Modify: `apps/api/test/vqa.test.ts`
- Test: `apps/api/test/retrieval-index-service.test.ts`

- [ ] 将当前 `hybrid-heuristic` 方案降级为 fallback 路径，不再作为主实现。
- [ ] 落地真正的检索主链：
  - 文本切片与窗口化
  - embedding 生成与持久化
  - top-k 初检索
  - rerank
  - answer generation
- [ ] 把检索索引的准备前移到任务完成阶段，形成真正可复用的 `vqa-prewarm` 产物，而不是在 spec 中承诺、代码中缺失。
- [ ] 让 `rerank_top_n` 真正决定默认返回候选数，不只影响 UI 表单。
- [ ] 保留当前启发式检索作为兜底，但 trace 中必须明确 `retrieval_mode=heuristic_fallback`。
- [ ] 新增检索质量基线测试，至少覆盖：
  - top-k 命中
  - MRR
  - 无命中时的降级输出

**验证命令：**

```powershell
pnpm --filter @vidgnost/api exec vitest run test/vqa.test.ts test/retrieval-index-service.test.ts
pnpm --filter @vidgnost/api exec vitest run test/tasks-write.test.ts
```

**完成标准：**

- 默认 VQA 路径不再依赖 `scoreDense/scoreSparse` 作为主检索
- 存在可持久化的检索准备产物
- trace 可区分真实检索链和启发式回退链

### Task 4: 实现或收缩 Ollama 托管能力，禁止继续半悬空

**Files:**
- Create: `apps/api/src/modules/models/ollama-process-supervisor.ts`
- Modify: `apps/api/src/modules/models/ollama-service-manager.ts`
- Modify: `apps/api/src/modules/models/local-model-migration-service.ts`
- Modify: `apps/api/src/modules/models/model-catalog-repository.ts`
- Modify: `apps/api/src/routes/config.ts`
- Modify: `apps/api/test/config.test.ts`
- Test: `apps/api/test/ollama-service-manager.test.ts`

- [ ] 对 Ollama 能力作出明确产品决策：
  - 方案 A：实现真正的托管能力
  - 方案 B：明确降级为“仅配置 + 探测 + 外部提示”
- [ ] 若选择方案 A，必须补齐：
  - 本地进程探测
  - 自主启动/停止/重启
  - 端口释放等待
  - `OLLAMA_MODELS` 生效校验
  - 模型目录迁移执行
  - 防止危险路径迁移
  - `/api/tags` 与本地文件状态双向核验
- [ ] 若选择方案 B，必须同步移除以下误导性能力描述：
  - 自动重启可用
  - 模型拉取托管可用
  - 自动迁移已实现
- [ ] 无论选 A 还是 B，`config.ts` 的返回消息必须和真实行为一致，不再出现“按钮可点但实际上只返回失败文案”的假交互。

**验证命令：**

```powershell
pnpm --filter @vidgnost/api exec vitest run test/config.test.ts test/ollama-service-manager.test.ts
pnpm --filter @vidgnost/api exec vitest run test/self-check.test.ts
```

**完成标准：**

- 设置中心关于 Ollama 的动作和后端真实能力完全一致
- 不再存在 `process_detected=false`、`can_self_restart=false` 却仍在 spec 中宣称已托管的情况

### Task 5: 把自检从“存在性检查”升级为“真实性检查”

**Files:**
- Create: `apps/api/src/modules/runtime/llm-readiness-service.ts`
- Modify: `apps/api/src/modules/runtime/self-check-service.ts`
- Modify: `apps/api/src/modules/llm/openai-compatible-client.ts`
- Modify: `apps/api/src/modules/runtime/whisper-runtime-status-service.ts`
- Modify: `apps/api/test/self-check.test.ts`
- Modify: `apps/api/test/runtime.test.ts`

- [ ] 新增 LLM 真实探测：
  - 请求 `/models`
  - 校验返回结构
  - 校验配置模型名存在
  - 区分“接口可达但模型不存在”和“接口不可达”
- [ ] 让 embedding/vlm/rerank/mllm 自检复用同一套远程就绪性探测逻辑，而不是只看配置项是否为空。
- [ ] 将“ChromaDB”类检查改造成真实索引运行态检查；如果当前项目实际上没有 Chroma 实例，就把文案改为“检索索引目录/索引运行时”，不要继续误导。
- [ ] 自检报告中增加 `check_depth` 或同类字段，区分：
  - config_only
  - reachability
  - model_verified
  - runtime_ready

**验证命令：**

```powershell
pnpm --filter @vidgnost/api exec vitest run test/self-check.test.ts test/runtime.test.ts
pnpm --filter @vidgnost/api exec vitest run test/config.test.ts
```

**完成标准：**

- LLM 自检不再只是“API Key 已配置”
- 向量索引/检索运行时自检不再只是“目录存在”
- 自检结果能明确告诉用户“可用到什么深度”

## 5. P1 执行任务

### Task 6: 建立 ASR 长音频鲁棒性基线并补强 whisper.cpp 路径

**Files:**
- Create: `apps/api/src/modules/asr/whisper-cli-runner.ts`
- Create: `apps/api/src/modules/asr/transcript-segment-normalizer.ts`
- Modify: `apps/api/src/modules/asr/asr-service.ts`
- Modify: `apps/api/test/asr-service.test.ts`
- Modify: `docs/openspec/specs/transcription-pipeline/spec.md`

- [ ] 抽离 `whisper.cpp` CLI 调用器，避免 `asr-service.ts` 同时承担模型解析、命令调用、SRT 解析和错误处理。
- [ ] 为本地 `whisper.cpp` 路径建立长音频验证基线，至少覆盖：
  - 30 至 60 分钟中文视频
  - 长音频时间戳连续性
  - 分段缺失或空段处理
  - 中文标点与空格修复
- [ ] 明确 CPU 跑通和 GPU 优化的优先级，文档中不要再混写为“已支持全部加速能力”。
- [ ] 为远程 ASR 路径补齐错误分类：
  - 上传失败
  - 模型不支持
  - 返回空 segments
  - 时间戳格式异常

**验证命令：**

```powershell
pnpm --filter @vidgnost/api exec vitest run test/asr-service.test.ts
pnpm --filter @vidgnost/api exec vitest run test/tasks-write.test.ts
```

**完成标准：**

- 本地和远程 ASR 路径都能输出结构稳定的 segments
- 长音频验证结果被记录到文档，而不是仅停留在口头预期

### Task 7: 把摘要/笔记/导图回退链从“黑盒降级”改成“可解释降级”

**Files:**
- Create: `apps/api/src/modules/summary/fallback-artifact-service.ts`
- Modify: `apps/api/src/modules/summary/summary-service.ts`
- Modify: `apps/api/src/modules/tasks/task-orchestrator.ts`
- Modify: `apps/api/test/summary-service.test.ts`
- Modify: `apps/api/test/tasks-write.test.ts`

- [ ] 将 notes、mindmap、summary 的回退逻辑集中管理，避免散落在同一服务内部。
- [ ] 为每个生成物写入来源信息：
  - `generated_by=llm`
  - `generated_by=fallback`
  - `fallback_reason`
- [ ] UI 若显示产物成功，也必须能显示“本次为回退结果”，不能把启发式结果伪装成 LLM 正常结果。
- [ ] 回退策略保持最小可用，不引入过度复杂的本地摘要算法。

**验证命令：**

```powershell
pnpm --filter @vidgnost/api exec vitest run test/summary-service.test.ts test/tasks-write.test.ts
```

**完成标准：**

- 所有 D 阶段产物都能追踪生成来源
- 回退不再是静默发生

### Task 8: 将重 CPU 的后处理迁出主事件循环

**Files:**
- Modify: `apps/api/src/modules/tasks/task-orchestrator.ts`
- Modify: `apps/api/src/modules/vqa/vqa-runtime-service.ts`
- Modify: `apps/api/src/modules/summary/transcript-correction-service.ts`
- Modify: `apps/api/src/modules/vqa/retrieval-index-service.ts`
- Modify: `apps/api/test/runtime.test.ts`

- [ ] 识别主进程中真正重 CPU 的部分：
  - 大段 transcript 清洗与重排
  - embedding 索引准备
  - rerank 前批处理
  - 大型 trace 序列化
- [ ] 优先把这些逻辑迁到 `worker_threads` 或独立任务执行器；`whisper-cli` 本身作为外部进程保留，不重复包装成无意义 worker。
- [ ] 为长任务增加取消与超时传播，避免主线程堆积等待态 Promise。
- [ ] 增加性能对比基线：相同任务下的 CPU、内存、耗时。

**验证命令：**

```powershell
pnpm --filter @vidgnost/api exec vitest run test/runtime.test.ts test/tasks-write.test.ts
pnpm build
```

**完成标准：**

- 主线程在长任务期间不被大块同步后处理阻塞
- 有明确的迁移前后性能对比结果

## 6. P2 执行任务

### Task 9: 落实 Spec-first 流程，而不是只保留提交门禁

**Files:**
- Modify: `docs/openspec/README.md`
- Modify: `AGENTS.md`
- Modify: `docs/git-commit-convention.md`
- Modify: `scripts/check-spec-sync.mjs`
- Modify: `scripts/check-openspec.mjs`

- [ ] 在文档中明确区分三种状态：
  - `planned`
  - `partial`
  - `implemented`
- [ ] 让 `tasks.md` 的完成条件依赖验收证据，而不是人工主观打勾。
- [ ] 为 `check-spec-sync.mjs` 增加最小一致性约束：
  - 当代码修改命中关键能力模块时，要求同步触达对应 spec 目录
  - 当 `tasks.md` 把某项改为完成时，要求至少同步测试或实现文件
- [ ] 为 `check-openspec.mjs` 增加轻量语义检查，至少检查：
  - `tasks.md` 中的完成项是否存在明显的“当前代码明确返回未实现”矛盾词
  - spec 中是否存在连续多处“已完成”但缺少对应实现文件或测试命中
- [ ] 在 `docs/openspec/README.md` 中明确项目流程：
  - 中大型功能先写/改 spec
  - 再实现
  - 再跑测试和验收
  - 最后同步 tasks 状态

**验证命令：**

```powershell
node scripts/check-openspec.mjs
node scripts/check-spec-sync.mjs
```

**完成标准：**

- OpenSpec 不再只是“提交时顺手补一下”
- 任务完成状态与代码现实的错配明显减少

### Task 10: 做一次全链路回归与文档收口

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/current-tech-stack.zh-CN.md`
- Modify: `docs/backend-api-and-ops-baseline.zh-CN.md`
- Modify: `docs/frontend-driven-backend-execution-checklist.zh-CN.md`
- Modify: `docs/openspec/**`

- [ ] 根据最终落地结果，回写真实技术栈、真实能力矩阵和真实限制项。
- [ ] 为每个 P0 能力补齐“用户可见的当前行为说明”，避免用户继续通过 UI 猜测支持深度。
- [ ] 输出最终回归清单，至少覆盖：
  - 创建任务
  - 转写
  - 纠错
  - 笔记与导图
  - VQA
  - 模型配置
  - 自检
  - 历史记录
  - 导出
- [ ] 在最终文档中明确写出哪些能力仍是降级模式，避免下一轮再重复审计。

**验证命令：**

```powershell
pnpm typecheck
pnpm test
pnpm build
node scripts/check-openspec.mjs
git status --short
```

**完成标准：**

- 代码、测试、README、技术栈文档、OpenSpec 五层对齐
- 用户和后续开发者都能从文档直接判断当前系统真实能力边界

## 7. 推荐执行顺序

1. 先做 Task 1，停止继续扩大“文档比代码先进”的偏差。
2. 再做 Task 2、Task 3、Task 4、Task 5，这四项属于当前 P0。
3. P0 收口后，再做 ASR、性能稳定性和 Spec-first 治理。
4. 最后做全链路回归与文档统一收口。

## 8. 里程碑验收

### Milestone A: 文档与代码现实对齐

- [ ] `tasks.md` 中不存在明显假完成项
- [ ] OpenSpec 对同一能力的描述与后端行为一致
- [ ] README 与设置中心能力说明一致

### Milestone B: 核心能力补齐

- [ ] 文本纠错三模式可区分、可测试、可回退
- [ ] VQA 默认主链不再是启发式占位
- [ ] Ollama 管理能力要么真实可用，要么明确降级
- [ ] LLM 自检包含真实探测

### Milestone C: 稳定性与治理闭环

- [ ] 长任务 CPU/内存占用得到控制
- [ ] 关键长路径具备回归测试
- [ ] OpenSpec 成为开发输入之一，而不只是交付后的补录材料

## 9. 最终验收标准

本清单完成时，应同时满足以下条件：

- 当前 TS 全栈版本不再依赖“文档承诺”掩盖功能缺口。
- `off/strict/rewrite` 纠错模式在代码、产物、UI 和测试中一致。
- VQA 具备真实检索主链，启发式检索仅作为回退。
- Ollama、模型下载、模型迁移和自检能力的文案与行为一致。
- OpenSpec、README、技术栈文档与实现状态同步。
- 以下命令全部通过：

```powershell
pnpm typecheck
pnpm test
pnpm build
node scripts/check-openspec.mjs
```
