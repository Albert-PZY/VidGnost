## ADDED Requirements

### Requirement: System SHALL accept bilibili URL as processing input
The system SHALL accept Bilibili video URLs or BV identifiers, normalize them into a canonical URL, and create a processing task with source type `bilibili`.

#### Scenario: Submit bilibili URL
- **WHEN** client submits a valid Bilibili URL
- **THEN** server creates a new task and returns a task ID with status `queued`

#### Scenario: Submit invalid URL
- **WHEN** client submits an unsupported or malformed URL
- **THEN** server returns a validation error with a machine-readable error code

### Requirement: System SHALL accept local video file as processing input
The system SHALL accept local video uploads (`mp4`, `mkv`, `mov`, `webm`) and create a processing task with source type `local_file`.

#### Scenario: Upload local file
- **WHEN** client uploads a supported video file within size limit
- **THEN** server stores file metadata and returns a new task ID with status `queued`

#### Scenario: Upload unsupported format
- **WHEN** client uploads a file with unsupported extension
- **THEN** server rejects the request with an explicit format error

### Requirement: System SHALL accept local filesystem path as processing input
The system SHALL accept a local file path input, validate path existence and extension, then create a processing task.

#### Scenario: Submit valid local path
- **WHEN** client submits an existing local video path with supported extension
- **THEN** server creates task and returns task ID with status `queued`

#### Scenario: Submit invalid local path
- **WHEN** client submits a missing file path
- **THEN** server returns validation error and does not create task
