## Requirements

### Requirement: System SHALL prefer online file transcription over local models
Status: `implemented`

转写 SHALL 优先使用百炼文件级异步 ASR（`qwen-audio-3.1-asr-flash-filetrans`），
只有在线不可用、显式选择本地、或在线失败且偏好为 `auto` 时才回退本地 `faster-whisper`。

#### Scenario: Online transcription succeeds
- **WHEN** 已配置 `DASHSCOPE_API_KEY` 且 `options.asr` 为 `auto` 或 `online`
- **THEN** 任务使用在线 ASR，`transcript.engine` 为 `dashscope-filetrans`

#### Scenario: Provider credential missing
- **WHEN** 未配置百炼密钥且偏好为 `auto`
- **THEN** 后端记录一条回退日志，改用本地 Whisper，并把 `TranscribeOutput.degraded` 置为 true

#### Scenario: Forced online but credential missing
- **WHEN** 偏好为 `online` 但没有可用密钥
- **THEN** 后端返回 `ASR_ONLINE_UNAVAILABLE`，并提示配置环境变量或改为本地

#### Scenario: Online fails and preference allows fallback
- **WHEN** 在线转写抛出错误且偏好为 `auto`
- **THEN** 后端回退本地 Whisper，并在阶段日志中记录失败原因

### Requirement: System SHALL upload audio through the temporary upload policy flow
Status: `implemented`

在线转写 SHALL 走「获取上传策略 → OSS 直传 → 使用 `oss://` 引用提交异步任务」的流程，
并在提交时携带 `X-DashScope-OssResourceResolve: enable`。

#### Scenario: Audio chunk exceeds the provider limit
- **WHEN** 单个分片体积超过策略返回的 `max_file_size_mb`
- **THEN** 后端抛出 `ASR_CHUNK_TOO_LARGE` 并提示调小切片时长

#### Scenario: Upload policy is cached
- **WHEN** 同一文件在策略有效期内重复上传
- **THEN** 后端复用已缓存的 `oss://` 引用，不再重复上传

### Requirement: System SHALL split long audio and merge timestamps with offsets
Status: `implemented`

长音频 SHALL 按「20 分钟」与「单文件体积上限」的较小值切成 mp3 分片，
转写结果的句级时间戳 SHALL 加上分片起始偏移后合并成单一时间轴。

#### Scenario: Merge multi-chunk transcription
- **WHEN** 一个任务被切成 N 个分片
- **THEN** 合并后的 `transcript.segments` 时间戳单调递增，且最后一句结束时间不超过媒体时长太多

### Requirement: System SHALL normalize transcripts into a canonical document
Status: `implemented`

系统 SHALL 输出 `TranscriptDoc`，包含 `language`、`engine`、`engineDetail`、`durationSeconds`、
`segments[]`（含 `start/end/text/words?`）与纯文本全文，并同步写出 SRT 与 TXT 工件。

#### Scenario: Produce subtitle artifact
- **WHEN** 转写阶段完成
- **THEN** 任务目录下存在 `transcript.json`、`transcript.srt`、`transcript.txt`，且 SRT 条目数与句数一致

#### Scenario: Merge duplicated consecutive segments
- **WHEN** 相邻分片边界产生重复文本
- **THEN** 标准化过程合并重复片段，不产生重复句

#### Scenario: Empty transcription result
- **WHEN** 引擎返回零句
- **THEN** 阶段失败并抛出 `ASR_EMPTY_RESULT`
