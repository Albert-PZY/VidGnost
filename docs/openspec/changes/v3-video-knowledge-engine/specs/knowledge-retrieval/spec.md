## ADDED Requirements

### Requirement: System SHALL chunk transcript by chapter boundaries
Status: `implemented`

切块 SHALL 以章节为硬边界，章节内按目标 320 token 切分，并回带最多 2 个段落作为重叠前缀。

#### Scenario: Chapters never mix inside one chunk
- **WHEN** 章节结构已生成
- **THEN** 任意切块的段落集合完全属于同一章节，且块继承 `chapterId` 与 `chapterTitle`

#### Scenario: Paragraph larger than the overlap budget
- **WHEN** 单个段落 token 数超过重叠预算
- **THEN** 至少回带 1 个段落，重叠不退化到不存在

#### Scenario: No chapters available
- **WHEN** 章节列表为空
- **THEN** 返回空切块列表，索引阶段报 `INDEX_NO_CHUNKS`

### Requirement: System SHALL build a contextual prefix and question variants per chunk
Status: `implemented`

系统 SHALL 为每个切块生成 50-80 token 的定位前缀与至多 3 个问题变体，
前缀与问题共同参与 embedding 与 BM25 索引。

#### Scenario: Context generation succeeds
- **WHEN** 模型返回合法的 `items` 数组
- **THEN** 对应切块的 `context` 与 `questions` 被写入索引清单

#### Scenario: Context generation fails for a batch
- **WHEN** 该批次的模型调用抛错
- **THEN** 该批切块使用空前缀与空问题列表，索引仍可建立

#### Scenario: BM25 indexes extras
- **WHEN** 切块带有上下文前缀或问题变体
- **THEN** BM25 以 0.8 的字段权重把它们计入倒排索引

### Requirement: System SHALL persist a vector index alongside the chunks
Status: `implemented`

系统 SHALL 使用角色 `embedding` 的模型把「章节 + 上下文前缀 + 正文」向量化，
把归一化后的 float32 向量以 base64 写入 `index/vectors.bin`，并在 `index/chunks.json` 记录维度与顺序。

#### Scenario: Index built
- **WHEN** 索引阶段完成
- **THEN** `index/chunks.json`、`index/vectors.bin` 与 `index/bm25.json` 同时存在且向量数量等于切块数量

#### Scenario: Vector count mismatch
- **WHEN** 提供方返回的向量数量与输入数量不一致
- **THEN** 阶段失败并抛出 `EMBEDDING_COUNT_MISMATCH`

### Requirement: System SHALL retrieve with hybrid recall, RRF fusion and rerank
Status: `implemented`

检索 SHALL 并行执行向量召回（top 40）与 BM25 召回（top 40），用 RRF（k=60）融合，
再对前 30 条调用 rerank 角色，最终返回 top-K（默认 8）。

#### Scenario: Both channels return candidates
- **WHEN** 向量与 BM25 都返回结果
- **THEN** 融合顺序让双通道命中的切块排在前面，且每个命中携带 `bm25/vector/rrf/rerank` 分数

#### Scenario: Rerank unavailable
- **WHEN** rerank 调用失败或返回空结果
- **THEN** 使用 RRF 顺序作为最终顺序，并在 trace 的 `degradation` 字段说明原因

#### Scenario: Embedding unavailable
- **WHEN** 查询向量化失败
- **THEN** 仅使用 BM25 召回，并在 trace 的 `degradation` 字段说明原因

#### Scenario: Query has no match
- **WHEN** 两路召回都为空
- **THEN** 返回空命中列表与包含 `candidateCounts` 的 trace

### Requirement: System SHALL route global questions to chapter-level summarisation
Status: `implemented`

对于「整体讲了什么 / 核心主题 / 总结一下」这类全局意图问题，系统 SHALL 不执行片段 top-k 检索，
而是把章节笔记作为证据做 map-reduce 回答。

#### Scenario: Global intent detected
- **WHEN** 问题命中全局意图词表
- **THEN** 证据集合为全部章节的标题、gist 与要点，trace 的 `degradation` 说明该路由

#### Scenario: Local question
- **WHEN** 问题未命中全局意图
- **THEN** 走混合检索链路

### Requirement: System SHALL answer with timestamp citations that map to evidence
Status: `implemented`

回答 SHALL 流式生成，并把答案中的 `[mm:ss]` 标记校验、映射成结构化引用；
无法匹配证据的时间码保持原文，证据为空时至少挂载第一条证据。

#### Scenario: Timecode matches evidence range
- **WHEN** 答案中的时间码落在某证据片段的时间范围内（容差 12 秒）
- **THEN** 该标记被替换为 `[^n]`，并生成对应的 `Citation`（含 `chunkId/start/end/quote/chapterTitle/score`）

#### Scenario: Repeated timecode
- **WHEN** 同一证据被多次引用
- **THEN** 复用同一个引用编号，引用列表不重复

#### Scenario: Model omits all citations
- **WHEN** 答案中没有任何可匹配时间码
- **THEN** 系统为第一条证据生成一个引用，避免回答完全无出处

### Requirement: System SHALL expose ask as an SSE stream
Status: `implemented`

`POST /api/tasks/:taskId/ask` SHALL 返回 SSE，事件顺序为 `trace → delta* → answer`，
并在结束时发送 `close` 事件。

#### Scenario: Normal ask
- **WHEN** 客户端发起提问
- **THEN** 依次收到 `trace`、若干 `delta` 与一个包含完整答案和引用的 `answer` 事件

#### Scenario: Task not indexed
- **WHEN** 任务既没有章节也没有段落产物
- **THEN** 后端在建立流之前返回 409 与 `TASK_NOT_INDEXED`

#### Scenario: Generation fails mid-stream
- **WHEN** 模型流式输出 0 字节后失败
- **THEN** 发送 `error` 事件而不是空回答

### Requirement: System SHALL persist retrieval traces for inspection
Status: `implemented`

每次提问 SHALL 返回包含 `subQueries`、`candidateCounts`、`hits`、`rerankModel`、
`embeddingModel`、`latencyMs` 与 `degradation` 的 `RetrievalTrace`。

#### Scenario: Trace attached to answer
- **WHEN** 回答完成
- **THEN** `answer.trace` 包含本次检索的候选数量与最终命中列表
