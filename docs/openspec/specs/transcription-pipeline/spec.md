## ADDED Requirements

### Requirement: System SHALL run an asynchronous four-phase video analysis pipeline
The backend SHALL process each task asynchronously and preserve explicit phase ordering `A -> B -> C -> D`.

#### Scenario: Successful pipeline flow
- **WHEN** a task is created from a supported source
- **THEN** worker executes phases in order and persists progress snapshots and artifacts

#### Scenario: Pipeline failure
- **WHEN** an unrecoverable exception occurs in ingestion, transcription, or generation
- **THEN** task status becomes `failed` with actionable error metadata

#### Scenario: User cancellation
- **WHEN** user cancels a queued or running task
- **THEN** task status becomes `cancelled`
- **AND** per-task temporary workspace is cleaned while reusable model cache is retained

### Requirement: Pipeline SHALL keep explicit phase responsibilities
The pipeline SHALL keep these phase boundaries:
- `A`: source ingestion and normalization
- `B`: audio preprocessing and chunk planning
- `C`: Faster-Whisper transcription streaming
- `D`: transcript optimization and fusion delivery

#### Scenario: Phase ordering
- **WHEN** task starts from any valid source
- **THEN** phase `A` completes before `B`
- **AND** phase `D` starts only after phase `C` output is available

### Requirement: Stage D SHALL execute ordered substage chain
Inside phase `D`, backend SHALL execute `transcript_optimize -> fusion_delivery` in order.

#### Scenario: Ordered stage-D execution
- **WHEN** phase `D` starts
- **THEN** `transcript_optimize` runs before `fusion_delivery`
- **AND** `fusion_delivery` starts only after transcript optimization completes or is skipped

### Requirement: Phase C SHALL prepare the managed Whisper small cache before transcription
Before runtime transcription starts, backend SHALL ensure the managed Whisper small model cache is present locally.

#### Scenario: Small model cache already exists
- **WHEN** task starts and local Whisper small cache is complete
- **THEN** backend enters transcription without additional download

#### Scenario: Small model cache is missing
- **WHEN** task starts and local Whisper small cache is missing or incomplete
- **THEN** backend downloads required model files, reports progress, and continues after the cache becomes ready

### Requirement: Phase C runtime SHALL honor persisted device and compute preferences
Transcription runtime SHALL apply persisted whisper `device` and `compute_type` preferences after normalization.

#### Scenario: Run transcription with persisted runtime config
- **WHEN** phase `C` starts
- **THEN** backend uses effective whisper `device=auto|cpu|cuda` and `compute_type=int8|float32`
- **AND** runtime model caching keys are derived from the effective device and compute type

### Requirement: Whisper GPU runtime SHALL be prepared before GPU transcription begins
When persisted whisper device strategy is `auto` or `cuda`, backend SHALL configure the current process environment from the persisted Whisper GPU runtime-library install directory and SHALL only enter Faster-Whisper GPU loading after required runtime DLLs pass readiness validation.

#### Scenario: Start transcription with ready GPU runtime
- **WHEN** persisted whisper `device` is `auto` or `cuda`
- **AND** required runtime DLLs such as `cublas64_12.dll` and `cudnn64*.dll` are discoverable and loadable from the configured runtime-library directory or current process `PATH`
- **THEN** backend starts Faster-Whisper model loading with GPU-capable process environment already configured

#### Scenario: Start transcription with missing GPU runtime
- **WHEN** persisted whisper `device` is `auto` or `cuda`
- **AND** the configured Whisper GPU runtime-library bundle is missing files or cannot be loaded
- **THEN** backend reports the runtime as not ready
- **AND** the task-runtime preflight blocks task execution before transcription starts

### Requirement: Whisper model selection SHALL preserve current effective implementation contract
The whisper config API SHALL persist `model_default=small|medium` as a config field, while the current managed transcription implementation prepares and uses the Whisper small cache as the effective bundled runtime path.

#### Scenario: Save whisper model_default
- **WHEN** client updates whisper `model_default`
- **THEN** backend persists the field value for runtime config continuity
- **AND** the current managed local model preparation path remains the Whisper small cache

### Requirement: Stage D SHALL use the persisted OpenAI-compatible generation config
Phase `D` generation runtime SHALL use effective online LLM settings from the runtime config store.

#### Scenario: Run generation with saved config
- **WHEN** phase `D` starts
- **THEN** backend uses effective OpenAI-compatible provider fields from `/config/llm`
- **AND** generation behavior remains stable across task replay and rerun-stage-d flows

### Requirement: Task detail SHALL expose stage-D observability
Task detail response SHALL expose `vm_phase_metrics` entries for `transcript_optimize` and final phase `D` delivery.

#### Scenario: Query task detail after phase D
- **WHEN** client requests task detail after phase `D`
- **THEN** response includes timing and status fields for `transcript_optimize`
- **AND** the final phase-`D` metric reflects fusion delivery completion state
