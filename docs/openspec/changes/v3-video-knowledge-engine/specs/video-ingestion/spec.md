## ADDED Requirements

### Requirement: System SHALL accept local paths and remote URLs as task sources
Status: `implemented`

系统 SHALL 接受本地绝对路径、`file://` URL、HTTP(S) 直链媒体地址与需要 yt-dlp 解析的页面链接，
并把它们统一归一化成 `MediaSource`。

#### Scenario: Create a task from a local file path
- **WHEN** 客户端 `POST /api/tasks` 提交 `{"source":"F:\\videos\\lecture.mp4"}`
- **THEN** 后端探测媒体时长与编码，登记 `kind=local_path`、`platform=local`，并返回可用的任务记录

#### Scenario: Create a task from a remote page link
- **WHEN** 提交的 source 是 YouTube 或 Bilibili 页面链接
- **THEN** 后端调用 yt-dlp 下载媒体到 `storage/media/<taskId>__remote/`，并把 `platform` 标记为对应平台

#### Scenario: Reject an unreadable source
- **WHEN** source 既不是可读的本地路径也不是合法 URL
- **THEN** 后端返回 400 与 `SOURCE_INVALID`，不创建任务目录

### Requirement: System SHALL compute a stable content fingerprint per source
Status: `implemented`

系统 SHALL 基于「文件前 1MB 摘要 + 文件大小 + 时长」计算 `fingerprint`，
用于阶段缓存键与重复来源识别。

#### Scenario: Same file ingested twice
- **WHEN** 同一文件被两个任务使用
- **THEN** 两个任务的 `source.fingerprint` 相同

### Requirement: System SHALL expose media playback with byte-range support
Status: `implemented`

系统 SHALL 提供 `GET /api/tasks/:taskId/media`，支持 `Range` 请求与 206 响应，
使前端播放器能够精确 seek 到任意引用时间码。

#### Scenario: Request a partial byte range
- **WHEN** 请求头携带 `Range: bytes=0-1023`
- **THEN** 后端返回 206、正确的 `Content-Range` 与 `video/mp4` 内容类型

#### Scenario: Media not prepared yet
- **WHEN** 任务尚未完成 `ingest` 阶段
- **THEN** 后端返回 404 与 `MEDIA_NOT_READY`

### Requirement: System SHALL stream key frames by id
Status: `implemented`

系统 SHALL 提供 `GET /api/tasks/:taskId/frames/:frameId`，把关键帧文件按图片内容类型返回。

#### Scenario: Frame belongs to the task
- **WHEN** 请求的 frameId 存在于该任务的 `frames.json`
- **THEN** 后端返回对应的 JPEG 字节流

#### Scenario: Unknown frame id
- **WHEN** frameId 不在 `frames.json` 中
- **THEN** 后端返回 404 与 `FRAME_NOT_FOUND`
