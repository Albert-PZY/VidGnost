## ADDED Requirements

### Requirement: System SHALL run asynchronous four-stage transcription pipeline
The backend SHALL process each task asynchronously and transition status through `queued -> preparing -> transcribing -> summarizing -> completed|failed|cancelled`.

#### Scenario: Successful asynchronous flow
- **WHEN** a task is created
- **THEN** worker executes phases in order and persists progress snapshots

#### Scenario: Pipeline failure
- **WHEN** unrecoverable exception occurs in ingestion/transcription/generation
- **THEN** task status becomes `failed` with actionable error metadata

#### Scenario: User cancellation
- **WHEN** user cancels a waiting or running task
- **THEN** task status becomes `cancelled`
- **AND** per-task temporary workspace is cleaned while reusable model cache is retained

### Requirement: Pipeline SHALL keep explicit phase boundaries
The pipeline SHALL keep these responsibilities:
- `A`: source ingestion and normalization
- `B`: audio preprocessing and chunk planning
- `C`: Faster-Whisper transcription streaming
- `D`: transcript optimization + notes/mindmap delivery

#### Scenario: Phase ordering
- **WHEN** task starts from any valid source
- **THEN** phase `A` completes before `B`
- **AND** phase `D` starts only after phase `C` output is available

### Requirement: Stage D SHALL execute ordered substage chain
Inside phase `D`, backend SHALL execute in order:
`transcript_optimize -> fusion_delivery`.

#### Scenario: Ordered stage-D execution
- **WHEN** phase `D` starts
- **THEN** `transcript_optimize` runs before `fusion_delivery`
- **AND** `fusion_delivery` starts only after `transcript_optimize` completes or is skipped

### Requirement: Stage D context SHALL be transcript-centric
Stage `D` generation context SHALL be composed from transcript artifacts and transcript-optimization results.

#### Scenario: Compose stage-D prompt context
- **WHEN** backend prepares prompt context for phase `D`
- **THEN** backend uses transcript text and correction outputs as primary context
- **AND** generated artifacts remain aligned with transcript timeline semantics

### Requirement: Transcription runtime SHALL be CPU-only
Faster-Whisper runtime SHALL execute with effective `device=cpu`.

#### Scenario: Save whisper config with non-CPU device
- **WHEN** client submits `device` value in whisper config update
- **THEN** backend persists normalized effective `device=cpu`

### Requirement: Transcription runtime SHALL constrain compute types
Whisper runtime SHALL allow effective `compute_type` values: `int8` or `float32`.

#### Scenario: Save unsupported compute type
- **WHEN** client submits unsupported `compute_type`
- **THEN** backend persists normalized default `compute_type=int8`

### Requirement: Task start SHALL ensure Whisper small model readiness
Before phase `C` transcription begins, backend SHALL ensure `small` model files are available locally.

#### Scenario: Model cache exists
- **WHEN** task starts and local `small` model cache is complete
- **THEN** backend enters transcription without additional download

#### Scenario: Model cache missing
- **WHEN** task starts and local `small` model cache is missing or incomplete
- **THEN** backend downloads required model files and emits progress updates into runtime stream

### Requirement: Stage D generation mode SHALL resolve to API path
Stage `D` generation runtime SHALL use online API configuration as effective execution mode.

#### Scenario: Run generation with saved runtime config
- **WHEN** phase `D` starts
- **THEN** backend uses effective online API fields from runtime config store
- **AND** generation behavior remains deterministic across task restarts

### Requirement: Stage metrics SHALL expose stage-D substage observability
Task detail response SHALL include `vm_phase_metrics` entries for `transcript_optimize` and `D`.

#### Scenario: Query task detail after phase D
- **WHEN** client requests task detail
- **THEN** response includes status/timing/reason fields for `transcript_optimize`
- **AND** final phase-`D` metric reflects `fusion_delivery` completion state
