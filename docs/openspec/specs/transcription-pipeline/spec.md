## ADDED Requirements

### Requirement: System SHALL run asynchronous four-stage transcription pipeline
The backend SHALL process each task asynchronously and transition status through `queued -> preparing -> transcribing -> summarizing -> completed|failed|cancelled`.

#### Scenario: Successful asynchronous flow
- **WHEN** a task is created
- **THEN** worker executes stages in order and persists progress snapshots

#### Scenario: Pipeline failure
- **WHEN** any unrecoverable exception occurs in ingestion/transcription/summarization
- **THEN** task status changes to `failed` with actionable error message

#### Scenario: User cancellation
- **WHEN** user cancels a running/waiting task
- **THEN** task status changes to `cancelled`
- **AND** temporary per-task workspace is cleaned while reusable Whisper cache is retained

### Requirement: Pipeline SHALL keep balanced stage boundaries
The pipeline SHALL keep these stage responsibilities:
- `A`: source ingestion and normalization
- `B`: audio preprocessing and chunking
- `C`: Faster-Whisper transcription streaming
- `D`: transcript optimization + notes/mindmap delivery

#### Scenario: Stage boundary clarity
- **WHEN** task starts from any valid source
- **THEN** stage `A` completes before `B`
- **AND** stage `D` starts only after stage `C` output is available

### Requirement: Stage D SHALL execute ordered substage chain
Inside stage `D`, backend SHALL execute in-order:
`transcript_optimize -> fusion_delivery`.

#### Scenario: Ordered substage execution
- **WHEN** stage `D` starts
- **THEN** `transcript_optimize` runs before `fusion_delivery`
- **AND** `fusion_delivery` starts only after `transcript_optimize` completes or is skipped

### Requirement: Stage D SHALL be transcript-only
Stage `D` SHALL NOT execute video keyframe extraction, OCR, or VLM frame semantic pipelines.

#### Scenario: Stage D starts in current profile
- **WHEN** backend enters stage `D`
- **THEN** backend only consumes transcript artifacts and LLM runtime config
- **AND** no visual substage keys are produced

### Requirement: Transcription runtime SHALL stay GPU-only
Faster-Whisper runtime SHALL execute in GPU mode and SHALL NOT silently fall back to CPU when CUDA runtime is unavailable.

#### Scenario: CUDA runtime libraries missing
- **WHEN** transcription initializes but CUDA runtime libraries are unavailable
- **THEN** task fails with explicit GPU dependency error

### Requirement: Runtime execution mode SHALL be API-only for summarization path
Summarization runtime mode resolution SHALL normalize to API path in current profile.

#### Scenario: Legacy local-mode payload arrives
- **WHEN** request/config still carries legacy local-mode hints
- **THEN** backend normalizes execution mode to `api`
- **AND** pipeline behavior stays consistent with API-only design

### Requirement: Stage metrics SHALL expose substage observability for D
Task detail response SHALL include `vm_phase_metrics` for `transcript_optimize` and `D`.

#### Scenario: Query task detail after stage D run
- **WHEN** client requests task detail
- **THEN** response includes substage status/timing/reason fields for `transcript_optimize`
- **AND** final `D` phase status reflects `fusion_delivery` completion state
