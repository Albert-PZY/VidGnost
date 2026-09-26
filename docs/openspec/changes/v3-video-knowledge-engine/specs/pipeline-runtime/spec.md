## ADDED Requirements

### Requirement: System SHALL run tasks through ten ordered stages
Status: `implemented`

任务 SHALL 按固定顺序经过
`ingest → audio → transcribe → structure → insight → mindmap → knowledge → vision → index → finalize`，
每个阶段有独立的 `status / progress / message / artifacts / startedAt / finishedAt`。

#### Scenario: Fresh task
- **WHEN** 任务被创建
- **THEN** 十个阶段全部为 `pending`，任务状态为 `queued`，`readiness` 为 0

#### Scenario: Stage transition
- **WHEN** 阶段开始运行
- **THEN** 该阶段状态变为 `running` 并写入 `startedAt`，任务 `readiness` 按权重计算

#### Scenario: Stage skipped
- **WHEN** 阶段因条件不满足被跳过（如未开启视觉增强）
- **THEN** 状态为 `skipped`，其权重计入就绪度，任务继续执行后续阶段

#### Scenario: Stage fails
- **WHEN** 阶段抛出异常
- **THEN** 任务状态变为 `failed`，`error` 写入该任务的错误码与消息，后续阶段不再执行

### Requirement: System SHALL be resumable via stage checkpoints
Status: `implemented`

每个阶段完成时 SHALL 写入检查点，键为 `sha1(stageId | 来源指纹 | 相关模型路由签名 | 相关选项)`；
下次运行时若键一致且产物存在，则直接复用。

#### Scenario: Cache hit
- **WHEN** 检查点键一致且该阶段的必需产物仍存在
- **THEN** 阶段被标记为 `succeeded`，消息为「命中阶段缓存，复用已有产物」，且不产生模型调用

#### Scenario: Cache miss because the model route changed
- **WHEN** 阶段依赖的模型路由被修改
- **THEN** 键发生变化，该阶段重新执行，其余阶段不受影响

#### Scenario: Artifact missing
- **WHEN** 检查点存在但必需产物已删除
- **THEN** 视为未命中，阶段重新执行

#### Scenario: Explicit rerun
- **WHEN** 客户端调用重跑接口
- **THEN** 除 `ingest` 外的阶段检查点被清除，任务重新排队

### Requirement: System SHALL recover interrupted tasks on startup
Status: `implemented`

进程启动时 SHALL 扫描磁盘上仍处于 `queued` 或 `running` 的任务，把它们重置为 `queued` 并重新入队。

#### Scenario: Task interrupted mid-stage
- **WHEN** 进程在 `mindmap` 阶段被终止后重启
- **THEN** 已完成阶段命中缓存并跳过，`mindmap` 及其后续阶段继续执行

#### Scenario: Interrupted stage state
- **WHEN** 恢复任务时某阶段仍写着 `running`
- **THEN** 该阶段状态被重置为 `pending`，进度归零，消息为「等待恢复」

### Requirement: System SHALL enforce a concurrency limit
Status: `implemented`

任务 SHALL 按配置的并发上限（默认 2，范围 1-8）执行，超出的任务排队。

#### Scenario: Queue behaviour
- **WHEN** 同时提交超过上限的任务
- **THEN** 超出的任务保持 `queued`，并在有空闲槽位时自动开始

#### Scenario: Change concurrency at runtime
- **WHEN** 设置有修改
- **THEN** 管理器立即按新上限调度队列

### Requirement: System SHALL cancel queued and running tasks
Status: `implemented`

系统 SHALL 支持取消排队中或运行中的任务，并把任务状态置为 `canceled`。

#### Scenario: Cancel a running task
- **WHEN** 客户端取消正在运行的任务
- **THEN** 运行中的阶段收到 abort 信号，任务状态变为 `canceled`，错误码为 `TASK_CANCELED`

#### Scenario: Cancel a queued task
- **WHEN** 客户端取消仍在排队的任务
- **THEN** 任务立即从队列移除并标记为 `canceled`

#### Scenario: Cancel an idle task
- **WHEN** 任务既不在运行也不在排队
- **THEN** 返回 409 与 `TASK_NOT_RUNNING`

### Requirement: System SHALL publish task events over SSE
Status: `implemented`

`GET /api/tasks/:taskId/stream` SHALL 在建立连接时先发送 `snapshot` 与最近事件，
随后实时推送 `stage / log / artifact / status / done`，并每 15 秒发送心跳注释。

#### Scenario: Late subscriber
- **WHEN** 客户端在任务运行中途连接
- **THEN** 首先收到当前任务快照与最近 60 条历史事件，随后收到增量事件

#### Scenario: Client disconnects
- **WHEN** 客户端断开连接
- **THEN** 服务端清理订阅与心跳定时器

#### Scenario: Global stream
- **WHEN** 客户端订阅 `GET /api/stream`
- **THEN** 收到全部任务的 `status` 与 `done` 事件，用于资产库实时刷新

### Requirement: System SHALL persist events for replay
Status: `implemented`

所有任务事件 SHALL 追加写入 `storage/tasks/<taskId>/events.ndjson`，
并提供 `GET /api/tasks/:taskId/events` 读取最近事件。

#### Scenario: Read event log
- **WHEN** 客户端请求事件列表
- **THEN** 返回最近 300 条事件与当前任务状态

### Requirement: Task deletion SHALL require a non-running task
Status: `implemented`

删除任务 SHALL 递归移除任务目录并清理事件历史；运行中的任务必须先取消。

#### Scenario: Delete a finished task
- **WHEN** 删除已完成任务
- **THEN** 任务目录被移除，返回 204

#### Scenario: Delete a running task
- **WHEN** 删除仍在运行的任务
- **THEN** 返回 409 与 `TASK_RUNNING`
