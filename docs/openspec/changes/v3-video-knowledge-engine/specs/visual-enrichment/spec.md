## ADDED Requirements

### Requirement: Vision enrichment SHALL be opt-in per task
Status: `implemented`

视觉增强 SHALL 只在任务选项 `vision=true` 且来源包含视频轨时执行；关闭或纯音频来源时该阶段标记为 `skipped`。

#### Scenario: Vision disabled
- **WHEN** 任务选项 `vision=false`
- **THEN** `vision` 阶段状态为 `skipped`，阶段消息为「未开启视觉增强」，任务仍然成功

#### Scenario: Audio-only source
- **WHEN** 来源是纯音频文件
- **THEN** `vision` 阶段被跳过，消息为「来源为纯音频，跳过画面理解」

#### Scenario: Deep preset default
- **WHEN** 使用 `deep` 预设且未显式覆盖
- **THEN** `vision` 默认为开启

### Requirement: System SHALL extract key frames by scene change with interval fallback
Status: `implemented`

抽帧 SHALL 优先使用 ffmpeg 场景变化检测（`select='gt(scene,t)'`），
当候选帧少于 3 张时退化为等间隔采样。抽取数量由预设决定（`deep` 30 帧，其余 16 帧）。

#### Scenario: Scene detection produces enough candidates
- **WHEN** 场景变化检测产出不少于 3 张候选帧
- **THEN** `KeyFrame.kind` 标记为 `scene`

#### Scenario: Scene detection is too sparse
- **WHEN** 候选帧少于 3 张或场景检测命令失败
- **THEN** 系统按等间隔采样，`kind` 标记为 `interval`

#### Scenario: Scene detection command fails
- **WHEN** ffmpeg 场景检测返回非零退出码
- **THEN** 阶段不失败，改用等间隔采样

### Requirement: System SHALL deduplicate frames by perceptual hash
Status: `implemented`

系统 SHALL 计算帧的差分哈希，并保留与已选帧汉明距离大于阈值的候选，
在去重后仍过于稀疏时按时间顺序补齐。

#### Scenario: Near-duplicate frame
- **WHEN** 候选帧与已保留帧的汉明距离不大于 12
- **THEN** 该帧被丢弃

#### Scenario: First frame always kept
- **WHEN** 候选帧集合非空
- **THEN** 第一张候选帧一定被保留，保证时间轴起点有画面证据

### Requirement: System SHALL caption frames with the previous frame as context
Status: `implemented`

每帧 SHALL 调用视觉模型生成图注、屏上可读文字与「信息型画面」判定，
并在提示词中携带上一帧的图注以保持时序连贯。

#### Scenario: Caption succeeds
- **WHEN** 视觉模型返回合法 JSON
- **THEN** `KeyFrame` 写入 `caption`、`onScreenText`（可空）与 `slideLike`

#### Scenario: Model returns non-JSON text
- **WHEN** 视觉模型返回未结构化文本
- **THEN** 该文本被截断后作为 `caption` 使用，不丢弃整帧

#### Scenario: Single frame caption fails
- **WHEN** 某帧的模型调用抛错
- **THEN** 只记录 warn 日志，其余帧继续处理

#### Scenario: Frame image missing
- **WHEN** 帧文件不存在或为空
- **THEN** 该帧图注留空，不影响其余帧

### Requirement: Frame captions SHALL participate in text retrieval
Status: `implemented`

关键帧图注与屏上文字 SHALL 按时间投影到最近的转写段落，
并在切块时以「【画面信息】」段落追加到块文本，使画面内容可被文本检索命中。

#### Scenario: Frame time falls inside a paragraph
- **WHEN** 帧时间落在某段落的时间范围内
- **THEN** 该帧的图注与屏上文字被写入该段落的画面备注

#### Scenario: Frame time falls between paragraphs
- **WHEN** 帧时间距离最近段落边界不超过 20 秒
- **THEN** 挂载到该最近段落；超过 20 秒则丢弃

#### Scenario: Chunk includes frame notes
- **WHEN** 某切块包含带有画面备注的段落
- **THEN** 块文本末尾追加 `【画面信息】` 行，内容去重且最多 6 条
