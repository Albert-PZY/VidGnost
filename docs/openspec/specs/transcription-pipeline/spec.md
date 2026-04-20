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
- `C`: platform-subtitle-first transcript acquisition plus ASR fallback normalization
- `D`: study-first transcript shaping、学习工件收口、transcript-only QA 预热与最终交付

#### Scenario: Phase ordering
- **WHEN** task starts from any valid source
- **THEN** phase `A` completes before `B`
- **AND** phase `D` starts only after phase `C` output is available

### Requirement: Stage D SHALL execute ordered substage chain
Status: `implemented`

Inside phase `D`, backend SHALL execute `transcript_optimize -> subtitle_resolve -> translation_resolve -> study_pack_generate -> notes_mindmap_generate -> fusion_delivery` in order. For workflow `vqa`, backend SHALL insert `transcript_vectorize -> vqa_prewarm` before `fusion_delivery` while keeping transcript-only QA prewarm on the same study-first chain without making frame extraction, VLM inference, or image-semantic retrieval a default prerequisite.

#### Scenario: Ordered stage-D execution
- **WHEN** phase `D` starts
- **THEN** `transcript_optimize` runs before `subtitle_resolve`、`translation_resolve`、`study_pack_generate`、and `notes_mindmap_generate`
- **AND** `fusion_delivery` starts only after those study-first substages have completed or been skipped according to workflow

#### Scenario: Ordered stage-D execution for notes workflow
- **WHEN** phase `D` runs for a `notes` task
- **THEN** backend completes subtitle、translation、study-pack、and notes/mindmap substages before `fusion_delivery`
- **AND** transcript-only QA preparation substages such as `transcript_vectorize` and `vqa_prewarm` are explicitly marked as skipped instead of expanding back into multimodal work

#### Scenario: Ordered stage-D execution for VQA
- **WHEN** phase `D` runs for a `vqa` task
- **THEN** backend emits ordered substage transitions for transcript preparation and transcript-only QA prewarm before `fusion_delivery`
- **AND** those VQA substages complete before `fusion_delivery`
- **AND** current migration period MAY still expose legacy compatibility markers for older task artifacts without redefining the default study-first chain

### Requirement: VQA tasks SHALL persist transcript-only retrieval prewarm artifacts before completion
Status: `implemented`

When a task uses workflow `vqa`, phase `D` SHALL prepare the first-question retrieval corpus before the task enters the completed state.

#### Scenario: Complete a VQA task with transcript-only retrieval prewarm
- **WHEN** a `vqa` task finishes phase `D`
- **THEN** backend persists a task-local retrieval artifact under `D/vqa-prewarm/index.json`
- **AND** the default prepared corpus is built from normalized transcript chunks, transcript citations, and transcript-derived retrieval metadata
- **AND** task event stream exposes transcript-only QA prewarm progress before `fusion_delivery` marks the final delivery step
- **AND** compatibility-only multimodal artifacts MAY still appear on legacy tasks without changing the default retrieval contract
- **AND** frontend and contracts MUST continue to accept compatibility evidence fields from older tasks while preferring transcript timestamp and text citations on the study-first baseline

### Requirement: Phase C SHALL support platform-subtitle-first routing plus the current TS-native ASR routes
Status: `implemented`

Phase `C` SHALL first attempt `yt-dlp` platform subtitles for supported online `youtube` and `bilibili` tasks, and SHALL fall back to the local `faster-whisper` Python worker route or the remote OpenAI-compatible ASR route under the same normalized transcript contract when platform subtitles are unavailable or unusable.

#### Scenario: Use platform subtitles for a supported online task
- **WHEN** phase `C` runs for an online `youtube` or `bilibili` task and `yt-dlp` can download and parse a usable platform subtitle track
- **THEN** backend emits the same `transcript_delta` reset and segment events as the ASR path
- **AND** backend persists the resulting normalized transcript into `transcript_text`、`transcript_segments_json`、`C/transcript.txt`、and `C/transcript.segments.json`
- **AND** backend persists the normalized `yt-dlp` subtitle probe payload under `D/study/subtitle-probe.json` so later subtitle-track resolution reuses the same probe result instead of re-running divergent platform discovery
- **AND** backend does not invoke Whisper for that task

#### Scenario: Fall back after platform subtitles are unavailable
- **WHEN** phase `C` runs for an online `youtube` or `bilibili` task but `yt-dlp` cannot resolve or parse a usable platform subtitle track
- **THEN** backend records the platform-subtitle miss in stage-`C` logs
- **AND** backend keeps any successfully normalized subtitle probe payload reusable through the same `D/study/subtitle-probe.json` artifact contract for later study-domain track resolution
- **AND** backend continues on the same phase-`C` execution by falling back to the Whisper-compatible ASR route instead of failing the task solely because platform subtitles were absent

#### Scenario: Run local faster-whisper transcription
- **WHEN** `whisper-default` uses the local provider
- **THEN** backend resolves an existing Python executable and an existing local `CTranslate2` model directory
- **AND** backend invokes the isolated `faster-whisper` worker to produce normalized transcript segments
- **AND** backend normalizes the returned `segments[]` plus `text` into the shared transcript contract

#### Scenario: Run remote OpenAI-compatible transcription
- **WHEN** `whisper-default` uses the remote OpenAI-compatible provider
- **THEN** backend normalizes returned `segments[]` and `text` into the same transcript contract as the local route
- **AND** if the remote payload returns a detected `language`, backend persists that detected language instead of always forcing the configured fallback language

#### Scenario: Run remote OpenAI-compatible transcription
- **WHEN** `whisper-default` uses `openai_compatible`
- **THEN** backend submits the audio file to `/audio/transcriptions`
- **AND** backend normalizes the returned segments and transcript text into the same task artifact shape as the local route

#### Scenario: Stream segment transcript events during phase C
- **WHEN** phase `C` starts
- **THEN** backend emits an initial `transcript_delta` reset event followed by ordered `transcript_delta` segment events while phase `C` is still running
- **AND** for the current local `faster-whisper` route, backend submits the full extracted WAV once to a persistent Python worker instead of splitting temporary per-chunk WAV files in Node.js
- **AND** backend publishes segment timestamps directly in absolute task time and advances phase-`C` progress from streamed segment end timestamps instead of chunk completion counts

#### Scenario: Local runtime prerequisites are missing
- **WHEN** local Python runtime or the configured `CTranslate2` model directory cannot be found
- **THEN** backend returns an actionable conflict error
- **AND** current TS runtime does not auto-download the missing model or install the missing Python dependency stack

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
- **AND** backend writes `C/transcript/index.json` plus a single synthetic transcript artifact under `C/transcript/chunks/chunk-001.json` that mirrors the full normalized segment stream for later raw-transcript inspection

#### Scenario: Rerun or resume after phase C already completed
- **WHEN** a task resumes after transcript artifacts are already persisted and phase `D` still needs work
- **THEN** backend MAY reuse the persisted transcript state instead of re-running transcription
- **AND** current implementation still does not persist mid-transcription checkpoints for resuming from a partially streamed local worker request

#### Scenario: Reuse transcript artifacts while regenerating stale fallback phase-D outputs
- **WHEN** a new task matches a completed source task whose phase `D` fusion manifest still marks fallback-generated outputs
- **AND** the current LLM runtime is available for normal phase-`D` generation
- **THEN** backend reuses persisted `A` / `B` / `C` stage artifacts and transcript state from the matched task
- **AND** backend reruns phase `D` instead of replaying the stale fallback fusion outputs into the new task

### Requirement: Task deletion SHALL stop active transcription and purge task-owned runtime artifacts
Status: `implemented`

Deleting a task SHALL cancel any active execution first and then remove transcription-related runtime state owned by that task.

#### Scenario: Delete a task during or after transcription
- **WHEN** client deletes a persisted task while transcription is queued, running, paused, failed, cancelled, or completed
- **THEN** backend stops any active task execution before deleting persisted task state
- **AND** backend removes the task event log, stage metrics, runtime warnings, analysis snapshots, and stage-artifact directories owned by that task
- **AND** backend removes task-scoped VQA trace logs under `event_log_dir/traces/*.jsonl` when the trace payload references the deleted `task_id`

### Requirement: Whisper runtime config SHALL persist compatibility fields without overstating current local worker behavior
Status: `partial`

The whisper config API SHALL persist `model_default`、`language`、`device`、`compute_type`、`beam_size`、`vad_filter`、`chunk_seconds` and related compatibility fields for runtime continuity.

#### Scenario: Save Whisper config
- **WHEN** client updates `/config/whisper`
- **THEN** backend normalizes and persists the supported field set into `storage/config.toml`

#### Scenario: Read normalized Whisper defaults without a local config file
- **WHEN** `storage/config.toml` is absent
- **THEN** backend returns normalized defaults including `chunk_seconds=30`

#### Scenario: Execute current local faster-whisper route
- **WHEN** the current local `faster-whisper` worker path runs
- **THEN** backend uses the persisted `language`、`model_default`、`device`、`compute_type`、and `beam_size`
- **AND** backend keeps `vad_filter` enabled for the local worker by default
- **AND** `chunk_seconds` remains a persisted compatibility field and no longer drives Node-side temporary WAV chunking

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

Task detail response SHALL expose `vm_phase_metrics` entries for `transcript_optimize` and final phase `D` delivery. For VQA tasks, the same observability surface SHALL also expose transcript-only QA prewarm progress without requiring multimodal stage metrics on the default study-first baseline.

#### Scenario: Query task detail after phase D
- **WHEN** client requests task detail after phase `D`
- **THEN** response includes timing and status fields for `transcript_optimize`
- **AND** the final phase-`D` metric reflects fusion delivery completion state
- **AND** for `vqa` tasks, response includes timing and status fields for transcript preparation and transcript-only QA prewarm when those metrics are persisted
- **AND** once `fusion_delivery` has completed, parent `stage_metrics.D.status` is persisted as `completed` instead of remaining at a stale in-progress status

#### Scenario: Query task detail while pipeline is still running
- **WHEN** client requests task detail while internal task state is `preparing`, `transcribing`, or `summarizing`
- **THEN** response normalizes the public task status to `running`
- **AND** `stage_logs` and `stage_metrics` still expose stable `A` / `B` / `C` / `D` containers even when some phases have no persisted log lines yet
