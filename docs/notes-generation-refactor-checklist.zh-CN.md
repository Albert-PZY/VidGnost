# 笔记生成链路优化改造清单

## 1. 文档目的

本清单用于指导 VidGnost 的“详细笔记”生成链路改造，目标是解决以下问题：

1. `notes_markdown` 顶部重复插入标题，正文内又自带标题，造成展示冗余。
2. 当前“详细笔记”本质上只是 `summary_markdown` 的套壳版本，信息量不足。
3. 长文本场景下存在上下文压缩、窗口采样、摘要聚合等有损处理，容易丢失细节。
4. 当前默认运行配置使用 `rewrite` 转写改写模式，会在进入笔记生成前先做一轮风格性压缩。
5. 详细笔记缺少“覆盖率校验”和“遗漏补全”步骤，导致部分概念、例子、限定条件、注意事项被跳过。

本文档不直接修改代码，而是提供一份可按阶段执行、可验证、可拆分提交的实施清单。

---

## 2. 现状定位

### 2.1 关键问题位置

1. `backend/app/services/summarizer.py`
   - `generate(...)`
   - `_build_summary_context(...)`
   - `_compress_context_to_limit(...)`
   - `_compose_notes(...)`
2. `backend/app/services/prompt_constants.py`
   - `SUMMARY_PROMPT`
   - `REWRITE_TRANSCRIPT_PROMPT`
3. `backend/app/services/prompt_template_store.py`
   - 当前只支持 `summary` / `mindmap` 两类模板
4. `backend/app/schemas.py`
   - `PromptTemplateChannel`
   - `PromptTemplateBundleResponse`
5. `backend/app/services/task_runner.py`
   - Stage D 结果兜底逻辑
   - `notes_markdown` 结构判定与 fallback
6. `frontend/src/types.ts`
   - PromptTemplateChannel 类型定义
7. `frontend/src/hooks/use-prompt-template-manager.ts`
   - 提示词模板管理逻辑
8. `frontend/src/components/prompt-templates-tab.tsx`
   - 运行配置中心模板面板
9. `frontend/src/App.tsx`
   - 当前详情页直接优先显示 `notes_markdown ?? summary_markdown`

### 2.2 当前链路的实际行为

#### A. 详细笔记不是独立生成

当前链路：

1. 先生成 `summary_markdown`
2. 再调用 `_compose_notes(title, summary)` 包一层标题
3. 结果写入 `notes_markdown`

这意味着：

1. `notes_markdown` 和 `summary_markdown` 的信息源相同
2. 只要 `summary_markdown` 不够细，`notes_markdown` 必然不够细
3. 一旦 `summary_markdown` 自带 H1 标题，就会出现重复标题

#### B. 长文本不是“分段生成详细笔记”，而是“分段摘要后再统一成文”

当前 `_build_summary_context(...)` 的实际链路：

1. 按字符窗切分文本
2. 每个窗口先做一次摘要
3. 多个窗口摘要再做聚合摘要
4. 仍超限时继续压缩
5. 最终只把压缩后的 `summary_context` 交给最终笔记/思维导图生成

这属于典型的多轮有损压缩。

#### C. 超长场景存在窗口采样

当窗口数量超过 `_SUMMARY_WINDOW_LIMIT` 时，`_build_text_windows(...)` 会采样保留最多 16 个窗口，而不是全量处理所有窗口。

这意味着：

1. 部分原始内容根本不会进入后续阶段
2. 这类遗漏后续无法补回

#### D. 当前默认配置会先做转写改写

`backend/storage/model_config.json` 当前为：

```json
{
  "correction_mode": "rewrite"
}
```

这一步虽然不是摘要，但会：

1. 去口语化
2. 合并重复表达
3. 将转写整理为更像正文的形式

副作用是：原始重复强调、铺垫信息、局部例子、限定语句更容易被提前压缩。

---

## 3. 改造目标

### 3.1 功能目标

1. `notes_markdown` 必须是独立生成产物，不能再直接复用 `summary_markdown`。
2. `notes_markdown` 不再强制额外包一层顶级标题。
3. 长文本场景必须改为“高召回提取 + 按章节生成 + 覆盖率补全”，而不是“多轮摘要压缩后统一生成”。
4. 默认模式优先保障信息保留，而不是默认做 `rewrite` 风格压缩。
5. 提示词模板层面应允许“总结模板”和“详细笔记模板”分离管理。

### 3.2 质量目标

1. 笔记应覆盖视频中的核心概念、步骤、案例、对比、术语、注意事项。
2. 长视频场景下，笔记不得因窗口采样而遗漏完整章节。
3. 笔记标题层级应自然，不出现双 H1。
4. 同一任务下，`notes_markdown` 的信息密度和篇幅应显著高于 `summary_markdown`。

### 3.3 约束目标

1. 不引入新的本地模型依赖。
2. 保持现有任务接口、导出能力和历史记录兼容。
3. 优先复用现有 Stage D 产物持久化能力。

---

## 4. 目标架构

### 4.1 新的 Stage D 链路

建议将当前 Stage D 的“详细笔记与思维导图生成”拆成如下子阶段：

1. `transcript_optimize`
   - 保留，但默认从 `rewrite` 调整为 `strict`
2. `notes_extract`
   - 将原始转写按块处理，提取高保真的信息卡片
3. `notes_outline`
   - 汇总所有信息卡片，生成全局提纲
4. `notes_sections`
   - 按章节分别生成详细笔记正文
5. `notes_coverage`
   - 对照信息卡片检查遗漏，并补全正文
6. `summary_delivery`
   - 基于全局提纲或最终笔记生成简版总结
7. `mindmap_delivery`
   - 基于提纲或最终笔记生成思维导图

### 4.2 数据流原则

新的详细笔记链路遵循以下原则：

1. 先保留信息，再做结构化表达。
2. 中间产物以“信息卡片”形式存储，不直接压成短摘要。
3. 长文本使用“分治生成”而不是“单次大上下文硬塞”。
4. 最终成文前要做覆盖率补全，降低遗漏风险。

---

## 5. 分阶段执行清单

## Phase 0：快速修复

### 目标

先修掉明显错误和低收益问题，为后续重构减负。

### 执行项

- [ ] 删除 `backend/app/services/summarizer.py` 中 `_compose_notes(...)` 对 `notes_markdown` 的额外标题包装。
- [ ] 让 `generate(...)` 直接返回独立的 `notes_markdown` 内容，不再由 `summary_markdown` 组装。
- [ ] 调整 `backend/app/services/task_runner.py` 中 `_build_fallback_notes_markdown(...)`，避免兜底逻辑继续制造重复标题。
- [ ] 增加“若正文首行已是 H1，则不再补 H1”的通用工具函数，供 fallback 或后处理复用。

### 验收标准

1. 任意任务生成的 `notes_markdown` 顶部只有一个 H1。
2. 前端详情页显示的详细笔记不再出现“文件名标题 + 正文标题”双重重复。

### 测试项

- [ ] 新增后端单测：输入一个自带 H1 的 notes 内容，不再重复包 H1。
- [ ] 新增后端单测：空 notes fallback 时也只生成单个 H1。

---

## Phase 1：笔记与总结职责拆分

### 目标

让“详细笔记”和“总结”在模型职责、提示词和输出目标上彻底分离。

### 执行项

- [ ] 在 `backend/app/services/prompt_constants.py` 中新增 `NOTES_PROMPT`，不要复用 `SUMMARY_PROMPT`。
- [ ] 新增一套专门用于详细笔记的提示词约束，明确要求保留：
  - 定义
  - 步骤
  - 案例
  - 对比
  - 限定条件
  - 注意事项
  - 术语解释
- [ ] 在 `backend/app/services/prompt_template_store.py` 中新增 `notes` 模板通道。
- [ ] 扩展 `backend/app/schemas.py` 中的 `PromptTemplateChannel`：
  - 从 `Literal["summary", "mindmap"]`
  - 扩展为 `Literal["summary", "notes", "mindmap"]`
- [ ] 扩展 `PromptTemplateBundleResponse`，加入：
  - `notes_templates`
  - `selected_notes_template_id`
- [ ] 更新 `backend/app/api/routes_config.py` 对模板读取、创建、编辑、切换的接口处理。
- [ ] 更新前端类型与模板管理逻辑：
  - `frontend/src/types.ts`
  - `frontend/src/hooks/use-prompt-template-manager.ts`
  - `frontend/src/components/prompt-templates-tab.tsx`
- [ ] 在前端模板面板中新增“详细笔记模板”标签页。

### 验收标准

1. 运行配置中心可单独选择“详细笔记模板”。
2. 切换 notes 模板不会影响 summary 和 mindmap 模板。
3. `notes_markdown` 的生成逻辑不再依赖 `summary_markdown`。

### 测试项

- [ ] 后端单测：模板存储读取 `notes` 通道正常。
- [ ] 后端单测：默认模板回填包含 `notes`。
- [ ] 前端交互测试：切换 notes 模板后，选中态与保存逻辑正常。

---

## Phase 2：替换长文本压缩逻辑

### 目标

让详细笔记链路摆脱“窗口摘要 -> 聚合摘要 -> 压缩”的多轮有损流程。

### 执行项

- [ ] 在 `backend/app/services/summarizer.py` 中保留现有 `_build_summary_context(...)` 仅服务于 `summary_markdown`。
- [ ] 新增独立的详细笔记上下文构建链路，例如：
  - `_build_notes_evidence_cards(...)`
  - `_build_notes_outline(...)`
  - `_build_notes_sections(...)`
  - `_apply_notes_coverage_patch(...)`
- [ ] 不再让 `notes_markdown` 走 `_build_summary_context(...)`。
- [ ] 对详细笔记链路禁用窗口采样：
  - 不复用 `_build_text_windows(... max_windows=16)` 的采样行为
  - 所有块都必须进入提取阶段
- [ ] 优先基于分段转写 `segments` 或时间块做分块，而不是单纯按字符截断。
- [ ] 为每个分块输出结构化“信息卡片”而不是短摘要，建议字段：
  - `chunk_index`
  - `time_range`
  - `core_points`
  - `definitions`
  - `steps`
  - `examples`
  - `comparisons`
  - `constraints`
  - `caveats`
  - `terms`
  - `open_loops`
- [ ] 将每个块的信息卡片持久化到 Stage D 产物目录，便于追踪与调试。

### 建议新增产物

在 `backend/app/services/task_artifact_persistence_service.py` 基础上新增：

1. `D/notes-extract/index.json`
2. `D/notes-extract/chunks/chunk-xxxx.json`
3. `D/notes-outline/outline.json`
4. `D/notes-sections/section-xx.md`
5. `D/notes-coverage/report.json`

### 验收标准

1. 长文本详细笔记链路不再调用 `_build_summary_context(...)`。
2. 超长文本不会因为 `max_windows=16` 被采样丢块。
3. 每个分块都有可检查的信息卡片产物。

### 测试项

- [ ] 后端单测：超 16 窗口时，详细笔记链路仍会处理全部块。
- [ ] 后端单测：信息卡片 JSON 结构合法。
- [ ] 后端单测：块顺序、时间范围、序号连续。

---

## Phase 3：按章节生成详细笔记

### 目标

避免一次请求把全部细节和全部输出都压在同一个上下文内，改为“提纲先行，章节分治”。

### 执行项

- [ ] 基于全部信息卡片生成全局大纲，输出章节树结构。
- [ ] 将大纲控制在可渲染、可理解的层级，一般为：
  - 一级主题
  - 二级章节
  - 三级要点
- [ ] 为每个章节单独调用 LLM 生成详细正文，输入应包含：
  - 当前章节标题
  - 当前章节对应的信息卡片
  - 全局大纲摘要
  - 已完成章节的必要上下文
- [ ] 每个章节输出应保留：
  - 关键定义
  - 论证过程
  - 示例
  - 易混点
  - 注意事项
- [ ] 最终按章节顺序拼接为 `notes_markdown`。

### 推荐实现细节

1. 为章节正文生成新增专门 prompt，例如：
   - `NOTES_OUTLINE_PROMPT`
   - `NOTES_SECTION_PROMPT`
2. 将“章节生成”与“总结生成”并行前先完成 `notes_outline`
3. `summary_markdown` 可基于 `notes_outline` 或最终 `notes_markdown` 再做简化生成

### 验收标准

1. `notes_markdown` 的章节结构稳定。
2. 详细笔记长度明显高于总结。
3. 长视频场景下，每个主要主题均有独立章节，不出现整段内容被吞并为一节。

### 测试项

- [ ] 后端单测：章节生成顺序正确。
- [ ] 后端单测：章节拼接后 Markdown 结构合法。
- [ ] 回归测试：导出 `notes.md` 不受影响。

---

## Phase 4：覆盖率校验与补全

### 目标

降低“LLM 认为不重要就跳过”的遗漏风险，让详细笔记具备可追溯的补全机制。

### 执行项

- [ ] 新增覆盖率检查步骤，对照“信息卡片全集”和“最终笔记正文”。
- [ ] 覆盖率检查至少识别以下遗漏类型：
  - 核心定义未覆盖
  - 流程步骤缺失
  - 案例/示例丢失
  - 对比关系未写出
  - 限定条件未写出
  - 注意事项未写出
- [ ] 生成 `coverage_report`，标出：
  - 已覆盖项
  - 疑似遗漏项
  - 建议补写位置
- [ ] 对疑似遗漏项进行一次补写，尽量补到对应章节，而不是统一堆到文末。
- [ ] 为“补全前”和“补全后”分别持久化产物，便于对比。

### 验收标准

1. 任意长文本任务都能产出覆盖率报告。
2. 笔记补全后，遗漏率显著下降。
3. 补全内容不会破坏原有章节结构。

### 测试项

- [ ] 后端单测：覆盖率报告能识别缺失定义与缺失步骤。
- [ ] 后端单测：补全逻辑写回到目标章节，不是全量重写。

---

## Phase 5：默认运行配置调整

### 目标

让默认行为更符合“信息保留优先”的目标。

### 执行项

- [ ] 将 `backend/storage/model_config.json` 中默认 `correction_mode` 从 `rewrite` 调整为 `strict`。
- [ ] 检查 `backend/app/config.py` 中默认值，保持与运行时配置一致。
- [ ] 若前端提供“转写优化策略”展示，明确标注：
  - `strict`：最小纠错，保留信息
  - `rewrite`：偏书面整理，可能更容易压缩细节
- [ ] 审查 `task_runner.py` 中所有使用 `summary_input_text` 的路径，确保 detailed notes 走的是高保真输入源。

### 验收标准

1. 新建任务默认使用 `strict`。
2. 切到 `rewrite` 时，仍不影响新 detailed notes 链路的主信息保留策略。

### 测试项

- [ ] 后端单测：默认配置读取为 `strict`。
- [ ] 回归测试：旧配置文件仍可正常读取。

---

## Phase 6：前端展示与可观测性

### 目标

让用户能看见详细笔记链路的阶段信息，并能理解“为什么内容更完整”。

### 执行项

- [ ] 前端 Stage D 日志面板增加新的子阶段展示：
  - `notes_extract`
  - `notes_outline`
  - `notes_sections`
  - `notes_coverage`
- [ ] 如果后端已持久化章节草稿和覆盖率报告，前端可在调试模式下预览。
- [ ] 在最终详情页中继续以 `notes_markdown` 为主展示，但不要再混用 `summary_markdown` 伪装为 notes。
- [ ] 如有需要，增加“详细笔记字数 / 总结字数 / 覆盖率检查状态”这类只读指标。

### 验收标准

1. 用户能从前端看出详细笔记经过了哪些阶段。
2. 出现遗漏时，能通过日志或中间产物定位是提取、提纲、章节生成还是补全的问题。

---

## 6. 推荐提交拆分

为避免混杂提交，建议按以下顺序拆分 commit：

1. `fix(backend): remove duplicate notes title wrapper`
2. `feat(runtime): separate notes generation from summary pipeline`
3. `feat(backend): add notes prompt channel and storage`
4. `refactor(backend): replace notes context compression with evidence cards`
5. `feat(backend): generate notes by outline and sections`
6. `feat(backend): add notes coverage validation and patching`
7. `feat(frontend): support notes prompt template management`
8. `docs(docs): document notes generation refactor architecture`

---

## 7. 实施优先级

### P0：必须先做

- [ ] 移除 notes 重复标题
- [ ] notes 独立生成
- [ ] 默认 `correction_mode` 调整为 `strict`

### P1：本轮重构核心

- [ ] notes 专属 prompt 通道
- [ ] 信息卡片提取链路
- [ ] 章节化生成

### P2：质量增强

- [ ] 覆盖率检查与补全
- [ ] 前端阶段可观测性

---

## 8. 完成判定标准

当以下条件全部满足时，视为本次重构完成：

1. `notes_markdown` 不再由 `summary_markdown` 套壳生成。
2. `notes_markdown` 不再出现双 H1 标题。
3. 详细笔记链路不再依赖 `_build_summary_context(...)` 的多轮摘要压缩。
4. 超长文本详细笔记不会因窗口采样丢失整段内容。
5. 运行配置中心可独立管理 notes 模板。
6. 长视频任务能生成结构清晰、覆盖充分的详细笔记。
7. 后端与前端测试全部通过。

---

## 9. 不建议的做法

以下方案不建议作为主方案：

1. 仅仅把 `max_tokens` 调大，不改链路。
2. 仅仅把 `_MAX_DIRECT_TRANSCRIPT_CHARS` 调大，不改链路。
3. 继续让 `notes_markdown = summary_markdown`。
4. 继续依赖窗口摘要聚合来生成“详细笔记”。

原因：

1. 只能缓解，不会根治遗漏问题。
2. 上下文变大不等于覆盖率变高。
3. 详细笔记和总结职责冲突会持续存在。

---

## 10. 建议落地顺序

建议按下面顺序推进，实现风险最低：

1. 修掉重复标题和 notes 套壳
2. 切出 notes 独立 prompt 通道
3. 将 detailed notes 从摘要压缩链路中剥离
4. 上线“信息卡片 -> 提纲 -> 章节生成”主流程
5. 最后补“覆盖率校验与补写”

按此顺序推进，每一步都能形成可验证成果，也便于回归与拆分提交。
