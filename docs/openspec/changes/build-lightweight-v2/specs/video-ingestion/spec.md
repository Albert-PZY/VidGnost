## ADDED Requirements

### Requirement: System SHALL accept bilibili URL as processing input
The system SHALL accept Bilibili video URLs or BV identifiers, normalize them into canonical URLs, and create processing tasks with source type `bilibili`.

#### Scenario: Submit bilibili URL
- **WHEN** client submits a valid Bilibili URL
- **THEN** server creates a task and returns task ID with status `queued`

#### Scenario: Submit invalid URL
- **WHEN** client submits an unsupported or malformed URL
- **THEN** server returns validation error with machine-readable error code

### Requirement: System SHALL accept local video file upload as processing input
The system SHALL accept local uploads (`mp4`, `mkv`, `mov`, `webm`, `avi`, `m4v`) and create processing tasks with source type `local_file`.

#### Scenario: Upload supported local file
- **WHEN** client uploads a supported video file within size limit
- **THEN** server stores input metadata and returns task ID with status `queued`

#### Scenario: Upload large local file through batch endpoint
- **WHEN** client submits a supported local video file through the batch upload endpoint and the file remains within the configured size limit
- **THEN** server consumes the multipart file stream during request handling without stalling on large payloads
- **AND** server returns the queued task response after the upload request body is fully processed

#### Scenario: Upload avi or m4v file
- **WHEN** client uploads an `.avi` or `.m4v` local video file within size limit
- **THEN** server accepts the request through the same local-file task creation flow

#### Scenario: Upload unsupported file format
- **WHEN** client uploads a file with unsupported extension
- **THEN** server rejects request with explicit format error

### Requirement: System SHALL accept local filesystem path as processing input
The system SHALL accept local path input, validate path existence and extension, and create processing tasks.

#### Scenario: Submit valid local path
- **WHEN** client submits existing local video path with supported extension
- **THEN** server creates task and returns task ID with status `queued`

#### Scenario: Submit missing local path
- **WHEN** client submits non-existing local file path
- **THEN** server returns validation error and does not create task

### Requirement: Task submission SHALL create records before runtime validation completes
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
Deleting a task SHALL also remove source files and temporary workspaces owned exclusively by that task, regardless of the task status at deletion time.

#### Scenario: Delete a task that owns uploaded or downloaded source assets
- **WHEN** client deletes a persisted task in any status
- **THEN** backend stops any active source-ingestion work for that task before final removal
- **AND** backend removes uploaded shadow source files under `upload_dir/<task_id>_*`
- **AND** backend removes downloaded source directories under `upload_dir/<task_id>-*`
- **AND** backend removes the task-scoped temporary workspace under `temp_dir/<task_id>`
