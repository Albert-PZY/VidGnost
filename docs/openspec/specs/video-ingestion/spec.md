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
