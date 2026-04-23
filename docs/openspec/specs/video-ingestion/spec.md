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

### Requirement: Online sources SHALL use source-specific subtitle acquisition before fallback transcription
Status: `implemented`

For online sources, the backend SHALL use source-specific subtitle acquisition before phase `C` falls back to ASR. `youtube` sources use `yt-dlp` public subtitles first. `bilibili` sources skip `yt-dlp` public subtitle probing for transcript acquisition and attempt logged-in Bilibili AI subtitles first. When a usable subtitle track is resolved from either subtitle path, backend SHALL normalize that track into the same transcript contract and task artifacts consumed by the downstream study-first pipeline.

#### Scenario: YouTube source exposes usable subtitle tracks
- **WHEN** backend inspects a supported YouTube video
- **THEN** it probes available original subtitle tracks and available translated subtitle tracks through `yt-dlp` before transcript normalization begins
- **AND** it records those subtitle-track candidates as source metadata for later study-domain materialization
- **AND** if phase `C` can download and parse a usable public platform subtitle track, backend persists `transcript_text` and `transcript_segments_json` from that platform track without invoking Bilibili login fallback or Whisper

#### Scenario: Bilibili source exposes logged-in AI subtitles
- **WHEN** backend inspects a supported Bilibili video during phase `C`
- **THEN** it requests logged-in Bilibili AI subtitles before ASR fallback
- **AND** it does not run `yt-dlp` public subtitle probing as a Bilibili transcript source
- **AND** if phase `C` can download and parse a usable logged-in AI subtitle track, backend persists `transcript_text` and `transcript_segments_json` from that AI subtitle track without invoking Whisper

#### Scenario: Online source has no usable subtitle track
- **WHEN** backend cannot resolve or parse a usable applicable subtitle track for the online video
- **THEN** task remains on the online-source path
- **AND** for `bilibili`, phase `C` follows logged-in Bilibili AI subtitles -> ASR fallback without an intermediate `yt-dlp` public subtitle step
- **AND** if the Bilibili login session is missing, expired, or AI subtitle retrieval fails, backend marks the auth state when applicable and continues to ASR fallback without blocking the task
- **AND** phase `C` falls back to Whisper-compatible ASR or the remote ASR route while preserving the same normalized transcript artifact contract
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
