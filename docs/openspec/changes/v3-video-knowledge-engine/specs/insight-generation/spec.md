## ADDED Requirements

### Requirement: System SHALL segment transcripts into semantic paragraphs deterministically
Status: `implemented`

系统 SHALL 在不依赖模型的前提下，按「停顿长度 + token 预算 + 句末标点」把转写句归并成
`TranscriptParagraph`，并保证段落 ID 稳定、时间范围单调。

#### Scenario: Long pause forces a boundary
- **WHEN** 相邻句之间停顿不小于 1.1 秒
- **THEN** 前一句所在段落被关闭，新段落从后一句开始

#### Scenario: Token budget exceeded
- **WHEN** 追加下一句会超过段落 token 上限
- **THEN** 先关闭当前段落再追加

#### Scenario: Tiny trailing paragraph
- **WHEN** 某段落 token 数低于最小阈值且上一段仍有余量
- **THEN** 该段落被合并进上一段，不产生碎片段落

### Requirement: System SHALL cut chapters using duration-aware granularity
Status: `implemented`

章节切分 SHALL 由模型按「视频时长推导出的目标章节数」执行，
并把章节起点绑定到真实存在的段落 ID。

#### Scenario: Target chapter count derived from duration
- **WHEN** 视频时长为 7 分钟且分段数量充足
- **THEN** 目标章节数约为 6 章（时长推导值与段落数量推导值取较大者），并通过提示词约束到该量级

#### Scenario: Model returns an invalid paragraph id
- **WHEN** 章节的 `startParagraphId` 不在该窗口的段落集合中
- **THEN** 该章节被丢弃，不影响其余章节

#### Scenario: Overlapping windows produce duplicates
- **WHEN** 相邻窗口对同一段落起始位置给出章节
- **THEN** 只保留要点更完整的一条

#### Scenario: Model unavailable
- **WHEN** 所有窗口的模型调用都失败
- **THEN** 系统按固定段落数切出兜底章节，并把 `generatedBy` 标记为 `fallback-timeout-chunks`

### Requirement: System SHALL generate chapter-level notes with time anchors
Status: `implemented`

系统 SHALL 为每个章节产出一组带 `start` 秒数的要点，并写入 `chapter-notes.json` 供摘要、导图、
知识图谱、问答与导出复用（同一份数据只生成一次）。

#### Scenario: Chapter map succeeds
- **WHEN** 章节要点生成成功
- **THEN** 每个要点的 `start` 落在该章节的时间范围内，且文本长度大于 4 个字符

#### Scenario: Chapter map fails for one chapter
- **WHEN** 单个章节的模型调用失败
- **THEN** 该章节回退到章节 bullets，其余章节不受影响

### Requirement: System SHALL produce a global summary via map-reduce
Status: `implemented`

全局摘要 SHALL 由「章节要点 map + 全局 reduce」两段式生成，输出
`tldr`、`highlights`、`actions`、`questions`、`glossary`、`tags`、`audience`。

#### Scenario: Deep preset uses the reasoning role
- **WHEN** 任务预设为 `deep`
- **THEN** reduce 阶段使用 `llm.reasoning` 角色；`fast` / `balanced` 使用 `llm.quality` 或 `llm.bulk`

#### Scenario: Model returns an empty highlights array
- **WHEN** reduce 结果的 `highlights` 为空
- **THEN** 系统按章节顺序从章节要点中确定性补齐至多 9 条，并把 `generatedBy` 追加 `+chapter-notes-fallback`

#### Scenario: Glossary key naming varies
- **WHEN** 模型用 `definition` / `meaning` / `description` 等键名描述解释
- **THEN** 解析层归一化成 `{term, explanation}`，不丢失词条

#### Scenario: Duration is available
- **WHEN** 生成 highlights
- **THEN** 每条尽量携带 `start`（秒）以便前端跳转

### Requirement: System SHALL generate a mind map as both a tree and Mermaid source
Status: `implemented`

导图 SHALL 输出 `MindNode` 树（深度不超过 3）与可直接渲染的 Mermaid `mindmap` 源码，
并在模型不可用时由章节结构确定性生成。

#### Scenario: Model output is usable
- **WHEN** 模型返回的根节点至少有两个子节点
- **THEN** 使用模型结果，`generatedBy` 为 `llm.balanced`

#### Scenario: Model output is unusable
- **WHEN** 模型失败或根节点子节点少于 2 个
- **THEN** 用章节与章节要点构造确定性导图，`generatedBy` 为 `deterministic-from-outline`

#### Scenario: Mermaid label sanitisation
- **WHEN** 节点标签包含括号、引号或反引号
- **THEN** 生成 Mermaid 源码前剥离这些字符，避免语法错误

### Requirement: System SHALL extract a lightweight knowledge graph
Status: `implemented`

系统 SHALL 抽取实体（`concept/person/tool/organization/method/metric/artifact`）与实体关系，
实体节点携带首次出现时间与所属章节，跨窗口按标签合并并累计提及次数。

#### Scenario: Entity repeats across windows
- **WHEN** 同一实体在多个窗口出现
- **THEN** 合并成一个节点，`mention` 累加、`weight` 提升、`chapterIds` 去重追加

#### Scenario: Relation references unknown entity
- **WHEN** 关系的一端不在已抽出实体中
- **THEN** 该关系被丢弃，不产生悬空边

#### Scenario: No paragraphs
- **WHEN** 任务没有段落产物
- **THEN** 返回空图谱并标记 `generatedBy=none`

### Requirement: System SHALL offer optional proofreading with a divergence guard
Status: `implemented`

纠错 SHALL 只修正同音错字、专有名词写法与英文术语大小写，并通过长度比例与编辑距离校验
阻止模型改写原文。

#### Scenario: Correction within tolerance
- **WHEN** 修正后文本长度比在 0.8-1.25 之间且归一化编辑距离小于 0.28
- **THEN** 采用修正文本并标记 `corrected=true`

#### Scenario: Correction looks like a rewrite
- **WHEN** 修正文本超过长度或距离阈值
- **THEN** 丢弃该结果，保留原始转写

### Requirement: System SHALL translate paragraphs in batches when configured
Status: `implemented`

当任务设置 `translateTo` 时，系统 SHALL 使用 `qwen-mt-uni` 按批翻译段落，
输出 `TranslationDoc`；翻译失败不阻塞任务成功。

#### Scenario: Translation succeeds
- **WHEN** 设置了目标语言且翻译服务可用
- **THEN** 写入 `translation.json`，段落数量与输入一致

#### Scenario: Translation fails
- **WHEN** 翻译调用抛错
- **THEN** 记录一条 warn 日志，`finalize` 阶段仍然成功
