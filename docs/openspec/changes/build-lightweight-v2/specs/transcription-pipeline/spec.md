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

#### Scenario: User pause and resume
- **WHEN** user pauses a queued or running task
- **THEN** task status becomes `paused`
- **AND** already persisted transcript chunks, stage metrics, and stage artifacts remain available for subsequent resume
- **AND** when user resumes the same task, backend continues from existing checkpoints instead of discarding completed work

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
- **AND** the isolated transcription worker receives those effective runtime preferences as its execution payload

### Requirement: Phase C SHALL execute inside an isolated worker process
Phase `C` SHALL run Faster-Whisper transcription inside a dedicated worker process rather than holding the runtime in the main orchestration process.

#### Scenario: Start isolated transcription worker
- **WHEN** phase `C` begins and at least one transcript chunk still needs transcription
- **THEN** backend acquires the heavy-model execution lease
- **AND** backend starts a dedicated Whisper worker process for the remaining chunk set
- **AND** the main orchestration process streams the worker request payload through a runtime-compatible stdio bridge, consumes structured worker events from that bridge, and persists checkpoints from those events

#### Scenario: Finish isolated transcription worker
- **WHEN** the final missing transcript chunk finishes
- **THEN** the worker process exits after returning completion status
- **AND** the main process continues into phase `D` using the persisted transcript state

### Requirement: Phase C SHALL persist chunk checkpoints and resume from persisted transcription state
Phase `C` SHALL persist transcript progress after each completed audio chunk and SHALL resume from persisted chunk checkpoints when an unfinished task is recovered.

#### Scenario: Persist transcript state after each chunk
- **WHEN** phase `C` completes any audio chunk
- **THEN** backend writes that chunk's transcript payload to stage artifacts under `C/transcript/chunk-XXXX.json`
- **AND** backend refreshes `C/transcript/index.json` and `C/transcript/full.txt` with the currently completed chunk set
- **AND** backend updates task record `transcript_text` and `transcript_segments_json` with the currently completed transcript state before phase `C` finishes

#### Scenario: Resume unfinished transcription from checkpoints
- **WHEN** backend resumes a non-terminal task whose phase `C` already has persisted transcript chunk artifacts
- **THEN** phase `C` reuses completed chunk checkpoints in order
- **AND** backend transcribes only missing chunks before entering phase `D`
- **AND** phase `D` starts only after the recovered full transcript state is reassembled into the task record

#### Scenario: Resume a paused task after transcription already finished
- **WHEN** backend resumes a paused task whose transcript text and transcript segment checkpoints are already persisted and phase `D` is not yet complete
- **THEN** backend MAY skip repeating phases `A` to `C`
- **AND** backend continues directly from the remaining phase-`D` work using the persisted transcript artifacts

### Requirement: Local-source task records SHALL retain a previewable source path
Tasks created from uploaded files or explicit local paths SHALL retain a stable source path that remains previewable until the task is deleted.

#### Scenario: Finish a task created from local input
- **WHEN** a task starts from `local_file` or `local_path`
- **THEN** task detail keeps `source_local_path` pointed at the retained source asset rather than a per-run temporary workspace copy
- **AND** per-run temporary workspaces are cleaned after execution without deleting the retained source asset

### Requirement: Downloaded-source task records SHALL retain a previewable source path
Tasks created from downloadable remote inputs such as `bilibili` URLs SHALL move the fetched source media into a stable retained asset path before temporary workspaces are cleaned, so the completed task remains previewable in the workbench until deletion.

#### Scenario: Finish a task created from a bilibili URL
- **WHEN** a task starts from `bilibili`
- **THEN** task detail keeps `source_local_path` pointed at the retained downloaded media asset instead of the per-run temporary download workspace
- **AND** cleanup of the per-run temporary workspace does not delete the retained downloaded media asset

### Requirement: Transcription CUDA runtime SHALL be prepared before GPU transcription begins
When persisted whisper device strategy is `auto` or `cuda`, backend SHALL configure the current process environment from the persisted transcription CUDA runtime-library install directory and SHALL only enter Faster-Whisper GPU loading after required runtime DLLs pass readiness validation. The isolated transcription worker SHALL inherit that prepared environment before loading the GPU runtime.

#### Scenario: Start transcription with ready GPU runtime
- **WHEN** persisted whisper `device` is `auto` or `cuda`
- **AND** required runtime DLLs such as `cublas64_12.dll` and `cudnn64*.dll` are discoverable and loadable from the configured managed runtime-library directory after backend applies that directory to the current process environment
- **THEN** backend starts Faster-Whisper model loading with GPU-capable process environment already configured

#### Scenario: Start transcription with missing GPU runtime
- **WHEN** persisted whisper `device` is `auto` or `cuda`
- **AND** the configured transcription CUDA runtime-library bundle is missing files or cannot be loaded
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
