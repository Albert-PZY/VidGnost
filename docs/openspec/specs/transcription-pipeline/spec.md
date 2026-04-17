## ADDED Requirements

### Requirement: System SHALL run an asynchronous four-phase video analysis pipeline
Status: `implemented`

The backend SHALL process each task asynchronously and preserve explicit phase ordering `A -> B -> C -> D`.

#### Scenario: Successful pipeline flow
- **WHEN** a task is created from a supported source
- **THEN** worker executes phases in order and persists progress snapshots and stage artifacts

#### Scenario: Pipeline failure
- **WHEN** an unrecoverable exception occurs in ingestion, transcription, or generation
- **THEN** task status becomes `failed` with actionable error metadata

#### Scenario: User cancellation
- **WHEN** user cancels a queued or running task
- **THEN** task status becomes `cancelled`
- **AND** per-task temporary workspace is cleaned while retained source assets and reusable model directories are preserved

#### Scenario: User pause and resume
- **WHEN** user pauses a queued or running task
- **THEN** task status becomes `paused` after the current stage reaches a stable boundary
- **AND** already persisted stage metrics and task artifacts remain available for subsequent resume
- **AND** if the next active stage marker has not yet persisted, backend still anchors pause or cancel state to the first unfinished phase instead of mislabeling a later phase such as `D`
- **AND** user MAY cancel the same task while it is paused, and backend finalizes that same unfinished phase as `cancelled`
- **AND** when user resumes the same task, backend continues from the next unfinished stage instead of discarding completed work
- **AND** when a task pauses during phase `C`, resuming it restores phase `C` to `running` while later phases such as `D` remain `pending` until their own execution starts
- **AND** once a pause-resume or pause-cancel transition has settled, task detail reads expose the anchored unfinished phase state instead of a transient later-phase placeholder

### Requirement: Pipeline SHALL keep explicit phase responsibilities
Status: `implemented`

The pipeline SHALL keep these phase boundaries:
- `A`: source ingestion and normalization
- `B`: audio extraction and preprocessing
- `C`: ASR transcription and normalization
- `D`: transcript optimization and fusion delivery

#### Scenario: Phase ordering
- **WHEN** task starts from any valid source
- **THEN** phase `A` completes before `B`
- **AND** phase `D` starts only after phase `C` output is available

### Requirement: Stage D SHALL execute ordered substage chain
Status: `implemented`

Inside phase `D`, backend SHALL execute `transcript_optimize -> fusion_delivery` in order.

#### Scenario: Ordered stage-D execution
- **WHEN** phase `D` starts
- **THEN** `transcript_optimize` runs before `fusion_delivery`
- **AND** `fusion_delivery` starts only after transcript optimization completes or is skipped

### Requirement: VQA tasks SHALL persist transcript-only retrieval prewarm artifacts before completion
Status: `implemented`

When a task uses workflow `vqa`, phase `D` SHALL prepare the first-question retrieval corpus before the task enters the completed state.

#### Scenario: Complete a VQA task with retrieval prewarm
- **WHEN** a `vqa` task finishes phase `D`
- **THEN** backend persists a task-local retrieval artifact under `D/vqa-prewarm/index.json`
- **AND** that artifact contains transcript-derived retrieval windows and their text vectors for the current task
- **AND** current implementation only needs transcript-derived retrieval windows prepared before marking the task completed
- **AND** current transcript-only baseline does not require `D/vqa-prewarm/frames.json` or any VLM frame-semantic artifact before marking the task completed

### Requirement: Phase C SHALL support the current TS-native ASR routes
Status: `implemented`

Phase `C` SHALL support a local `whisper.cpp` CLI route and a remote OpenAI-compatible ASR route under the same normalized transcript contract.

#### Scenario: Run local whisper.cpp transcription
- **WHEN** `whisper-default` uses the local provider
- **THEN** backend resolves an existing `whisper-cli` executable and an existing local `ggml` model file
- **AND** backend invokes the CLI to produce SRT output
- **AND** backend normalizes the SRT into stable `segments[]` plus `text`

#### Scenario: Run remote OpenAI-compatible transcription
- **WHEN** `whisper-default` uses `openai_compatible`
- **THEN** backend submits the audio file to `/audio/transcriptions`
- **AND** backend normalizes the returned segments and transcript text into the same task artifact shape as the local route

#### Scenario: Local runtime prerequisites are missing
- **WHEN** local `whisper-cli` or the configured `ggml` model file cannot be found
- **THEN** backend returns an actionable conflict error
- **AND** current TS runtime does not auto-download the missing executable or model file

#### Scenario: Remote ASR returns invalid timestamps
- **WHEN** the remote ASR provider returns segments with invalid timestamp ordering or missing numeric bounds
- **THEN** backend terminates the transcription step with `code=ASR_REMOTE_TIMESTAMPS_INVALID`

#### Scenario: Remote ASR returns full text without usable segments
- **WHEN** the remote ASR provider returns non-empty transcript text but no usable `segments`
- **THEN** backend terminates the transcription step with `code=ASR_REMOTE_SEGMENTS_EMPTY`

### Requirement: Phase C SHALL persist normalized transcript artifacts after transcription completes
Status: `implemented`

After phase `C` finishes, backend SHALL persist the normalized transcript into both task record fields and task-local artifacts.

#### Scenario: Persist normalized transcript state
- **WHEN** phase `C` completes successfully
- **THEN** backend writes `C/transcript.txt` and `C/transcript.segments.json`
- **AND** backend updates task record `transcript_text` and `transcript_segments_json`

#### Scenario: Rerun or resume after phase C already completed
- **WHEN** a task resumes after transcript artifacts are already persisted and phase `D` still needs work
- **THEN** backend MAY reuse the persisted transcript state instead of re-running transcription
- **AND** current implementation does not persist chunk-level phase-`C` checkpoints for mid-transcription recovery

### Requirement: Task deletion SHALL stop active transcription and purge task-owned runtime artifacts
Status: `implemented`

Deleting a task SHALL cancel any active execution first and then remove transcription-related runtime state owned by that task.

#### Scenario: Delete a task during or after transcription
- **WHEN** client deletes a persisted task while transcription is queued, running, paused, failed, cancelled, or completed
- **THEN** backend stops any active task execution before deleting persisted task state
- **AND** backend removes the task event log, stage metrics, runtime warnings, analysis snapshots, and stage-artifact directories owned by that task
- **AND** backend removes task-scoped VQA trace logs under `event_log_dir/traces/*.jsonl` when the trace payload references the deleted `task_id`

### Requirement: Whisper runtime config SHALL persist compatibility fields without overstating current local CLI behavior
Status: `partial`

The whisper config API SHALL persist `model_default`、`language`、`device`、`compute_type`、`beam_size`、`vad_filter`、`chunk_seconds` and related compatibility fields for runtime continuity.

#### Scenario: Save Whisper config
- **WHEN** client updates `/config/whisper`
- **THEN** backend normalizes and persists the supported field set into `storage/config.toml`

#### Scenario: Execute current local whisper.cpp route
- **WHEN** the current local `whisper.cpp` CLI path runs
- **THEN** backend uses the persisted `language` and `model_default`
- **AND** `device`、`compute_type`、`beam_size`、`vad_filter`、`chunk_seconds` remain persisted compatibility fields instead of a fully managed local execution contract

### Requirement: Local and downloaded task records SHALL retain previewable source paths
Status: `implemented`

Tasks created from local files, explicit local paths, or supported downloadable URLs SHALL retain stable `source_local_path` values that remain previewable until the task is deleted.

#### Scenario: Finish a task created from local input
- **WHEN** a task starts from `local_file` or `local_path`
- **THEN** task detail keeps `source_local_path` pointed at the retained source asset rather than a per-run temporary workspace copy

#### Scenario: Finish a task created from a downloadable URL
- **WHEN** a task starts from a supported remote source such as `bilibili`
- **THEN** task detail keeps `source_local_path` pointed at the retained downloaded media asset instead of the temporary download workspace

### Requirement: Task detail SHALL expose stage-D observability
Status: `implemented`

Task detail response SHALL expose `vm_phase_metrics` entries for `transcript_optimize` and final phase `D` delivery.

#### Scenario: Query task detail after phase D
- **WHEN** client requests task detail after phase `D`
- **THEN** response includes timing and status fields for `transcript_optimize`
- **AND** the final phase-`D` metric reflects fusion delivery completion state
- **AND** once `fusion_delivery` has completed, parent `stage_metrics.D.status` is persisted as `completed` instead of remaining at a stale in-progress status

#### Scenario: Query task detail while pipeline is still running
- **WHEN** client requests task detail while internal task state is `preparing`, `transcribing`, or `summarizing`
- **THEN** response normalizes the public task status to `running`
- **AND** `stage_logs` and `stage_metrics` still expose stable `A` / `B` / `C` / `D` containers even when some phases have no persisted log lines yet
