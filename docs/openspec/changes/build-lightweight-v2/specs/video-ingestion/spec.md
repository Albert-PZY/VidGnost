## ADDED Requirements

### Requirement: System SHALL accept study-first online and local video inputs
Status: `partial`

The system SHALL accept both在线视频 and本地视频输入，并在任务记录中保留该任务是通过 `online` 还是 `local` 通路进入学习工作台，同时把来源归一到 `youtube` / `bilibili` / `local_file` / `local_path` 这组 study-first 来源类型。

#### Scenario: Submit supported online URL
- **WHEN** client submits a supported online video URL such as `bilibili` or `youtube`
- **THEN** server normalizes the source into a canonical URL and creates a queued task
- **AND** task record preserves `source_mode=online`
- **AND** task record preserves canonical `source_type` as `youtube` or `bilibili`

#### Scenario: Submit supported local input
- **WHEN** client uploads a supported local video file (`mp4`, `mkv`, `mov`, `webm`, `avi`, `m4v`) or submits an existing absolute local path
- **THEN** server creates a queued task with source type `local_file` or `local_path`
- **AND** task record preserves `source_mode=local`
- **AND** task detail keeps the persisted local source metadata available for later Study preview and workbench replay

#### Scenario: Submit invalid source
- **WHEN** client submits a malformed online URL, a missing local file path, or an unsupported file extension
- **THEN** server returns a machine-readable validation error
- **AND** backend does not create the task

### Requirement: Online sources SHALL prioritize subtitle-track discovery before fallback transcription
Status: `planned`

For online sources, the backend SHALL treat platform subtitle tracks as the preferred transcript source. Media download and Whisper fallback SHALL remain available when the platform cannot provide usable subtitles.

#### Scenario: Online source exposes subtitle tracks
- **WHEN** backend inspects a supported online video
- **THEN** it records available original subtitle tracks and available translated subtitle tracks as source metadata before transcript normalization begins

#### Scenario: Online source has no usable subtitle track
- **WHEN** backend cannot resolve a usable platform subtitle track for the online video
- **THEN** task remains on the online-source path
- **AND** downstream transcription MAY fallback to Whisper without making frame extraction, VLM inference, or image-semantic retrieval a prerequisite

### Requirement: Local sources SHALL enter the workbench through a Whisper-first path
Status: `implemented`

For local uploads and local filesystem paths, the backend SHALL preserve the source asset and route the task into the local audio extraction plus Whisper-compatible transcription path without requiring online subtitle discovery.

#### Scenario: Start local study task
- **WHEN** client creates a task from a local upload or a local path
- **THEN** backend persists local source metadata for later preview and replay
- **AND** downstream transcription uses the local Whisper-compatible route as the default transcript source

### Requirement: Task submission SHALL create records before runtime validation completes
Status: `implemented`

The backend SHALL validate request payload shape at submission time, create the task record, and enqueue analysis work without requiring a submission-time runtime preflight gate.

#### Scenario: Submit task with valid input
- **WHEN** client submits a URL, local path, or uploaded file with a valid request payload
- **THEN** server creates the task record
- **AND** server enqueues the task for analysis

#### Scenario: Surface runtime dependency failure after task creation
- **WHEN** client submits a task successfully but runtime checks later find that FFmpeg, Whisper, or LLM dependencies are unavailable
- **THEN** the task remains recorded and queued or running according to the current pipeline state machine
- **AND** runtime errors are surfaced through later task status, runtime warnings, or self-check diagnostics instead of a submission-time conflict response

#### Scenario: Reuse prior transcript but rerun fallback stage-D outputs
- **WHEN** client resubmits the same source and backend finds reusable transcript artifacts from a prior task
- **AND** the prior task `D/fusion/manifest.json` still marks notes or mindmap output as `generated_by=fallback`
- **AND** current runtime now has usable LLM generation available
- **THEN** backend reuses the prior transcript artifacts for the new task
- **AND** backend reruns phase `D` instead of reusing the older fallback fusion outputs

### Requirement: Task deletion SHALL remove task-owned source ingestion artifacts
Status: `implemented`

Deleting a task SHALL also remove source files and temporary workspaces owned exclusively by that task, regardless of the task status at deletion time.

#### Scenario: Delete a task that owns uploaded or downloaded source assets
- **WHEN** client deletes a persisted task in any status
- **THEN** backend stops any active source-ingestion work for that task before final removal
- **AND** backend removes uploaded shadow source files under `upload_dir/<task_id>_*`
- **AND** backend removes downloaded source directories under `upload_dir/<task_id>-*`
- **AND** backend removes the task-scoped temporary workspace under `temp_dir/<task_id>`
