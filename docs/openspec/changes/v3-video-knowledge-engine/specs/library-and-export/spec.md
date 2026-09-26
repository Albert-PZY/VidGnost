## ADDED Requirements

### Requirement: System SHALL maintain a library index of all tasks
Status: `implemented`

`GET /api/tasks` SHALL 返回任务摘要列表（标题、状态、时长、平台、标签、章节数、帧数、概念数、
就绪度、转写引擎、摘要首句），并支持关键字与状态过滤。

#### Scenario: List all tasks
- **WHEN** 客户端请求任务列表
- **THEN** 返回按创建时间倒序的摘要数组与总数

#### Scenario: Keyword filter
- **WHEN** 提供 `query` 参数
- **THEN** 只在标题或任务 ID 中做不区分大小写的匹配

#### Scenario: Status filter
- **WHEN** 提供 `status` 参数
- **THEN** 只返回该状态的任务

#### Scenario: Summary enrichment
- **WHEN** 任务已生成 `summary.json`
- **THEN** 摘要中包含 `tldr` 与 `tags`，用于资产库卡片

### Requirement: System SHALL expose task artifacts for reading
Status: `implemented`

`GET /api/tasks/:taskId/artifacts/:key` SHALL 返回工件内容：
文本工件返回 `text`，JSON 工件返回 `json`，并附带 `label` 与相对路径。

#### Scenario: JSON artifact
- **WHEN** 请求 `summary`
- **THEN** 返回解析后的对象，`text` 为 null

#### Scenario: Text artifact
- **WHEN** 请求 `report`
- **THEN** 返回 Markdown 文本，`json` 为 null

#### Scenario: Artifact not generated yet
- **WHEN** 请求尚未生成的工件
- **THEN** 返回 404 与 `ARTIFACT_NOT_READY`

#### Scenario: Unknown artifact key
- **WHEN** 请求未登记的 key
- **THEN** 返回 404 与 `ARTIFACT_UNKNOWN`

### Requirement: System SHALL export deliverables in five formats
Status: `implemented`

`GET /api/tasks/:taskId/export?format=` SHALL 支持 `md`、`json`、`srt`、`mmd`、`txt`，
并设置正确的 `Content-Type` 与 `Content-Disposition`。

#### Scenario: Markdown report
- **WHEN** `format=md`
- **THEN** 返回包含总览、核心结论、行动项、术语表、章节表、思维导图（含 mermaid 代码块）、关键概念的 Markdown

#### Scenario: JSON pack
- **WHEN** `format=json`
- **THEN** 返回包含任务元信息、章节、摘要、导图与知识图谱的数据包

#### Scenario: Subtitle export
- **WHEN** `format=srt`
- **THEN** 返回 `application/x-subrip` 内容，条目与转写句数一致

#### Scenario: Mind map source
- **WHEN** `format=mmd`
- **THEN** 返回 Mermaid `mindmap` 源码

#### Scenario: Unsupported format
- **WHEN** 提供的 format 不在支持列表中
- **THEN** 返回 400 与 `EXPORT_FORMAT_UNSUPPORTED`

### Requirement: System SHALL render a Markdown notes artifact
Status: `implemented`

除导出报告外，系统 SHALL 在任务目录内维护 `notes.md`，
其标题层级可直接作为 markmap 输入，且包含摘要、章节笔记与思维导图代码块。

#### Scenario: Notes built during pipeline
- **WHEN** `insight`、`mindmap`、`knowledge` 阶段完成
- **THEN** `notes.md` 依次包含总览、核心结论、行动项、术语表、章节笔记、思维导图与关键概念

### Requirement: Task storage SHALL be self-contained per task
Status: `implemented`

每个任务的产物 SHALL 全部写入 `storage/tasks/<taskId>/`，包含
`task.json`、`events.ndjson`、`checkpoints/`、`media/`、`frames/`、`index/`、`export/`。

#### Scenario: Task directory layout
- **WHEN** 任务处理完成
- **THEN** 任务目录内可独立还原转写、章节、摘要、导图、知识图谱、帧图注、检索索引与导出包

#### Scenario: Remove task
- **WHEN** 任务被删除
- **THEN** 整个任务目录被递归移除，不影响其他任务与全局设置
