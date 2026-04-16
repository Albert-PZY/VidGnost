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
