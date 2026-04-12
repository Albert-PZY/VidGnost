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
The system SHALL accept local uploads (`mp4`, `mkv`, `mov`, `webm`) and create processing tasks with source type `local_file`.

#### Scenario: Upload supported local file
- **WHEN** client uploads a supported video file within size limit
- **THEN** server stores input metadata and returns task ID with status `queued`

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

### Requirement: Task submission SHALL pass runtime preflight before enqueue
Before the backend creates or enqueues a task, it SHALL verify that the current workflow can actually start with the available runtime environment and required model set.

#### Scenario: Submit task when runtime preflight passes
- **WHEN** client submits a URL, local path, or uploaded file and the required runtime checks pass
- **THEN** server creates the task record
- **AND** server enqueues the task for analysis

#### Scenario: Reject task when runtime preflight fails
- **WHEN** client submits a task and the required runtime checks fail because FFmpeg is unavailable, disk space is too low, the LLM service is unreachable, or a required model is not ready
- **AND** runtime preflight treats an OpenAI-compatible LLM as unavailable when `/models` is unreachable, returns an invalid payload, or does not include the configured `model`
- **THEN** server returns a conflict response with a clear remediation hint
- **AND** server does not create the task record
- **AND** server does not enqueue the task
